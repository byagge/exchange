#!/usr/bin/env python3
"""Activate CryptoBot / @send check via Telethon user session.

Usage: python activate_check.py <check_url>
Prints JSON: {"ok": true, "amount": 10.5} or {"ok": false, "error": "..."}

Requires env:
  TELEGRAM_API_ID, TELEGRAM_API_HASH, CRYPTOBOT_SESSION (string session)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys


async def activate(check_url: str) -> dict:
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

    # Open check deep-link by messaging CryptoBot start payload
    m = re.search(r"start=([A-Za-z0-9_\-]+)", check_url)
    if not m:
        await client.disconnect()
        return {"ok": False, "error": "cannot parse check payload"}

    payload = m.group(1)
    bot_username = os.getenv("CRYPTOBOT_USERNAME", "CryptoBot")
    await client.send_message(bot_username, f"/start {payload}")

    # Wait briefly for bot response and try to parse amount
    await asyncio.sleep(2.5)
    amount = None
    async for msg in client.iter_messages(bot_username, limit=5):
        text = msg.message or ""
        am = re.search(r"([\d]+[.,][\d]+|\d+)\s*USDT", text, re.I)
        if am:
            amount = float(am.group(1).replace(",", "."))
            break
        # Confirm buttons if present
        if msg.buttons:
            try:
                await msg.click(0)
                await asyncio.sleep(1.5)
            except Exception:
                pass

    await client.disconnect()
    if amount is None:
        # Check may still be activated; amount can be reconciled later
        return {"ok": True, "amount": 0}
    return {"ok": True, "amount": amount}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "check_url required"}))
        sys.exit(1)
    result = asyncio.run(activate(sys.argv[1]))
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
