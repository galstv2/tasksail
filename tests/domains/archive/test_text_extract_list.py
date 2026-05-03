"""Regression tests for extract_list placeholder filtering."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
_SCRIPTS_PYTHON = _REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.text import extract_list  # noqa: E402


class ExtractListPlaceholderTests(unittest.TestCase):
    def test_dash_none_returns_empty(self) -> None:
        self.assertEqual(extract_list(["- None."]), [])

    def test_dash_na_returns_empty(self) -> None:
        self.assertEqual(extract_list(["- N/A"]), [])

    def test_mixed_real_and_placeholder(self) -> None:
        self.assertEqual(extract_list(["- Real item", "- None."]), ["Real item"])

    def test_case_insensitive(self) -> None:
        self.assertEqual(extract_list(["- NONE", "- none.", "- TBD"]), [])

    def test_real_items_preserved(self) -> None:
        self.assertEqual(extract_list(["- First", "- Second"]), ["First", "Second"])

    def test_html_comment_stripped(self) -> None:
        self.assertEqual(extract_list(["<!-- placeholder -->", "- Real"]), ["Real"])


if __name__ == "__main__":
    unittest.main()
