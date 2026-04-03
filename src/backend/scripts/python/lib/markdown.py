"""Markdown parsing helpers shared across platform scripts."""
from __future__ import annotations

import re

from .text import strip_html_comments

SECTION_HEADING = re.compile(r"^##\s+(.*\S)\s*$")
METADATA_LINE = re.compile(r"^-\s+([^:]+):\s*(.*)$")


def parse_sections(text: str) -> dict[str, list[str]]:
    """Split markdown *text* on ``## Heading`` lines.

    Returns ``{heading: [body_lines]}`` preserving order.
    """
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        match = SECTION_HEADING.match(raw_line.strip())
        if match:
            current = match.group(1)
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(raw_line.rstrip("\n"))
    return sections


def parse_metadata(lines: list[str]) -> dict[str, str]:
    """Extract ``- key: value`` pairs from *lines*."""
    values: dict[str, str] = {}
    for line in lines:
        match = METADATA_LINE.match(line.strip())
        if match:
            values[match.group(1)] = strip_html_comments(match.group(2)).strip()
    return values
