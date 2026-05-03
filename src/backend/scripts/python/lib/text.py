"""Text manipulation helpers shared across platform scripts."""
from __future__ import annotations

import re

HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def slugify(value: str) -> str:
    """Convert *value* to a kebab-case slug safe for file names."""
    lowered = value.strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    return lowered.strip("-") or "task"


def strip_html_comments(value: str) -> str:
    """Remove HTML/XML comment blocks from *value*."""
    return HTML_COMMENT_RE.sub("", value)


def normalize_text(lines: list[str]) -> str:
    """Strip and join non-empty *lines* into a single string."""
    cleaned = [line.strip() for line in lines if line.strip()]
    return "\n".join(cleaned).strip()


# Operator shorthand strings that mean "no items", not real list entries.
_EXTRACT_LIST_PLACEHOLDERS: frozenset[str] = frozenset({
    "none",
    "none.",
    "n/a",
    "n/a.",
    "nothing",
    "nothing.",
    "tbd",
    "tbd.",
    "(none)",
})


def extract_list(lines: list[str]) -> list[str]:
    """Extract items from markdown-style unordered lists (``- item``).

    Lines without a dash prefix are kept as-is.
    HTML comments are stripped so template placeholders are not extracted.
    Placeholder tokens such as ``None`` and ``N/A`` are dropped because
    they mean "no items" in operator-authored handoffs.
    """
    items: list[str] = []
    for line in lines:
        stripped = strip_html_comments(line).strip()
        if not stripped:
            continue
        if stripped.startswith("- "):
            stripped = stripped[2:].strip()
        if not stripped:
            continue
        if stripped.lower() in _EXTRACT_LIST_PLACEHOLDERS:
            continue
        items.append(stripped)
    return items


def extract_bullet_items(lines: list[str]) -> list[str]:
    """Extract items from ``-``, ``*``, or ``1.`` list markers."""
    items: list[str] = []
    for raw_line in lines:
        stripped = strip_html_comments(raw_line).strip()
        if not stripped:
            continue
        if stripped.startswith(("- ", "* ")):
            items.append(stripped[2:].strip())
            continue
        match = re.match(r"^\d+\.\s+(.*\S)\s*$", stripped)
        if match:
            items.append(match.group(1).strip())
    return [item for item in items if item]


def compact_text(value: str, max_length: int = 320) -> str:
    """Collapse whitespace and truncate to *max_length* with ``...``."""
    normalized = " ".join(strip_html_comments(value).split())
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 3].rstrip() + "..."


CODE_FENCE_PATTERN = re.compile(r"^```", re.MULTILINE)
COMMAND_LINE_PATTERN = re.compile(
    r"^\s*[-$>]?\s*(?:(?:cmd(?:\.exe)?\s+/c)|python3?|py|make|npm|npx|bash|sh|pytest|pip|cd|powershell(?:\.exe)?|pwsh(?:\.exe)?|\./|\.\\)\s*",
    re.MULTILINE,
)
TABLE_ROW_PATTERN = re.compile(r"^\s*\|.*\|", re.MULTILINE)


def normalize_string_list(value: object) -> list[str]:
    """Coerce *value* into a list of non-empty stripped strings.

    Accepts ``None`` (returns ``[]``), a ``str`` (comma-split), or a
    ``list``.  Raises ``SystemExit`` for other types.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [s.strip() for s in value.split(",") if s.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raise SystemExit(
        f"Expected a string or list of strings, got: {type(value).__name__}"
    )
