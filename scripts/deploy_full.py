#!/usr/bin/env python3
"""Full deploy to exchange.arix.vu. Usage:
  set EXCHANGE_SSH_PASSWORD=...
  python scripts/deploy_full.py
"""
from __future__ import annotations

import io
import os
import sys
import tarfile
import time

import paramiko

HOST = "144.31.151.112"
USER = "root"
PASSWORD = os.environ.get("EXCHANGE_SSH_PASSWORD", "").strip()
APP = "/var/www/exchange.arix.vu"
LOCAL = os.environ.get("EXCHANGE_LOCAL_ROOT", r"D:\codes\exchange crypto")

SKIP_DIRS = {"node_modules", ".git", ".history", "sow", "dist", "build", ".next", "coverage"}


def pack() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(LOCAL):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in files:
                if name in {".env", ".env.local", ".env.production"}:
                    continue
                if name.endswith((".log", ".db", ".db-journal")):
                    continue
                full = os.path.join(root, name)
                rel = os.path.relpath(full, LOCAL).replace("\\", "/")
                tar.add(full, arcname=rel)
    return buf.getvalue()


def main() -> int:
    if not PASSWORD:
        print("Set EXCHANGE_SSH_PASSWORD", file=sys.stderr)
        return 2

    print("packing…")
    blob = pack()
    print(f"size {len(blob)/1e6:.1f} MB")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(5):
        try:
            ssh.connect(
                HOST,
                username=USER,
                password=PASSWORD,
                timeout=30,
                banner_timeout=45,
                auth_timeout=45,
                look_for_keys=False,
                allow_agent=False,
            )
            break
        except Exception as e:
            print(f"ssh retry {attempt+1}: {e}")
            time.sleep(3)
    else:
        return 1

    print("connected")
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/ex-full.tar.gz", "wb") as f:
        f.write(blob)
    sftp.close()

    cmd = f"""
set -e
cd {APP}
tar -xzf /tmp/ex-full.tar.gz
# keep existing .env secrets; only ensure flags
grep -q '^CHAIN_POLL_ENABLED=' .env || echo 'CHAIN_POLL_ENABLED=true' >> .env
grep -q '^API_URL=' .env || echo 'API_URL=https://exchange.arix.vu' >> .env
# INTERNAL_API_KEY optional — auto-derived from BOT_TOKEN
npm ci --prefer-offline --no-audit --no-fund 2>/dev/null || npm ci --no-audit --no-fund
npm run db:generate
DATABASE_URL="file:{APP}/data/prod.db" npx prisma db push --schema=packages/db/prisma/schema.prisma --skip-generate
npm run build:server
VITE_API_URL= npm run build -w @exchange/miniapp
pm2 restart exchange-api exchange-bot --update-env
sleep 3
pm2 list
curl -sS http://127.0.0.1:3010/api/health; echo
curl -sS -o /dev/null -w 'site %{{http_code}}\\n' https://exchange.arix.vu/
pm2 logs exchange-api --lines 8 --nostream
pm2 logs exchange-bot --lines 8 --nostream
"""
    print("remote build…")
    _, stdout, _ = ssh.exec_command(cmd, timeout=1800, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    print(out[-8000:] if len(out) > 8000 else out)
    code = stdout.channel.recv_exit_status()
    ssh.close()
    print("exit", code)
    return code


if __name__ == "__main__":
    sys.exit(main())
