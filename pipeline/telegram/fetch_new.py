#!/usr/bin/env python3
"""Fetch only Telegram messages newer than the committed manual baseline.

Secrets and the Telethon session stay in pipeline/telegram/private (gitignored).
The output deliberately follows Telegram Desktop's neutral result.json shape so
the TypeScript normalizer remains the only content parser.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient
from telethon.extensions import markdown
from telethon.sessions import StringSession
from telethon.tl import functions


def iso(value: datetime | None) -> str:
    if value is None:
        value = datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def load_json(path: Path, default: Any) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def rich_text(node: Any) -> dict[str, Any]:
    name = type(node).__name__
    if node is None or name == "TextEmpty":
        return {"type": "plain", "text": ""}
    if name == "TextPlain":
        return {"type": "plain", "text": node.text}
    if name == "TextConcat":
        return {"type": "concat", "text": [rich_text(item) for item in node.texts]}
    child = rich_text(getattr(node, "text", None))
    if name == "TextBold":
        return {"type": "bold", "text": child}
    if name == "TextItalic":
        return {"type": "italic", "text": child}
    if name == "TextFixed":
        return {"type": "code", "text": child}
    if name == "TextUrl":
        return {"type": "text_link", "href": node.url, "text": child}
    if name == "TextEmail":
        return {"type": "text_link", "href": f"mailto:{node.email}", "text": child}
    return child


def rich_block(block: Any, photos: dict[int, str]) -> list[dict[str, Any]]:
    name = type(block).__name__
    # Current layers name article headings PageBlockHeading1..6; the export snapshot
    # uses the older PageBlockTitle/Header set. Both must land as one "heading" node.
    if name.startswith("PageBlockHeading") and name[-1].isdigit():
        return [{"type": "heading", "level": int(name[-1]), "text": rich_text(getattr(block, "text", None))}]
    headings = {"PageBlockTitle": 1, "PageBlockHeader": 2, "PageBlockSubheader": 3, "PageBlockKicker": 4, "PageBlockSubtitle": 2}
    if name in headings:
        return [{"type": "heading", "level": headings[name], "text": rich_text(block.text)}]
    if name in {"PageBlockParagraph", "PageBlockFooter", "PageBlockPreformatted", "PageBlockBlockquote", "PageBlockPullquote"}:
        text = rich_text(getattr(block, "text", None))
        if name == "PageBlockPreformatted":
            text = {"type": "code", "text": text}
        return [{"type": "paragraph", "text": text}]
    if name == "PageBlockPhoto":
        path = photos.get(int(block.photo_id))
        if not path:
            return []
        node: dict[str, Any] = {"type": "photo", "photo": path}
        caption = rich_text(getattr(block, "caption", None))
        if caption.get("text"):
            node["caption"] = caption
        return [node]
    if name in {"PageBlockCollage", "PageBlockSlideshow"}:
        items = [node for item in block.items for node in rich_block(item, photos)]
        return [{"type": "slideshow", "items": items}]
    if name == "PageBlockCover":
        return rich_block(block.cover, photos)
    nested = getattr(block, "blocks", None) or getattr(block, "items", None)
    if nested:
        return [node for item in nested for node in rich_block(getattr(item, "item", item), photos)]
    return []


async def rich_message_payload(client: TelegramClient, message: Any, media_dir: Path) -> dict[str, Any] | None:
    """Telegram Articles carry their body on the message itself (`rich_message`),
    not in a webpage cached page. Both use the same PageBlock/Text node types, so
    the blocks take the same path — only the photos need downloading here."""
    rich = getattr(message, "rich_message", None)
    if rich is None:
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    photos: dict[int, str] = {}
    for photo in getattr(rich, "photos", []) or []:
        downloaded = await client.download_media(photo, file=media_dir)
        if downloaded:
            photos[int(photo.id)] = Path(downloaded).resolve().relative_to(media_dir.parent.resolve()).as_posix()
    blocks = [node for block in (getattr(rich, "blocks", []) or []) for node in rich_block(block, photos)]
    return {"rtl": bool(getattr(rich, "rtl", False)), "part": bool(getattr(rich, "part", False)), "blocks": blocks} if blocks else None


async def cached_page_payload(client: TelegramClient, message: Any, media_dir: Path) -> dict[str, Any] | None:
    webpage = getattr(getattr(message, "media", None), "webpage", None)
    page = getattr(webpage, "cached_page", None)
    if page is None:
        return None
    if getattr(page, "part", False) and getattr(webpage, "url", None):
        full = await client(functions.messages.GetWebPageRequest(url=webpage.url, hash=0))
        page = getattr(getattr(full, "webpage", None), "cached_page", page)
    media_dir.mkdir(parents=True, exist_ok=True)
    photos: dict[int, str] = {}
    for photo in getattr(page, "photos", []):
        downloaded = await client.download_media(photo, file=media_dir)
        if downloaded:
            photos[int(photo.id)] = Path(downloaded).resolve().relative_to(media_dir.parent.resolve()).as_posix()
    blocks = [node for block in getattr(page, "blocks", []) for node in rich_block(block, photos)]
    return {"rtl": bool(getattr(page, "rtl", False)), "part": bool(getattr(page, "part", False)), "blocks": blocks} if blocks else None


async def serialize_message(client: TelegramClient, message: Any, output: Path) -> dict[str, Any]:
    item: dict[str, Any] = {"id": message.id, "type": "message", "date": iso(message.date)}
    if message.edit_date:
        item["edited"] = iso(message.edit_date)
    if message.entities:
        item["text"] = markdown.unparse(message.raw_text or "", message.entities)
    else:
        item["text"] = message.raw_text or ""
    if message.grouped_id:
        item["grouped_id"] = int(message.grouped_id)
    reply_id = getattr(getattr(message, "reply_to", None), "reply_to_msg_id", None)
    if reply_id:
        item["reply_to_message_id"] = int(reply_id)
    rich = await rich_message_payload(client, message, output / "media") or await cached_page_payload(client, message, output / "media")
    if rich:
        item["rich_message"] = rich
    if message.photo or message.document or message.video or message.audio or message.voice:
        media_dir = output / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        downloaded = await client.download_media(message, file=media_dir)
        if downloaded:
            relative = Path(downloaded).resolve().relative_to(output.resolve()).as_posix()
            mime = getattr(getattr(message, "file", None), "mime_type", None) or mimetypes.guess_type(downloaded)[0]
            key = "photo" if message.photo else "video_file" if message.video else "audio_file" if message.audio else "voice_message" if message.voice else "file"
            item[key] = relative
            if mime:
                item["mime_type"] = mime
    return item


def committed_baseline(canonical: Path) -> int:
    """Fallback baseline for a machine that lost its local state file: the highest
    message id already materialized as a site page inside the canonical archive."""
    archive = load_json(canonical, {})
    ids: list[int] = []
    for publication in archive.get("publications", []):
        for value in [publication.get("sourceId"), *(publication.get("threadIds") or [])]:
            if str(value or "").isdigit():
                ids.append(int(value))
    return max(ids, default=0)


async def fetch(args: argparse.Namespace) -> dict[str, Any]:
    api_id, api_hash = os.environ.get("TELEGRAM_API_ID"), os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        raise SystemExit("TELEGRAM_API_ID and TELEGRAM_API_HASH are required (create them at my.telegram.org).")
    state = load_json(Path(args.state), None)
    if state is None:
        state = {"lastMessageId": committed_baseline(Path(args.canonical))}
    since_id = args.since_id if args.since_id is not None else int(state.get("lastMessageId", 0))
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    messages: list[dict[str, Any]] = []
    # CI stores an exported StringSession; a local run keeps the file session.
    session_string = os.environ.get("TELEGRAM_SESSION_STRING")
    session: Any = StringSession(session_string) if session_string else args.session
    async with TelegramClient(session, int(api_id), api_hash) as client:
        entity = await client.get_entity(args.channel)
        async for message in client.iter_messages(entity, min_id=since_id, reverse=True):
            if message:
                messages.append(await serialize_message(client, message, output))
        payload = {"name": getattr(entity, "title", args.channel), "id": getattr(entity, "id", None), "type": "public_channel", "messages": messages}
    (output / "result.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"sinceId": since_id, "added": len(messages), "lastId": max([since_id, *[item["id"] for item in messages]]), "output": str(output)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch new Telegram posts after the Staniverse baseline")
    parser.add_argument("--channel", default="staniverse")
    parser.add_argument("--state", default="pipeline/telegram/archive/source/state.json")
    parser.add_argument("--canonical", default="pipeline/telegram/archive/canonical.json")
    parser.add_argument("--output", default="pipeline/telegram/archive/incoming")
    parser.add_argument("--session", default=os.environ.get("TELEGRAM_SESSION", "pipeline/telegram/private/staniverse"))
    parser.add_argument("--since-id", type=int)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(fetch(args)), ensure_ascii=False))


if __name__ == "__main__":
    main()
