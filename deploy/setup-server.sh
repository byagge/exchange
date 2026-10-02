#!/usr/bin/env bash
# Idempotent setup for exchange.arix.vu only. Does not touch other nginx sites.
set -euo pipefail

APP_ROOT="/var/www/exchange.arix.vu"
DOMAIN="exchange.arix.vu"
API_PORT=3010

export DEBIAN_FRONTEND=noninteractive

# Small VPS: ensure swap for npm build (do not alter other apps)
if [[ ! -f /swapfile ]] && [[ $(free -m | awk '/Mem:/{print $2}') -lt 3000 ]]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

mkdir -p "$APP_ROOT/data" "$APP_ROOT/uploads" /var/log/exchange
chown -R root:root "$APP_ROOT"

cd "$APP_ROOT"
if [[ ! -f .env ]]; then
  echo "ERROR: missing $APP_ROOT/.env" >&2
  exit 1
fi

npm ci
npm run db:generate
npm run build:server
VITE_API_URL= npm run build -w @exchange/miniapp

DATABASE_URL="file:${APP_ROOT}/data/prod.db" npx prisma db push \
  --schema=packages/db/prisma/schema.prisma --skip-generate

# Nginx — only this vhost file
cp -f "$APP_ROOT/deploy/nginx.exchange.arix.vu.conf" /etc/nginx/sites-available/exchange.arix.vu
ln -sfn /etc/nginx/sites-available/exchange.arix.vu /etc/nginx/sites-enabled/exchange.arix.vu
nginx -t
systemctl reload nginx

if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect
fi

pm2 delete exchange-api exchange-bot 2>/dev/null || true
pm2 start "$APP_ROOT/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "OK: https://${DOMAIN}  API 127.0.0.1:${API_PORT}"
pm2 list | grep exchange || true
curl -sS -o /dev/null -w "miniapp HTTP %{http_code}\n" "https://${DOMAIN}/" || true
curl -sS -o /dev/null -w "api HTTP %{http_code}\n" "https://${DOMAIN}/api/" || true
