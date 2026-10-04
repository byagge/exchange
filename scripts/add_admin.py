#!/usr/bin/env python3
import os
import sys

import paramiko

PASSWORD = os.environ.get("EXCHANGE_SSH_PASSWORD", "")
ADMIN_ID = sys.argv[1] if len(sys.argv) > 1 else "6817471800"
APP = "/var/www/exchange.arix.vu"


def main():
    if not PASSWORD:
        print("Set EXCHANGE_SSH_PASSWORD", file=sys.stderr)
        return 2

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect("144.31.151.112", username="root", password=PASSWORD, timeout=30, banner_timeout=30)

    cmd = f"""
set -e
cd {APP}
python3 - <<'PY'
from pathlib import Path
p = Path('.env')
add = '{ADMIN_ID}'
lines = []
found = False
for line in p.read_text().splitlines():
    if line.startswith('ADMIN_TELEGRAM_IDS='):
        found = True
        ids = [x.strip() for x in line.split('=',1)[1].split(',') if x.strip()]
        if add not in ids:
            ids.append(add)
        lines.append('ADMIN_TELEGRAM_IDS=' + ','.join(ids))
    else:
        lines.append(line)
if not found:
    lines.append('ADMIN_TELEGRAM_IDS=' + add)
p.write_text('\\n'.join(lines) + '\\n')
print([l for l in lines if l.startswith('ADMIN_TELEGRAM_IDS=')][0])
PY
set -a; . ./.env; set +a
node <<'NODE'
const {{ PrismaClient }} = require('./packages/db/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {{
  const id = BigInt('{ADMIN_ID}');
  const u = await p.user.upsert({{
    where: {{ telegramId: id }},
    create: {{
      telegramId: id,
      referralCode: 'ADM' + String(id).slice(-4),
      isAdmin: true,
      rulesAcceptedAt: new Date(),
      firstName: 'Admin',
    }},
    update: {{ isAdmin: true }},
  }});
  console.log('admin', String(u.telegramId), u.isAdmin);
  await p.$disconnect();
}})().catch((e) => {{ console.error(e); process.exit(1); }});
NODE
pm2 restart exchange-api exchange-bot --update-env
sleep 1
pm2 list | grep exchange || true
"""
    _, out, _ = ssh.exec_command(cmd, timeout=90, get_pty=True)
    print(out.read().decode("utf-8", "replace"))
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
