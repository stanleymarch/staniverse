#!/usr/bin/env python3
"""Authorize a Telethon session once, then reuse it for incremental syncs.

Two modes:
  * default: writes the file session used by `npm run telegram:update`
    (`pipeline/telegram/private/staniverse.session`, git-ignored);
  * `--string`: prints a StringSession to store as the CI secret
    `TELEGRAM_SESSION_STRING` (see .github/workflows/telegram-sync.yml).

Usage:
    TELEGRAM_API_ID=... TELEGRAM_API_HASH=... python pipeline/telegram/login.py [--string]

Telegram asks for the phone number, the login code and, if enabled, the 2FA
password. Nothing is printed except the session — the pipeline reads the same
session file afterwards.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from telethon import TelegramClient
from telethon.sessions import StringSession


async def main() -> None:
    parser = argparse.ArgumentParser(description="Authorize a Telethon session for the Staniverse pipeline")
    parser.add_argument("--channel", default="staniverse")
    parser.add_argument("--session", default=os.environ.get("TELEGRAM_SESSION", "pipeline/telegram/private/staniverse"))
    parser.add_argument("--string", action="store_true", help="print a StringSession instead of writing a file session")
    args = parser.parse_args()

    api_id, api_hash = os.environ.get("TELEGRAM_API_ID"), os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        raise SystemExit("TELEGRAM_API_ID and TELEGRAM_API_HASH are required (create them at my.telegram.org).")

    if not args.string:
        Path(args.session).parent.mkdir(parents=True, exist_ok=True)
    session = StringSession() if args.string else args.session
    client = TelegramClient(session, int(api_id), api_hash)
    await client.start()
    entity = await client.get_entity(args.channel)
    print(f"authorized for: {getattr(entity, 'title', args.channel)}")
    if args.string:
        print(client.session.save())
    else:
        print(f"session file: {args.session}.session")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
