#!/usr/bin/env python3
import os
import sys
from pathlib import Path

import paramiko

PASSWORD = os.environ.get("EXCHANGE_SSH_PASSWORD", "")
APP = "/var/www/exchange.arix.vu"
LOCAL = Path(r"D:\codes\exchange crypto")
FILES = [
    "apps/bot/src/index.ts",
    "apps/miniapp/src/pages/Wallet.tsx",
    "apps/miniapp/src/pages/Exchange.tsx",
    "apps/miniapp/src/components/RateCalculator.tsx",
    "apps/miniapp/src/lib/auth.tsx",
    "scripts/ensure-admin-732.js",
]


def main():
    if not PASSWORD:
        return 2
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect("144.31.151.112", username="root", password=PASSWORD, timeout=30, banner_timeout=30)
    sftp = ssh.open_sftp()
    for rel in FILES:
        remote = f"{APP}/{rel}"
        with sftp.file(remote, "wb") as f:
            f.write((LOCAL / rel).read_bytes())
        print("up", rel)
    sftp.close()

    cmd = f"""
set -e
cd {APP}
python3 - <<'PY'
from pathlib import Path
p = Path('.env')
lines = []
for line in p.read_text().splitlines():
    if line.startswith('ADMIN_TELEGRAM_IDS='):
        lines.append('ADMIN_TELEGRAM_IDS=780404501,7320923704')
    else:
        lines.append(line)
p.write_text('\\n'.join(lines) + '\\n')
print('env', [l for l in lines if 'ADMIN_TELEGRAM' in l][0])
PY
set -a; . ./.env; set +a
node scripts/ensure-admin-732.js
npm run build -w @exchange/bot
VITE_API_URL= npm run build -w @exchange/miniapp
pm2 restart exchange-api exchange-bot --update-env
sleep 2
pm2 list | grep exchange
curl -sS -o /dev/null -w 'site %{{http_code}}\\n' https://exchange.arix.vu/
"""
    _, out, _ = ssh.exec_command(cmd, timeout=400, get_pty=True)
    print(out.read().decode("utf-8", "replace")[-6000:])
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
