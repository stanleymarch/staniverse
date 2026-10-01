#!/usr/bin/env python3
"""Resolve the private life channel entity once and pin it in the life state.

The channel reference (numeric id, t.me link or invite hash) lives in
LIFE_CHANNEL_REF inside .env — never in code, never in git. Prints the numeric
entity id only; the nightly fetch passes it to fetch_new.py --channel, and
Telegram itself resolves the access hash from the local session.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest
from telethon.tl.types import ChatInvite, ChatInviteAlready


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def invite_hash_of(ref: str) -> str | None:
    match = re.search(r"t\.me/(?:\+|joinchat/)([A-Za-z0-9_-]+)", ref)
    return match.group(1) if match else None


async def resolve(args: argparse.Namespace) -> dict[str, Any]:
    api_id, api_hash = os.environ.get("TELEGRAM_API_ID"), os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        raise SystemExit("TELEGRAM_API_ID and TELEGRAM_API_HASH are required (create them at my.telegram.org).")
    ref = os.environ.get("LIFE_CHANNEL_REF", "")
    session_string = os.environ.get("TELEGRAM_SESSION_STRING")
    session: Any = StringSession(session_string) if session_string else args.session
    async with TelegramClient(session, int(api_id), api_hash) as client:
        entity = None
        if ref.lstrip("-").isdigit():
            entity = await client.get_entity(int(ref))
        elif ref:
            invite = invite_hash_of(ref)
            if invite:
                # For a channel this account already belongs to, the check returns
                # the chat itself; a preview means nobody joined yet — the invite
                # is our own channel, so joining is the resolution.
                checked = await client(CheckChatInviteRequest(invite))
                if isinstance(checked, ChatInviteAlready):
                    entity = checked.chat
                elif isinstance(checked, ChatInvite):
                    joined = await client(ImportChatInviteRequest(invite))
                    entity = getattr(joined, "chat", None)
                    if entity is None:
                        chats = getattr(joined, "chats", None) or []
                        entity = next((chat for chat in chats if getattr(chat, "is_channel", False)), chats[0] if chats else None)
            else:
                try:
                    entity = await client.get_entity(ref)
                except Exception:
                    entity = None
        if entity is None:
            title = os.environ.get("LIFE_CHANNEL_TITLE", "")
            async for dialog in client.iter_dialogs():
                if title and dialog.title == title:
                    entity = dialog.entity
                    break
        if entity is None:
            raise SystemExit("Life channel not found: set LIFE_CHANNEL_REF or LIFE_CHANNEL_TITLE in .env (see pipeline/telegram/private/LIFE-OPS.md).")
        return {"entityId": getattr(entity, "id", None)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Pin the private life channel entity id for the nightly fetch")
    parser.add_argument("--state", default="pipeline/telegram/archive/life/source/state.json")
    parser.add_argument("--session", default=os.environ.get("TELEGRAM_SESSION", "pipeline/telegram/private/staniverse"))
    args = parser.parse_args()
    load_dotenv(Path(".env"))
    resolved = asyncio.run(resolve(args))
    state_path = Path(args.state)
    state: dict[str, Any] = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    state.update({"version": 1, "channel": "life", **resolved})
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"entityId": resolved["entityId"], "state": str(state_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
