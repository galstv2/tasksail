"""Unit tests for src/backend/scripts/python/lib/ shared utilities."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import textwrap
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

# Ensure src/backend/scripts/python is on the path so ``from lib.…`` imports resolve.
_SCRIPTS_PYTHON = Path(__file__).resolve().parents[3] / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.cli import fail
from lib.io import (
    atomic_write_json,
    atomic_write_text,
    load_json,
    load_json_safe,
    load_text,
)
from lib.locking import acquire_file_lock, release_file_lock
from lib.markdown import parse_metadata, parse_sections
from lib.paths import (
    assert_safe_path_segment,
    ensure_within_root,
    ensure_write_path,
    normalize_boundary_path,
    normalize_repo_relative_path,
    resolve_repo_relative_path,
)
from lib.text import (
    COMMAND_LINE_PATTERN,
    compact_text,
    extract_bullet_items,
    extract_list,
    normalize_string_list,
    normalize_text,
    slugify,
)
from lib.time import (
    compute_runtime_age_seconds,
    current_utc_timestamp,
    parse_iso8601_utc,
)


class _TmpDirMixin:
    """Provides a temporary directory as ``self._tmp``."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self._tmp, True)  # type: ignore[attr-defined]


class FailTests(unittest.TestCase):
    def test_exits_with_code_1(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            fail("boom")
        self.assertEqual(ctx.exception.code, 1)


class LoadTextTests(_TmpDirMixin, unittest.TestCase):
    def test_load_text_variants(self) -> None:
        cases = [
            ("missing file returns empty", self._tmp / "no-such-file.txt", "", None),
            ("existing file returns content", self._tmp / "hello.txt", "hello world", "hello world"),
        ]
        for label, path, expected, write_content in cases:
            with self.subTest(label=label):
                if write_content is not None:
                    path.write_text(write_content, encoding="utf-8")
                self.assertEqual(load_text(path), expected)


class LoadJsonTests(_TmpDirMixin, unittest.TestCase):
    def test_loads_valid_json(self) -> None:
        p = self._tmp / "data.json"
        p.write_text('{"a": 1}', encoding="utf-8")
        self.assertEqual(load_json(p), {"a": 1})

    def test_rejects_invalid_json(self) -> None:
        cases = [
            ("malformed", "{bad", json.JSONDecodeError),
            ("non-object", "[1,2]", TypeError),
        ]
        for label, content, exc_type in cases:
            with self.subTest(label=label):
                p = self._tmp / f"{label}.json"
                p.write_text(content, encoding="utf-8")
                with self.assertRaises(exc_type):
                    load_json(p)


class LoadJsonSafeTests(_TmpDirMixin, unittest.TestCase):
    def test_returns_error_on_invalid(self) -> None:
        cases = [
            ("malformed", "{bad", None),
            ("non-object", "[1,2]", "object"),
        ]
        for label, content, err_substring in cases:
            with self.subTest(label=label):
                p = self._tmp / f"{label}.json"
                p.write_text(content, encoding="utf-8")
                payload, err = load_json_safe(p)
                self.assertIsNone(payload)
                self.assertIsNotNone(err)
                if err_substring:
                    self.assertIn(err_substring, err)


class AtomicWriteJsonTests(_TmpDirMixin, unittest.TestCase):
    def test_writes_valid_json(self) -> None:
        p = self._tmp / "out.json"
        atomic_write_json(p, {"key": "val"})
        self.assertEqual(
            json.loads(p.read_text(encoding="utf-8")), {"key": "val"}
        )

    def test_creates_parent_dirs(self) -> None:
        p = self._tmp / "sub" / "dir" / "out.json"
        atomic_write_json(p, {"x": 1})
        self.assertTrue(p.exists())

    def test_routes_through_fsync(self) -> None:
        # atomic_write_json must inherit the durable fsync from atomic_write_text.
        import lib.io as _io
        with mock.patch.object(_io.os, "fsync") as fsync_mock:
            atomic_write_json(self._tmp / "out.json", {"a": 1})
        self.assertTrue(fsync_mock.called)


class AtomicWriteTextTests(_TmpDirMixin, unittest.TestCase):
    def test_writes_complete_content(self) -> None:
        p = self._tmp / "sub" / "note.md"
        atomic_write_text(p, "hello\nworld")
        self.assertEqual(p.read_text(encoding="utf-8"), "hello\nworld")

    def test_fsyncs_before_replace(self) -> None:
        # Durability: data must be fsync'd before the rename so a crash cannot
        # leave the rename durable but the file contents lost or truncated.
        import lib.io as _io
        with mock.patch.object(_io.os, "fsync") as fsync_mock:
            atomic_write_text(self._tmp / "d.txt", "x")
        self.assertTrue(fsync_mock.called)

    def test_original_intact_and_temp_cleaned_on_replace_failure(self) -> None:
        import lib.io as _io
        dest = self._tmp / "keep.txt"
        dest.write_text("original", encoding="utf-8")
        with mock.patch.object(_io.os, "replace", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                atomic_write_text(dest, "new")
        self.assertEqual(dest.read_text(encoding="utf-8"), "original")
        self.assertEqual(list(self._tmp.glob(".keep.txt.*")), [])


class ParseSectionsTests(unittest.TestCase):
    def test_extracts_headings(self) -> None:
        md = textwrap.dedent("""\
            ## Alpha
            line1
            line2
            ## Beta
            line3
        """)
        sections = parse_sections(md)
        self.assertIn("Alpha", sections)
        self.assertIn("Beta", sections)
        self.assertTrue(any("line1" in line for line in sections["Alpha"]))

    def test_empty_input(self) -> None:
        self.assertEqual(parse_sections(""), {})


class ParseMetadataTests(unittest.TestCase):
    def test_extracts_key_value_pairs(self) -> None:
        lines = ["- Name: Alice", "- Role: Engineer", "plain text"]
        meta = parse_metadata(lines)
        self.assertEqual(meta, {"Name": "Alice", "Role": "Engineer"})


class NormalizeRepoRelativePathTests(unittest.TestCase):
    def test_normalize_variants(self) -> None:
        cases = [
            ("strips dot-slash", "./foo/bar", "foo/bar"),
            ("collapses slashes", "a//b///c", "a/b/c"),
            ("converts backslashes", "a\\b\\c", "a/b/c"),
        ]
        for label, input_val, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(normalize_repo_relative_path(input_val), expected)


class ResolveRepoRelativePathTests(_TmpDirMixin, unittest.TestCase):
    def test_resolves_within_root(self) -> None:
        sub = self._tmp / "sub"
        sub.mkdir()
        result = resolve_repo_relative_path(self._tmp, "sub")
        self.assertEqual(result, sub)

    def test_rejects_invalid_paths(self) -> None:
        cases = [
            ("escape", "../escape"),
            ("absolute", "/etc/passwd"),
            ("empty", ""),
        ]
        for label, rel_path in cases:
            with self.subTest(label=label):
                result = resolve_repo_relative_path(self._tmp, rel_path)
                self.assertIsNone(result)


class EnsureWritePathTests(_TmpDirMixin, unittest.TestCase):
    def test_accepts_valid_path(self) -> None:
        allowed = "output"
        (self._tmp / allowed).mkdir()
        candidate = self._tmp / allowed / "file.txt"
        result = ensure_write_path(
            root_dir=self._tmp,
            candidate=candidate,
            allowed_relative_dir=allowed,
            error_message="bad",
        )
        self.assertTrue(str(result).startswith(str(self._tmp / allowed)))

    def test_rejects_escape(self) -> None:
        with self.assertRaises(ValueError):
            ensure_write_path(
                root_dir=self._tmp,
                candidate=self._tmp / "outside" / "file.txt",
                allowed_relative_dir="output",
                error_message="bad",
            )


class EnsureWithinRootTests(_TmpDirMixin, unittest.TestCase):
    def test_passes_when_inside(self) -> None:
        ensure_within_root(self._tmp, self._tmp / "sub", "fail msg")

    def test_fails_when_outside(self) -> None:
        outside = (self._tmp / "..").resolve() / "outside"
        with self.assertRaises(SystemExit):
            ensure_within_root(self._tmp, outside, "fail msg")


class AssertSafePathSegmentTests(unittest.TestCase):
    """Untrusted task IDs are constrained to one index-path segment."""

    def test_accepts_flat_identifiers(self) -> None:
        for value in ("CAP-1000", "CAP-2001", "task_42", "abc"):
            with self.subTest(value=value):
                self.assertEqual(assert_safe_path_segment(value, "task_id"), value)

    def test_rejects_traversal_and_separators(self) -> None:
        for value in ("../../evil", "a/b", "a\\b", "..", ".", ""):
            with self.subTest(value=value):
                with self.assertRaises(SystemExit):
                    assert_safe_path_segment(value, "task_id")


class NormalizeBoundaryPathTests(_TmpDirMixin, unittest.TestCase):
    def test_boundary_path_variants(self) -> None:
        cases = [
            ("blank returns None", "  ", None),
            ("relative stays relative", "./foo/bar", "foo/bar"),
        ]
        for label, input_val, expected in cases:
            with self.subTest(label=label):
                result = normalize_boundary_path(self._tmp, input_val)
                self.assertEqual(result, expected)


class SlugifyTests(unittest.TestCase):
    def test_slugify_variants(self) -> None:
        cases = [
            ("kebab case", "Hello World!", "hello-world"),
            ("fallback for empty", "!!!", "task"),
        ]
        for label, input_val, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(slugify(input_val), expected)


class NormalizeTextTests(unittest.TestCase):
    def test_joins_and_strips(self) -> None:
        self.assertEqual(normalize_text(["  foo  ", "", "  bar  "]), "foo\nbar")


class ExtractListTests(unittest.TestCase):
    def test_extract_list_variants(self) -> None:
        cases = [
            ("dash prefix", ["- alpha", "- beta"], ["alpha", "beta"]),
            ("plain lines", ["plain"], ["plain"]),
        ]
        for label, input_val, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(extract_list(input_val), expected)


class ExtractBulletItemsTests(unittest.TestCase):
    def test_handles_dash_and_star(self) -> None:
        items = extract_bullet_items(["- one", "* two", "3. three"])
        self.assertEqual(items, ["one", "two", "three"])


class CommandLinePatternTests(unittest.TestCase):
    def test_matches_windows_native_commands(self) -> None:
        cases = [
            "powershell -File scripts/check.ps1",
            "pwsh -Command Get-ChildItem",
            "cmd /c dir",
            r".\scripts\check.bat",
            "py -m pytest tests/domains/test_infra/test_script_lib.py",
        ]
        for value in cases:
            with self.subTest(value=value):
                self.assertIsNotNone(COMMAND_LINE_PATTERN.search(value))


class CompactTextTests(unittest.TestCase):
    def test_compact_text_variants(self) -> None:
        cases = [
            ("collapses whitespace", "  a   b   c  ", None, "a b c"),
            ("truncates with ellipsis", "a" * 400, 10, None),
        ]
        for label, input_val, max_length, exact_expected in cases:
            with self.subTest(label=label):
                if max_length is not None:
                    result = compact_text(input_val, max_length=max_length)
                    self.assertLessEqual(len(result), max_length)
                    self.assertTrue(result.endswith("..."))
                else:
                    self.assertEqual(compact_text(input_val), exact_expected)


class NormalizeStringListTests(unittest.TestCase):
    def test_normalize_string_list_variants(self) -> None:
        cases = [
            ("None returns empty", None, []),
            ("string splits on comma", "a, b, c", ["a", "b", "c"]),
            ("list strips items", ["  x  ", "", "  y  "], ["x", "y"]),
        ]
        for label, input_val, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(normalize_string_list(input_val), expected)

    def test_rejects_other_types(self) -> None:
        with self.assertRaises(SystemExit):
            normalize_string_list(42)


class CurrentUtcTimestampTests(unittest.TestCase):
    def test_returns_iso_format(self) -> None:
        ts = current_utc_timestamp()
        self.assertTrue(ts.endswith("Z"))
        datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")


class ParseIso8601UtcTests(unittest.TestCase):
    def test_parses_valid_timestamp(self) -> None:
        dt = parse_iso8601_utc("2025-01-15T10:30:00Z")
        self.assertIsNotNone(dt)
        self.assertIsNotNone(dt.tzinfo)

    def test_returns_none_for_invalid(self) -> None:
        cases = [
            ("empty", ""),
            ("garbage", "not-a-date"),
        ]
        for label, input_val in cases:
            with self.subTest(label=label):
                self.assertIsNone(parse_iso8601_utc(input_val))


class ComputeRuntimeAgeSecondsTests(unittest.TestCase):
    def test_computes_age(self) -> None:
        now = datetime(2025, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        age = compute_runtime_age_seconds("2025-01-15T11:59:00Z", now=now)
        self.assertEqual(age, 60)

    def test_returns_none_for_bad_timestamp(self) -> None:
        self.assertIsNone(compute_runtime_age_seconds("garbage"))


class FileLockingTests(_TmpDirMixin, unittest.TestCase):
    def test_acquire_and_release(self) -> None:
        lock_file = self._tmp / "test.lock"
        fd = acquire_file_lock(lock_file)
        self.assertIsInstance(fd, int)
        self.assertTrue(lock_file.exists())
        release_file_lock(fd)

    def test_creates_parent_dirs(self) -> None:
        lock_file = self._tmp / "sub" / "dir" / "test.lock"
        fd = acquire_file_lock(lock_file)
        release_file_lock(fd)
        self.assertTrue(lock_file.exists())


if __name__ == "__main__":
    unittest.main()
