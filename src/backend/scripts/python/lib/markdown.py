"""Markdown parsing helpers shared across platform scripts."""
from __future__ import annotations

import logging

from .markdown_contract import load_markdown_contract
from .text import strip_html_comments

_CONTRACT = load_markdown_contract()
SECTION_HEADING = _CONTRACT.compiled.heading
METADATA_LINE = _CONTRACT.compiled.label
LOGGER = logging.getLogger(__name__)


def parse_sections(text: str) -> dict[str, list[str]]:
    """Split markdown *text* on ``## Heading`` lines.

    Returns ``{heading: [body_lines]}`` preserving order.
    """
    sections: dict[str, list[str]] = {}
    current: str | None = None
    in_fence: str | None = None
    for raw_line in text.splitlines():
        if in_fence and raw_line.strip() == in_fence:
            in_fence = None
        else:
            fence_match = _CONTRACT.compiled.fence_open.match(raw_line)
            if fence_match:
                in_fence = fence_match.group(_CONTRACT.groups["fenceMarker"])

        match = None if in_fence else SECTION_HEADING.match(raw_line.strip())
        if match:
            current = match.group(_CONTRACT.groups["headingName"]).strip()
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(raw_line.rstrip("\n"))
    return sections


def parse_metadata(lines: list[str], section_name: str = "unknown") -> dict[str, str]:
    """Extract ``- key: value`` pairs from *lines*."""
    values: dict[str, str] = {}
    warned_labels: set[str] = set()
    for line in lines:
        match = METADATA_LINE.match(line.strip())
        if match:
            label = match.group(_CONTRACT.groups["labelName"])
            if label in values:
                if label not in warned_labels:
                    LOGGER.warning('Duplicate label "%s" in section "%s"; using first value.', label, section_name)
                    warned_labels.add(label)
                continue
            values[label] = strip_html_comments(match.group(_CONTRACT.groups["labelValue"])).strip()
    return values
