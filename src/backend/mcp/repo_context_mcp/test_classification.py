"""Path-shape test classification for context-pack seeding."""

from __future__ import annotations

from pathlib import Path

ARTIFACT_TYPE_TEST_CODE = "test-code"
PATH_KIND_TESTS = "tests"

_TEST_DIRECTORY_SEGMENTS = {
    "test",
    "tests",
    "spec",
    "specs",
    "e2e",
    "__test__",
    "__tests__",
    "__spec__",
    "__specs__",
}

_LOWERCASE_SUFFIX_PATTERNS = (
    "_test.py",
    "_spec.py",
    "_test.go",
    "_test.dart",
    "_test.exs",
    "_spec.rb",
    "_test.cc",
    "_test.cpp",
    "_test.cxx",
    "_spec.cc",
    "_spec.cpp",
    ".test.ts",
    ".test.tsx",
    ".spec.ts",
    ".spec.tsx",
    ".test.js",
    ".test.jsx",
    ".spec.js",
    ".spec.jsx",
    ".test.mjs",
    ".spec.mjs",
    ".test.cjs",
    ".spec.cjs",
)

_CAMELCASE_SUFFIX_PATTERNS = (
    "Test.java",
    "Tests.java",
    "Spec.java",
    "IT.java",
    "Test.kt",
    "Tests.kt",
    "Spec.kt",
    "Test.scala",
    "Spec.scala",
    "Test.cs",
    "Tests.cs",
    "Spec.cs",
    "Test.php",
    "Tests.php",
    "Tests.swift",
    "Test.swift",
)


def _path_parts(path: str | Path) -> list[str]:
    return [part for part in str(path).replace("\\", "/").split("/") if part]


def is_test_path(path: str | Path) -> bool:
    parts = _path_parts(path)
    if not parts:
        return False

    if any(part.lower() in _TEST_DIRECTORY_SEGMENTS for part in parts):
        return True

    name = parts[-1]
    lowered_name = name.lower()
    if lowered_name.startswith("test_") and lowered_name.endswith(".py"):
        return True
    if lowered_name.startswith("test-") and lowered_name.endswith(".r"):
        return True
    if any(lowered_name.endswith(pattern) for pattern in _LOWERCASE_SUFFIX_PATTERNS):
        return True
    return any(name.endswith(pattern) for pattern in _CAMELCASE_SUFFIX_PATTERNS)
