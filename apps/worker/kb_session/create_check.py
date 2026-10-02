#!/usr/bin/env python3
"""Create CryptoBot check and (optionally) send link for username.

Usage: python create_check.py <amount_usdt> <@username>
Prints JSON: {"ok": true, "checkUrl": "https://t.me/send?start=..."} 

Requires: TELEGRAM_API_ID, TELEGRAM_API_HASH, CRYPTOBOT_SESSION
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys


async def create_check(amount: float, username: str) -> dict:
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    session = os.getenv("CRYPTOBOT_SESSION")

    if not api_id or not api_hash or not session:
        return {"ok": False, "error": "Telethon credentials not configured"}

    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except ImportError:
        return {"ok": False, "error": "telethon not installed"}

    client = TelegramClient(StringSession(session), int(api_id), api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        await client.disconnect()
        return {"ok": False, "error": "session not authorized"}

    bot = os.getenv("CRYPTOBOT_USERNAME", "CryptoBot")
    # CryptoBot UX varies; try create-check via /start then buttons.
    await client.send_message(bot, "/start")
    await asyncio.sleep(1.5)

    # Prefer Crypto Pay style deep command if available on account
    await client.send_message(bot, f"чек {amount} USDT")
    await asyncio.sleep(2.0)

    check_url = None
    async for msg in client.iter_messages(bot, limit=8):
        text = msg.message or ""
        m = re.search(r"(https://t\.me/(?:send|CryptoBot)[^\s)]+)", text)
        if m:
            check_url = m.group(1)
            break
        if msg.buttons:
            for row in msg.buttons:
                for btn in row:
                    url = getattr(btn, "url", None) or ""
                    if "t.me/send" in url or "start=" in url:
                        check_url = url
                        break
                if check_url:
                    break

    if check_url and username:
        # Forward / send check link to destination user if possible
        try:
            uname = username.lstrip("@")
            await client.send_message(uname, f"Ваш чек на {amount} USDT:\n{check_url}")
        except Exception as e:
            # Check created but DM failed — still ok for operator to deliver
            await client.disconnect()
            return {
                "ok": True,
                "checkUrl": check_url,
                "warning": f"dm_failed: {e}",
            }

    await client.disconnect()
    if not check_url:
        return {
            "ok": False,
            "error": "Не удалось создать чек через сессию — выдайте вручную в админке",
        }
    return {"ok": True, "checkUrl": check_url}


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: create_check.py <amount> <@user>"}))
        sys.exit(1)
    amount = float(sys.argv[1].replace(",", "."))
    username = sys.argv[2]
    result = asyncio.run(create_check(amount, username))
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
