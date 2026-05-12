from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS_PYTHON = _ROOT / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.markdown import parse_metadata, parse_sections

FIXTURE_NAMES = [
    "01_canonical_task",
    "02_canonical_slice",
    "03_canonical_retrospective",
    "10_heading_tab",
    "11_heading_double_space",
    "12_heading_atx_close",
    "13_value_html_comment",
    "14_value_quoted",
    "15_crlf_endings",
    "20_duplicate_label",
    "21_empty_section",
    "22_section_inside_fence",
    "30_no_h1",
    "31_no_sections",
    "32_malformed_label",
]


def _python_parse(text: str) -> dict[str, object]:
    headings = parse_sections(text)
    return {
        "headings": headings,
        "labels": {heading: parse_metadata(lines, heading) for heading, lines in headings.items()},
        "title": _extract_title(text),
    }


def _extract_title(text: str) -> str:
    import re

    match = re.search(r"^#[ \t]+(.+?)[ \t]*(?:#+[ \t]*)?$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _ts_parse(fixture: Path) -> dict[str, object]:
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "tests/parity/markdown/parse_ts.ts", str(fixture)],
        cwd=_ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_fixture_corpus_is_complete() -> None:
    fixture_dir = Path(__file__).parent / "fixtures"
    expected_dir = Path(__file__).parent / "expected"

    assert sorted(path.stem for path in fixture_dir.glob("*.md")) == FIXTURE_NAMES
    assert sorted(path.stem for path in expected_dir.glob("*.json")) == FIXTURE_NAMES


def test_ts_python_markdown_parity() -> None:
    fixture_dir = Path(__file__).parent / "fixtures"
    expected_dir = Path(__file__).parent / "expected"

    for name in FIXTURE_NAMES:
        fixture = fixture_dir / f"{name}.md"
        expected = json.loads((expected_dir / f"{name}.json").read_text(encoding="utf-8"))
        text = fixture.read_text(encoding="utf-8")

        assert _python_parse(text) == expected
        assert _ts_parse(fixture) == expected
