from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from src.backend.mcp.repo_context_mcp.utils import write_json_atomic, write_text_atomic


class AtomicWriteTests(unittest.TestCase):
    """Tests for write_text_atomic() and write_json_atomic() in utils.py."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self._tmp, True)

    def test_write_text_atomic_creates_file(self) -> None:
        target = self._tmp / "output.txt"
        write_text_atomic(target, "hello world")
        self.assertEqual(target.read_text(encoding="utf-8"), "hello world")

    def test_write_text_atomic_overwrites_existing(self) -> None:
        target = self._tmp / "output.txt"
        target.write_text("old", encoding="utf-8")
        write_text_atomic(target, "new")
        self.assertEqual(target.read_text(encoding="utf-8"), "new")

    def test_write_text_atomic_creates_parent_dirs(self) -> None:
        target = self._tmp / "a" / "b" / "c" / "output.txt"
        write_text_atomic(target, "nested")
        self.assertEqual(target.read_text(encoding="utf-8"), "nested")

    def test_write_text_atomic_cleans_up_on_failure(self) -> None:
        target = self._tmp / "fail.txt"
        with mock.patch("os.rename", side_effect=OSError("mock rename failure")):
            with self.assertRaises(OSError):
                write_text_atomic(target, "should not persist")

        self.assertFalse(target.exists(), "Target must not exist after failure")
        leftover = list(self._tmp.glob(".*tmp"))
        self.assertEqual(leftover, [], "Temp file must be cleaned up on failure")

    def test_write_json_atomic_roundtrips(self) -> None:
        target = self._tmp / "data.json"
        payload = {"key": "value", "nested": {"a": [1, 2, 3]}}
        write_json_atomic(target, payload)
        loaded = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(loaded, payload)


if __name__ == "__main__":
    unittest.main()
