#!/usr/bin/env python3
import os
import sys
from pathlib import Path

import paramiko

HOST = "144.31.151.112"
USER = "root"
PASSWORD = os.environ.get("EXCHANGE_SSH_PASSWORD", "")
APP = "/var/www/exchange.arix.vu"
LOCAL = Path(r"D:\codes\exchange crypto")

FILES = [
    "apps/miniapp/src/App.tsx",
    "apps/miniapp/src/main.tsx",
    "apps/miniapp/src/components/AppShell.tsx",
    "apps/miniapp/src/lib/auth.tsx",
    "apps/miniapp/src/pages/Home.tsx",
    "apps/miniapp/src/styles.css",
    "apps/miniapp/index.html",
    "apps/miniapp/vite.config.ts",
    "packages/shared/theme.css",
    "scripts/ensure-admin-732.js",
]


def run(ssh, cmd, timeout=300):
    print("===", cmd[:180].replace("\n", " "))
    _, stdout, _ = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    sys.stdout.write(out[-8000:] if len(out) > 8000 else out)
    print("\nexit", code)
    return code


def main():
    if not PASSWORD:
        print("Set EXCHANGE_SSH_PASSWORD", file=sys.stderr)
        return 2

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30, banner_timeout=30)
    sftp = ssh.open_sftp()

    for rel in FILES:
        local = LOCAL / rel
        remote = f"{APP}/{rel.replace(chr(92), '/')}"
        parts = remote.split("/")
        for i in range(2, len(parts)):
            d = "/".join(parts[:i])
            try:
                sftp.stat(d)
            except FileNotFoundError:
                try:
                    sftp.mkdir(d)
                except OSError:
                    pass
        with sftp.file(remote, "wb") as f:
            f.write(local.read_bytes())
        print("uploaded", rel)

    sftp.close()

    run(
        ssh,
        f"""python3 - <<'PY'
from pathlib import Path
p = Path('{APP}/.env')
text = p.read_text()
lines = []
found = False
for line in text.splitlines():
    if line.startswith('ADMIN_TELEGRAM_IDS='):
        found = True
        ids = [x.strip() for x in line.split('=',1)[1].split(',') if x.strip()]
        for add in ['780404501', '732092704']:
            if add not in ids:
                ids.append(add)
        lines.append('ADMIN_TELEGRAM_IDS=' + ','.join(ids))
    else:
        lines.append(line)
if not found:
    lines.append('ADMIN_TELEGRAM_IDS=780404501,732092704')
p.write_text('\\n'.join(lines) + '\\n')
print([l for l in lines if l.startswith('ADMIN_TELEGRAM_IDS=')][0])
PY""",
    )

    code = run(
        ssh,
        f"""
set -e
cd {APP}
node scripts/ensure-admin-732.js
VITE_API_URL= npm run build -w @exchange/miniapp
pm2 restart exchange-api exchange-bot --update-env
sleep 2
pm2 list | grep exchange || true
curl -sS -o /dev/null -w 'site %{{http_code}}\\n' https://exchange.arix.vu/
ls -la apps/miniapp/dist | head -8
""",
        timeout=400,
    )

    ssh.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
