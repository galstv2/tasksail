"""Tests for parallel Dalton tests.md append semantics."""

from __future__ import annotations

import sys
import threading
import tempfile
from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT / "src" / "backend" / "scripts" / "python") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src" / "backend" / "scripts" / "python"))

from lib.role_agent.tests_md_append import (  # noqa: E402
    append_tests_md_section,
    instance_section_exists,
    write_stub_section,
)


class TestsMdAppendTests(unittest.TestCase):
    """Validate locked append, idempotency, and stub writing."""

    def _make_root(self, tmp: str, initial_content: str = "") -> Path:
        root = Path(tmp)
        tests_md = root / "AgentWorkSpace" / "handoffs" / "tests.md"
        tests_md.parent.mkdir(parents=True, exist_ok=True)
        if initial_content:
            tests_md.write_text(initial_content, encoding="utf-8")
        return root

    def test_section_exists_false_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._make_root(tmp, "# Tests\n")
            self.assertFalse(instance_section_exists(root, "d1"))

    def test_section_exists_true_after_append(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._make_root(tmp, "# Tests\n")
            append_tests_md_section(root, "d1", "s1", "slices/s1.md", "content")
            self.assertTrue(instance_section_exists(root, "d1"))

    def test_idempotent_append(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._make_root(tmp, "# Tests\n")
            wrote1 = append_tests_md_section(root, "d1", "s1", "slices/s1.md", "first")
            wrote2 = append_tests_md_section(root, "d1", "s1", "slices/s1.md", "second")
            self.assertTrue(wrote1)
            self.assertFalse(wrote2)
            text = (root / "AgentWorkSpace" / "handoffs" / "tests.md").read_text()
            self.assertEqual(text.count("(Instance: d1)"), 1)

    def test_multiple_instances_no_clobber(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._make_root(tmp, "# Tests\n")
            append_tests_md_section(root, "d1", "s1", "slices/s1.md", "c1")
            append_tests_md_section(root, "d2", "s2", "slices/s2.md", "c2")
            text = (root / "AgentWorkSpace" / "handoffs" / "tests.md").read_text()
            self.assertIn("(Instance: d1)", text)
            self.assertIn("(Instance: d2)", text)
            self.assertIn("c1", text)
            self.assertIn("c2", text)

    def test_concurrent_appends_no_clobber(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._make_root(tmp, "# Tests\n")
            errors: list[str] = []
            barrier = threading.Barrier(4)

            def worker(idx: int) -> None:
                try:
                    barrier.wait(timeout=5)
                    append_tests_md_section(
                        root, f"d{idx}", f"s{idx}", f"slices/s{idx}.md", f"content-{idx}",
                    )
                except Exception as exc:
                    errors.append(str(exc))

            threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)

            self.assertFalse(errors, f"Thread errors: {errors}")
            text = (root / "AgentWorkSpace" / "handoffs" / "tests.md").read_text()
            for i in range(4):
                self.assertIn(f"(Instance: d{i})", text)
                self.assertIn(f"content-{i}", text)

    def test_write_stub_section(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._make_root(tmp, "# Tests\n")
            write_stub_section(root, "d1", "s1", "slices/s1.md")
            text = (root / "AgentWorkSpace" / "handoffs" / "tests.md").read_text()
            self.assertIn("## Slice: s1 (Instance: d1)", text)
            self.assertIn("Stub", text)
            self.assertIn("slices/s1.md", text)

    def test_section_exists_false_when_no_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertFalse(instance_section_exists(root, "d1"))


if __name__ == "__main__":
    unittest.main()
