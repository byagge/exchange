#!/usr/bin/env python3
"""Deploy exchange to /var/www/exchange.arix.vu without touching other sites."""
from __future__ import annotations

import io
import os
import posixpath
import secrets
import sys
import tarfile
import time

import paramiko

HOST = os.environ.get("EXCHANGE_HOST", "144.31.151.112")
USER = os.environ.get("EXCHANGE_SSH_USER", "root")
PASSWORD = os.environ.get("EXCHANGE_SSH_PASSWORD", "")
APP_ROOT = "/var/www/exchange.arix.vu"
LOCAL_ROOT = os.environ.get("EXCHANGE_LOCAL_ROOT", r"D:\codes\exchange crypto")

EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    ".history",
    "sow",
    "dist",
    "build",
    ".next",
    "coverage",
    ".turbo",
}
EXCLUDE_FILES = {".env", ".env.local", ".env.production"}


def should_skip(path: str) -> bool:
    parts = path.replace("\\", "/").split("/")
    if any(p in EXCLUDE_DIRS for p in parts):
        return True
    base = os.path.basename(path)
    if base in EXCLUDE_FILES:
        return True
    if base.endswith(".log") or base.endswith(".tsbuildinfo"):
        return True
    return False


def make_tarball() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(LOCAL_ROOT):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".git")]
            for name in files:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, LOCAL_ROOT)
                if should_skip(rel):
                    continue
                tar.add(full, arcname=rel.replace("\\", "/"))
    return buf.getvalue()


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()

    def safe(s: str) -> str:
        return s.encode("ascii", "replace").decode("ascii")

    if out.strip():
        chunk = out[-4000:] if len(out) > 4000 else out
        print(safe(chunk))
    if err.strip():
        chunk = err[-2000:] if len(err) > 2000 else err
        print(safe(chunk))
    return code, out, err


def main() -> int:
    if not PASSWORD:
        print("Set EXCHANGE_SSH_PASSWORD", file=sys.stderr)
        return 2
    print("Packing…")
    blob = make_tarball()
    print(f"Archive size: {len(blob) / 1e6:.1f} MB")

    jwt = secrets.token_urlsafe(48)
    enc = secrets.token_hex(32)
    admin_pass = secrets.token_urlsafe(16)

    # Read BOT_TOKEN from local .env
    bot_token = ""
    local_env = os.path.join(LOCAL_ROOT, ".env")
    with open(local_env, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("BOT_TOKEN="):
                bot_token = line.split("=", 1)[1].strip()
            if line.startswith("ADMIN_TELEGRAM_IDS="):
                admin_ids = line.split("=", 1)[1].strip()
            if line.startswith("BOT_USERNAME="):
                bot_user = line.split("=", 1)[1].strip()
    admin_ids = locals().get("admin_ids", "780404501")
    bot_user = locals().get("bot_user", "ExchangeCryptoTGBot")

    env_body = f"""DATABASE_URL=file:{APP_ROOT}/data/prod.db
REDIS_URL=redis://127.0.0.1:6379
API_HOST=127.0.0.1
API_PORT=3010
API_URL=https://exchange.arix.vu
JWT_SECRET={jwt}
JWT_EXPIRES_IN=7d
ENCRYPTION_KEY={enc}
BOT_TOKEN={bot_token}
BOT_USERNAME={bot_user}
WEBAPP_URL=https://exchange.arix.vu
ADMIN_URL=https://exchange.arix.vu
ADMIN_EMAIL=admin@exchange.arix.vu
ADMIN_PASSWORD={admin_pass}
ADMIN_TELEGRAM_IDS={admin_ids}
ALLOW_DEPOSIT_SIMULATE=false
ALLOW_DEV_AUTH=false
ALLOW_MOCK_PAYOUTS=false
NODE_ENV=production
TON_HD_MNEMONIC=
TRON_HD_MNEMONIC=
TON_API_KEY=
TRONGRID_API_KEY=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
CRYPTOBOT_SESSION=
CRYPTOBOT_USERNAME=CryptoBot
MASTER_TON_ADDRESS=
MASTER_TRC20_ADDRESS=
SWEEP_THRESHOLD_USDT=50
DEFAULT_USDT_RUB_RATE=98.01
CORS_ORIGINS=https://exchange.arix.vu
"""

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {HOST}…")
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    # Safety: never touch textcheck
    code, out, _ = run(ssh, "ls /etc/nginx/sites-enabled/; test -d /var/www/textcheck && echo TEXTCHECK_OK")
    if "textcheck" not in out:
        print("WARN: textcheck site listing unexpected — continuing carefully")

    run(ssh, f"mkdir -p {APP_ROOT} {APP_ROOT}/data {APP_ROOT}/uploads /var/log/exchange /tmp/exchange-deploy")

    sftp = ssh.open_sftp()
    remote_tar = "/tmp/exchange-deploy/app.tar.gz"
    print("Uploading archive…")
    with sftp.file(remote_tar, "wb") as rf:
        rf.write(blob)

    # Write env only if missing (preserve secrets on redeploy) OR always overwrite for first deploy
    env_path = f"{APP_ROOT}/.env"
    try:
        sftp.stat(env_path)
        print(".env exists — keeping existing secrets")
        keep_env = True
    except FileNotFoundError:
        keep_env = False

    if not keep_env:
        with sftp.file(env_path, "w") as ef:
            ef.write(env_body)
        sftp.chmod(env_path, 0o600)
        print("Wrote new .env")
        print(f"ADMIN_PASSWORD={admin_pass}")

    sftp.close()

    # Extract into APP_ROOT (overwrite code, keep data/uploads/.env)
    cmds = f"""
set -e
cd {APP_ROOT}
tar -xzf {remote_tar}
chmod +x deploy/setup-server.sh
bash deploy/setup-server.sh
"""
    code, out, err = run(ssh, cmds, timeout=1800)
    ssh.close()
    if code != 0:
        print(f"FAILED exit={code}")
        return code
    print("DEPLOY OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
