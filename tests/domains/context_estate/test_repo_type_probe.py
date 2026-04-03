"""Unit tests for the repository type classification probe."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.backend.mcp.repo_type_probe import classify_repository_type


class RepoTypeProbeTests(unittest.TestCase):
    """Validate classification heuristics using minimal temp directory fixtures."""

    def test_empty_directory_returns_support_low(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            result = classify_repository_type(Path(d))
        self.assertEqual(result["repository_type"], "support")
        self.assertEqual(result["classification_confidence"], "low")

    def test_django_project_returns_primary_high(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "manage.py").write_text("#!/usr/bin/env python\n")
            (root / "requirements.txt").write_text("django==5.0\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_node_service_with_dockerfile_returns_primary_high(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "Dockerfile").write_text("FROM node:20\n")
            (root / "package.json").write_text(json.dumps({
                "name": "api-server",
                "scripts": {"start": "node server.js"},
            }))
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_npm_library_returns_support(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "package.json").write_text(json.dumps({
                "name": "@org/shared-utils",
                "main": "dist/index.js",
                "types": "dist/index.d.ts",
            }))
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "support")

    def test_docs_only_repo_returns_support_high(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "README.md").write_text("# Docs\n")
            (root / "guide.md").write_text("# Guide\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "support")
        self.assertEqual(result["classification_confidence"], "high")

    def test_go_service_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            cmd_dir = root / "cmd"
            cmd_dir.mkdir()
            (cmd_dir / "main.go").write_text("package main\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")

    def test_terraform_infra_repo_returns_support_high(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "terraform").mkdir()
            (root / "terraform" / "main.tf").write_text('resource "aws" {}\n')
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "support")
        self.assertEqual(result["classification_confidence"], "high")

    def test_nuget_package_returns_support(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "MyLib.csproj").write_text(
                "<Project><PropertyGroup>"
                "<PackageId>MyLib</PackageId>"
                "<OutputType>Library</OutputType>"
                "</PropertyGroup></Project>"
            )
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "support")

    def test_csproj_exe_is_not_support(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "MyApp.csproj").write_text(
                "<Project><PropertyGroup>"
                "<PackageId>MyApp</PackageId>"
                "<OutputType>Exe</OutputType>"
                "</PropertyGroup></Project>"
            )
            result = classify_repository_type(root)
        # NuGet check should NOT fire for Exe output type
        self.assertNotEqual(result["repository_type"], "support")

    def test_dotnet_web_api_with_nested_csproj_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "MyApi.slnx").write_text("<Solution></Solution>\n")
            src = root / "src" / "MyApi"
            src.mkdir(parents=True)
            (src / "MyApi.csproj").write_text(
                '<Project Sdk="Microsoft.NET.Sdk.Web">'
                "<PropertyGroup>"
                "<TargetFramework>net9.0</TargetFramework>"
                "<OutputType>Exe</OutputType>"
                "</PropertyGroup></Project>"
            )
            (src / "Program.cs").write_text("var app = WebApplication.Create();\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_ambiguous_repo_with_both_signals(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "Dockerfile").write_text("FROM python:3.13\n")
            (root / "package.json").write_text(json.dumps({
                "name": "hybrid",
                "main": "dist/index.js",
                "types": "dist/index.d.ts",
            }))
            result = classify_repository_type(root)
        # Dockerfile (weight 3) beats library signals (weight 2)
        self.assertEqual(result["repository_type"], "primary")

    def test_name_based_support_signal(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "my-shared-utils"
            root.mkdir()
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "support")
        # Name keyword "shared" gives support score 1, margin 1 → medium
        self.assertEqual(result["classification_confidence"], "medium")

    def test_dockerfile_overrides_support_name(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "sdk-client"
            root.mkdir()
            (root / "Dockerfile").write_text("FROM node:20\n")
            result = classify_repository_type(root)
        # Dockerfile weight 3 > name weight 1
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "medium")

    def test_python_library_with_no_scripts_returns_support(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pyproject.toml").write_text(
                "[project]\nname = 'my-lib'\nversion = '1.0.0'\n"
            )
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "support")

    def test_python_cli_with_scripts_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pyproject.toml").write_text(
                "[project]\nname = 'my-cli'\n\n[project.scripts]\nmy-cli = 'my_cli:main'\n"
            )
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")

    def test_spring_boot_maven_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pom.xml").write_text(
                '<project><dependencies>'
                '<dependency><groupId>org.springframework.boot</groupId></dependency>'
                '</dependencies></project>'
            )
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_rails_app_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "config.ru").write_text("require_relative 'config/environment'\nrun Rails.application\n")
            (root / "Gemfile").write_text("gem 'rails'\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_laravel_app_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "artisan").write_text("#!/usr/bin/env php\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_phoenix_elixir_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "mix.exs").write_text('defmodule MyApp do\n  {:phoenix, "~> 1.7"}\nend\n')
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")
        self.assertEqual(result["classification_confidence"], "high")

    def test_swift_xcode_project_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "MyApp.xcodeproj").mkdir()
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")

    def test_makefile_with_run_target_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "Makefile").write_text("build:\n\tgo build\n\nrun:\n\tgo run .\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")

    def test_rust_binary_returns_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            src = root / "src"
            src.mkdir()
            (src / "main.rs").write_text("fn main() {}\n")
            result = classify_repository_type(root)
        self.assertEqual(result["repository_type"], "primary")

    def test_languages_param_skips_docs_only_check(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "README.md").write_text("# Docs\n")
            # With languages provided, docs-only check is skipped
            result = classify_repository_type(root, languages=["python"])
        # Should be support/low (no signals) not support/high (docs-only)
        self.assertEqual(result["repository_type"], "support")
        self.assertEqual(result["classification_confidence"], "low")

    def test_repo_name_param_overrides_directory_name(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            result = classify_repository_type(root, repo_name="my-shared-lib")
        self.assertEqual(result["repository_type"], "support")

    def test_infra_with_entrypoint_stays_primary(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "terraform").mkdir()
            (root / "main.py").write_text("# server\n")
            result = classify_repository_type(root)
        # Has entrypoint → primary_score > 0 → infra check skipped
        self.assertEqual(result["repository_type"], "primary")
