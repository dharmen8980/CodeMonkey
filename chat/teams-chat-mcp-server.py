"""MCP server exposing an exported Teams chat as a searchable tool for the chat container.

Read-only: it never talks to Microsoft Graph, only a JSON file exported ahead of time by
teams-chat-export/export_chat.py and bind-mounted read-only into this container (see
lib/chat/container.js and entrypoint.sh). This is supplementary team-discussion context
(decisions-in-progress, action items) -- NOT a requirements source. RAGFlow stays the sole
authoritative source for BRD/requirements/roles/permissions/workflows; see CLAUDE.md.
"""

from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path

from mcp.server.fastmcp import FastMCP

EXPORT_PATH = Path(os.environ.get("TEAMS_CHAT_EXPORT_PATH", "/workspace/exports/Team Chat.json"))
CHAT_LABEL = os.environ.get("TEAMS_CHAT_LABEL", "Team Chat")

mcp = FastMCP("teams-chat")

_TAG_RE = re.compile(r"<[^>]+>")
_BLANK_LINES_RE = re.compile(r"\n[ \t]*\n[ \t]*\n+")


def _readable_body(body: dict | None) -> str:
    if not isinstance(body, dict) or not isinstance(body.get("content"), str):
        return ""
    content = body["content"]
    if str(body.get("contentType", "")).lower() != "html":
        return content.strip()
    text = html.unescape(_TAG_RE.sub("", content))
    return _BLANK_LINES_RE.sub("\n\n", text).strip()


def _load_messages() -> list[dict]:
    if not EXPORT_PATH.is_file():
        raise FileNotFoundError(
            f"No export mounted at {EXPORT_PATH}. Rerun export_chat.py on the host and "
            "restart this chat container."
        )
    with EXPORT_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError(f"{EXPORT_PATH} is not a valid chat export (expected a JSON array).")
    return data


def _format(message: dict) -> str:
    sender = ((message.get("from") or {}).get("user") or {}).get("displayName")
    author = sender or "Unknown author"
    timestamp = message.get("createdDateTime", "unknown time")
    text = _readable_body(message.get("body")) or "(no text body)"
    attachments = [a.get("name") for a in (message.get("attachments") or []) if a.get("name")]
    line = f"[{timestamp}] {author}: {text}"
    if attachments:
        line += f" (attachments: {', '.join(attachments)})"
    return line


@mcp.tool()
def search_teams_chat(
    query: str = "",
    author: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 30,
) -> str:
    """Search the exported team standup chat for messages.

    Non-authoritative team discussion, not verified requirements -- for BRD, roles,
    permissions, or workflow rules use the ragflow tool instead. Useful for surfacing
    decisions, context, or action items mentioned in standup chat.

    Args:
        query: Case-insensitive substring to match against message text or author name. Empty matches all.
        author: Case-insensitive substring to filter by sender display name.
        date_from: ISO date/datetime (e.g. "2026-09-20") lower bound, inclusive.
        date_to: ISO date/datetime upper bound, inclusive.
        limit: Maximum number of matches to return (most recent first).
    """
    messages = _load_messages()
    needle = query.strip().lower()
    author_needle = author.strip().lower()

    matches = []
    for message in messages:
        created = message.get("createdDateTime") or ""
        if date_from and created < date_from:
            continue
        if date_to and created > date_to + "￿":
            continue
        sender = ((message.get("from") or {}).get("user") or {}).get("displayName", "")
        if author_needle and author_needle not in sender.lower():
            continue
        text = _readable_body(message.get("body"))
        if needle and needle not in text.lower() and needle not in sender.lower():
            continue
        matches.append(message)

    matches.sort(key=lambda m: m.get("createdDateTime") or "", reverse=True)
    matches = matches[: max(1, min(limit, 200))]
    if not matches:
        return f"No messages in '{CHAT_LABEL}' matched that search."
    return "\n".join(_format(m) for m in matches)


@mcp.tool()
def latest_teams_chat_messages(limit: int = 10) -> str:
    """Return the most recent messages from the exported team standup chat, newest first."""
    messages = _load_messages()
    messages.sort(key=lambda m: m.get("createdDateTime") or "", reverse=True)
    messages = messages[: max(1, min(limit, 200))]
    if not messages:
        return f"'{CHAT_LABEL}' export has no messages."
    return "\n".join(_format(m) for m in messages)


if __name__ == "__main__":
    mcp.run(transport="stdio")
