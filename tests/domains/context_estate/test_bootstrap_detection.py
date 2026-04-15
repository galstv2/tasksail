"""Unit tests for bootstrap detection helpers."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.context_estate.bootstrap_detection import _detect_system_layer


class DetectSystemLayerTests(unittest.TestCase):
    """Validate system_layer detection heuristics."""

    def test_repo_with_tests_dir_classifies_as_test(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "tests").mkdir()
            (root / "src").mkdir()
            result = _detect_system_layer(root, "backend")
        self.assertEqual(result, "test")

    def test_repo_with_conftest_classifies_as_test(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "conftest.py").write_text("")
            result = _detect_system_layer(root, "backend")
        self.assertEqual(result, "test")

    def test_repo_with_jest_config_classifies_as_test(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "jest.config.ts").write_text("")
            result = _detect_system_layer(root, "shared")
        self.assertEqual(result, "test")

    def test_declared_test_layer_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            result = _detect_system_layer(root, "test")
        self.assertEqual(result, "test")

    def test_declared_frontend_not_overridden_by_test_signals(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "tests").mkdir()
            result = _detect_system_layer(root, "frontend")
        self.assertEqual(result, "frontend")

    def test_infra_takes_priority_over_test(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "terraform").mkdir()
            (root / "tests").mkdir()
            result = _detect_system_layer(root, "backend")
        self.assertEqual(result, "infrastructure")

    def test_test_takes_priority_over_frontend(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "e2e").mkdir()
            (root / "components").mkdir()
            result = _detect_system_layer(root, "backend")
        self.assertEqual(result, "test")

    def test_dotnet_test_project_name_classifies_as_test(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "Prediqx.Api.Tests"
            root.mkdir()
            (root / "Prediqx.Api.Tests.csproj").write_text("")
            result = _detect_system_layer(root, "backend")
        self.assertEqual(result, "test")

    def test_hyphenated_test_project_name_classifies_as_test(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "my-service-tests"
            root.mkdir()
            (root / "package.json").write_text("{}")
            result = _detect_system_layer(root, "shared")
        self.assertEqual(result, "test")

    def test_frontend_detected_without_test_signals(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "components").mkdir()
            (root / "public").mkdir()
            result = _detect_system_layer(root, "backend")
        self.assertEqual(result, "frontend")
