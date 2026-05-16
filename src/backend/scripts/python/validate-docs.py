#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse

from lib.protocol_output import write_protocol_stderr, write_protocol_stdout

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.scripts.python.lib.logging_config import configure_logging  # noqa: E402

IGNORED_PREFIXES = (
    "AgentWorkSpace/dropbox/",
    "AgentWorkSpace/pendingitems/",
)
LINK_PATTERN = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
CODE_FENCE_PATTERN = re.compile(r"^(```|~~~)")


def tracked_markdown_files() -> list[Path]:
    try:
        output = subprocess.check_output(
            [
                "git",
                "-C",
                str(ROOT_DIR),
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "*.md",
            ],
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        files = [path for path in ROOT_DIR.rglob("*.md") if path.is_file()]
        return sorted(files)

    results: list[Path] = []
    for line in output.splitlines():
        if not line or line.startswith(IGNORED_PREFIXES):
            continue
        candidate = ROOT_DIR / line
        if candidate.is_file():
            results.append(candidate)
    return sorted(results)


def strip_inline_code(text: str) -> str:
    return re.sub(r"`[^`]*`", "", text)


def extract_headings(markdown_text: str) -> dict[str, int]:
    anchors: Counter[str] = Counter()
    heading_map: dict[str, int] = {}
    in_code_block = False
    in_front_matter = False

    for index, raw_line in enumerate(markdown_text.splitlines(), start=1):
        line = raw_line.rstrip("\n")
        if index == 1 and line.strip() == "---":
            in_front_matter = True
            continue
        if in_front_matter:
            if line.strip() == "---":
                in_front_matter = False
            continue
        if CODE_FENCE_PATTERN.match(line.strip()):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        match = HEADING_PATTERN.match(line)
        if not match:
            continue

        slug = github_slug(match.group(2), anchors)
        heading_map[slug] = index

    return heading_map


def github_slug(heading: str, anchors: Counter[str]) -> str:
    slug = heading.strip().lower()
    slug = strip_inline_code(slug)
    slug = re.sub(r"[!\"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        slug = "section"

    count = anchors[slug]
    anchors[slug] += 1
    if count:
        return f"{slug}-{count}"
    return slug


def normalize_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    return unquote(target)


def resolve_link_target(
    source_file: Path,
    target: str,
) -> tuple[Path | None, str | None]:
    parsed = urlparse(target)
    if parsed.scheme or target.startswith("//"):
        return None, None

    if target.startswith("#"):
        return source_file, target[1:]

    path_part, _, anchor = target.partition("#")
    if not path_part:
        return source_file, anchor or None

    if path_part.startswith("/"):
        resolved_path = (ROOT_DIR / path_part.lstrip("/")).resolve()
    else:
        resolved_path = (source_file.parent / path_part).resolve()

    # Reject paths that escape the repo root.
    try:
        resolved_path.relative_to(ROOT_DIR)
    except ValueError:
        return None, None

    return resolved_path, anchor or None


def iter_links(markdown_text: str) -> list[tuple[int, str]]:
    links: list[tuple[int, str]] = []
    in_code_block = False

    for line_number, raw_line in enumerate(
        markdown_text.splitlines(),
        start=1,
    ):
        stripped = raw_line.strip()
        if CODE_FENCE_PATTERN.match(stripped):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        for match in LINK_PATTERN.finditer(raw_line):
            links.append((line_number, normalize_target(match.group(1))))
    return links


def validate_file(path: Path) -> list[str]:
    errors: list[str] = []
    markdown_text = path.read_text(encoding="utf-8")
    relative_path = path.relative_to(ROOT_DIR)

    for line_number, raw_line in enumerate(
        markdown_text.splitlines(),
        start=1,
    ):
        if raw_line.rstrip(" ") != raw_line:
            errors.append(
                f"{relative_path}:{line_number}: trailing whitespace"
            )

    headings = extract_headings(markdown_text)

    for line_number, target in iter_links(markdown_text):
        if not target or target.startswith(
            ("http://", "https://", "mailto:", "tel:")
        ):
            continue
        if target.startswith("data:"):
            continue

        resolved_path, anchor = resolve_link_target(path, target)
        if resolved_path is None:
            continue

        if not resolved_path.exists():
            errors.append(
                f"{relative_path}:{line_number}: "
                f"missing link target '{target}'"
            )
            continue

        if anchor:
            candidate_path = resolved_path
            if candidate_path.is_dir():
                errors.append(
                    f"{relative_path}:{line_number}: "
                    f"directory links cannot use anchor '{target}'"
                )
                continue
            if candidate_path.suffix.lower() != ".md":
                errors.append(
                    f"{relative_path}:{line_number}: "
                    f"non-markdown link target cannot use anchor '{target}'"
                )
                continue
            if candidate_path == path:
                target_headings = headings
            else:
                target_headings = extract_headings(
                    candidate_path.read_text(encoding="utf-8")
                )
            if anchor not in target_headings:
                errors.append(
                    f"{relative_path}:{line_number}: missing anchor "
                    f"'{anchor}' in '{candidate_path.relative_to(ROOT_DIR)}'"
                )

    return errors


def main() -> int:
    configure_logging(stack="py", service="validate-docs")
    markdown_files = tracked_markdown_files()
    errors: list[str] = []

    for markdown_file in markdown_files:
        errors.extend(validate_file(markdown_file))

    if errors:
        write_protocol_stderr(str("Markdown validation failed:") + '\n')
        for error in errors:
            write_protocol_stderr(str(f"  - {error}") + '\n')
        return 1

    write_protocol_stdout(str(f"Validated {len(markdown_files)} markdown files.") + '\n')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
