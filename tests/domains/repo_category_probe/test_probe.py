"""Tests for repo_category_probe.classify_repo_category and repo_category_for_wizard_role."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.pack_constants import ALLOWED_REPO_CATEGORIES
from src.backend.mcp.repo_category_probe import (
    classify_repo_category,
    repo_category_for_wizard_role,
)

FIXTURE_BASE = Path(__file__).resolve().parents[2] / "fixtures" / "repo_category"

# (fixture_subpath, expected_category)
_CATEGORY_CASES = [
    ("service/python", "service"),
    ("service/python-fastapi", "service"),
    ("service/go", "service"),
    ("service/node", "service"),
    ("service/node-express", "service"),
    ("service/node-express-with-roles-dir", "service"),
    ("service/dotnet", "service"),
    ("service/dotnet-web", "service"),
    ("service/dotnet-worker", "service"),
    ("service/laravel", "service"),
    ("service/phoenix", "service"),
    ("service/ruby-rails", "service"),
    ("service/jvm-spring", "service"),
    ("service/rust", "service"),
    ("frontend/react", "frontend"),
    ("frontend/vite-app", "frontend"),
    ("frontend/swiftui", "frontend"),
    ("infrastructure/terraform", "infrastructure"),
    ("infrastructure/opentofu", "infrastructure"),
    ("infrastructure/pulumi", "infrastructure"),
    ("infrastructure/cdk", "infrastructure"),
    ("infrastructure/cloudformation", "infrastructure"),
    ("infrastructure/sam", "infrastructure"),
    ("infrastructure/serverless", "infrastructure"),
    ("infrastructure/ansible", "infrastructure"),
    ("infrastructure/ansible-role", "infrastructure"),
    ("infrastructure/k8s", "infrastructure"),
    ("data/dbt", "data"),
    ("data/airflow", "data"),
    ("data/raw-migrations", "data"),
    ("data/schema-sql", "data"),
    ("data/prisma", "data"),
    ("data/flyway", "data"),
    ("data/liquibase", "data"),
    ("data/alembic", "data"),
    ("data/ef-migrations", "data"),
    ("documentation/mkdocs", "documentation"),
    ("documentation/docusaurus", "documentation"),
    ("tool/python", "tool"),
    ("tool/node", "tool"),
    ("library/dotnet-package", "library"),
    ("library/go", "library"),
    ("library/php", "library"),
    ("library/elixir", "library"),
    ("library/jvm", "library"),
    ("library/ruby", "library"),
    ("library/rust", "library"),
    ("library/python", "library"),
    ("library/vite-library", "library"),
    ("application/python", "application"),
    ("application/cli-go", "application"),
]


@pytest.mark.parametrize("subpath,expected_category", _CATEGORY_CASES)
def test_classify_repo_category_fixture(subpath: str, expected_category: str) -> None:
    """Probe returns the expected category (high or medium confidence) for each fixture."""
    fixture_path = FIXTURE_BASE / subpath
    assert fixture_path.is_dir(), f"Fixture directory does not exist: {fixture_path}"

    category, confidence = classify_repo_category(fixture_path)

    assert category == expected_category, (
        f"fixture={subpath}: expected category={expected_category!r}, "
        f"got={category!r} (confidence={confidence!r})"
    )
    assert confidence in ("high", "medium"), (
        f"fixture={subpath}: expected confidence in (high, medium), got={confidence!r}"
    )
    # Category must be in the canonical allowed set
    assert category in ALLOWED_REPO_CATEGORIES


def test_classify_unknown_empty_returns_low() -> None:
    """An empty directory falls through all detection steps → unknown, low."""
    fixture_path = FIXTURE_BASE / "unknown" / "empty"
    category, confidence = classify_repo_category(fixture_path)
    assert category == "unknown"
    assert confidence == "low"


def test_classify_unknown_ambiguous_returns_low() -> None:
    """A directory with only a README falls through all detection steps → unknown, low."""
    fixture_path = FIXTURE_BASE / "unknown" / "ambiguous"
    category, confidence = classify_repo_category(fixture_path)
    assert category == "unknown"
    assert confidence == "low"


def test_dotnet_test_sdk_returns_unknown_without_test_layer_category() -> None:
    """Test SDK repositories stay unknown until category/layer contracts accept test."""
    fixture_path = FIXTURE_BASE / "unknown" / "dotnet-tests"
    category, confidence = classify_repo_category(fixture_path)
    assert category == "unknown"
    assert confidence in ("low", "medium")


def test_github_actions_alone_is_not_infrastructure() -> None:
    """CI workflow files alone are not enough to classify a repo as infrastructure."""
    fixture_path = FIXTURE_BASE / "unknown" / "github-actions-only"
    category, confidence = classify_repo_category(fixture_path)
    assert category == "unknown"
    assert confidence == "low"


# ---------------------------------------------------------------------------
# repo_category_for_wizard_role
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("role,expected", [
    ("backend", "service"),
    ("frontend", "frontend"),
    ("database", "data"),
    ("infrastructure", "infrastructure"),
    ("documents", "documentation"),
    ("shared", "library"),
])
def test_wizard_role_maps_to_expected_category(role: str, expected: str) -> None:
    """Each ROLE_OPTIONS.value maps to the correct repo_category."""
    assert repo_category_for_wizard_role(role) == expected


@pytest.mark.parametrize("bad_role", ["Backend / API", "", "nonexistent", "backend-service"])
def test_wizard_role_unknown_returns_none(bad_role: str) -> None:
    """Display labels and unknown strings must not match (values only)."""
    assert repo_category_for_wizard_role(bad_role) is None
