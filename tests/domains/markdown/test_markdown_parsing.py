from __future__ import annotations

import logging
import sys
from pathlib import Path

_SCRIPTS_PYTHON = Path(__file__).resolve().parents[3] / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.markdown import parse_metadata, parse_sections


def test_parse_sections_accepts_tab_spacing_and_atx_close() -> None:
    sections = parse_sections("##\tTask Lineage ##\n- Task Kind: child\n## Next\nBody")

    assert sections["Task Lineage"] == ["- Task Kind: child"]


def test_parse_metadata_strips_html_comments() -> None:
    values = parse_metadata(["- Difficulty Level: Hard <!-- bumped -->"], "Task Metadata")

    assert values["Difficulty Level"] == "Hard"


def test_parse_metadata_duplicate_labels_first_wins_and_warns_once(caplog) -> None:
    caplog.set_level(logging.WARNING)

    values = parse_metadata(["- Foo: one", "- Foo: two", "- Foo: three"], "Task Metadata")

    assert values["Foo"] == "one"
    messages = [record.message for record in caplog.records]
    assert len(messages) == 1
    assert "Foo" in messages[0]
    assert "Task Metadata" in messages[0]


def test_parse_sections_ignores_headings_inside_fences() -> None:
    sections = parse_sections("## Parent\n```\n## Not Section\n```\nBody\n## Next\nDone")

    assert sections == {
        "Parent": ["```", "## Not Section", "```", "Body"],
        "Next": ["Done"],
    }
