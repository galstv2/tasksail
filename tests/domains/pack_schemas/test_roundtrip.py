"""Round-trip drift tests for pack_schemas validators and canonicalize."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.backend.mcp.pack_constants import WIZARD_ROLE_TO_REPO_CATEGORY
from src.backend.mcp.pack_schemas import (
    canonicalize,
    dump_answers,
    dump_manifest,
    dump_manifest_v2,
    dump_plan,
    validate_answers,
    validate_manifest,
    validate_manifest_v2,
    validate_plan,
)
from src.backend.mcp.pack_schemas.errors import PackSchemaError

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures" / "pack_schemas"
SNAPSHOTS_DIR = FIXTURES_DIR / "canonical"

MANIFEST_FIXTURES = sorted((FIXTURES_DIR / "manifest").glob("*.json"))
ANSWERS_FIXTURES = sorted((FIXTURES_DIR / "answers").glob("*.json"))
PLAN_FIXTURES = sorted((FIXTURES_DIR / "plan").glob("*.json"))


def _snapshot_path(shape: str, fixture_path: Path) -> Path:
    return SNAPSHOTS_DIR / shape / f"{fixture_path.stem}.canonical.txt"


@pytest.mark.parametrize("fixture_path", MANIFEST_FIXTURES, ids=lambda p: p.name)
def test_manifest_round_trip(fixture_path: Path) -> None:
    raw = json.loads(fixture_path.read_text())
    model = validate_manifest(raw, path=str(fixture_path))
    dumped = dump_manifest(model)
    assert canonicalize(dumped) == canonicalize(raw), (
        f"Round-trip mismatch for {fixture_path.name}"
    )


@pytest.mark.parametrize("fixture_path", ANSWERS_FIXTURES, ids=lambda p: p.name)
def test_answers_round_trip(fixture_path: Path) -> None:
    raw = json.loads(fixture_path.read_text())
    model = validate_answers(raw, path=str(fixture_path))
    dumped = dump_answers(model)
    assert canonicalize(dumped) == canonicalize(raw)


@pytest.mark.parametrize("fixture_path", PLAN_FIXTURES, ids=lambda p: p.name)
def test_plan_round_trip(fixture_path: Path) -> None:
    raw = json.loads(fixture_path.read_text())
    model = validate_plan(raw, path=str(fixture_path))
    dumped = dump_plan(model)
    assert canonicalize(dumped) == canonicalize(raw)


def test_manifest_unknown_keys_accepted() -> None:
    raw = {
        "__future_field__": "x",
        "manifest_version": "qmd-repo-sources/v1",
        "manifest_status": "approved",
        "estate_type": "distributed",
        "context_pack_id": "test",
        "qmd_scope_root": "qmd/context-packs/test",
        "primary_working_repo_ids": [],
        "primary_focus_area_ids": [],
        "repositories": [],
    }
    model = validate_manifest(raw)
    dumped = dump_manifest(model)
    assert "__future_field__" not in dumped


def test_manifest_missing_required_raises() -> None:
    raw = {"manifest_version": "qmd-repo-sources/v1"}  # missing most required fields
    with pytest.raises(PackSchemaError) as exc_info:
        validate_manifest(raw)
    assert exc_info.value.validation_errors  # non-empty list


@pytest.mark.parametrize(
    "estate_type",
    ["distributed", "distributed-platform", "monolith", "monolith-platform"],
)
def test_manifest_accepts_all_estate_types(estate_type: str) -> None:
    raw = {
        "manifest_version": "qmd-repo-sources/v1",
        "manifest_status": "approved",
        "estate_type": estate_type,
        "context_pack_id": "test",
        "qmd_scope_root": "qmd/context-packs/test",
        "primary_working_repo_ids": [],
        "primary_focus_area_ids": [],
        "repositories": [],
    }

    assert validate_manifest(raw).estate_type == estate_type


def test_manifest_rejects_unknown_estate_type() -> None:
    raw = {
        "manifest_version": "qmd-repo-sources/v1",
        "manifest_status": "approved",
        "estate_type": "future-estate",
        "context_pack_id": "test",
        "qmd_scope_root": "qmd/context-packs/test",
        "primary_working_repo_ids": [],
        "primary_focus_area_ids": [],
        "repositories": [],
    }

    with pytest.raises(PackSchemaError) as exc_info:
        validate_manifest(raw)

    assert "estate_type must be one of" in exc_info.value.validation_errors[0]


@pytest.mark.parametrize(
    "shape,fixture_path",
    [("manifest", p) for p in MANIFEST_FIXTURES]
    + [("answers", p) for p in ANSWERS_FIXTURES]
    + [("plan", p) for p in PLAN_FIXTURES],
    ids=lambda v: v if isinstance(v, str) else v.name,
)
def test_canonicalize_matches_snapshot(shape: str, fixture_path: Path) -> None:
    """Lock Python's canonicalize output for each fixture as the cross-language wire contract.

    The TS round-trip test asserts the same snapshot byte-for-byte, so any drift between
    Python's and TS's canonicalize implementations surfaces here or there. If the
    canonical wire format intentionally changes, update the committed canonical fixtures.
    """
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    canonical = canonicalize(raw)
    snapshot = _snapshot_path(shape, fixture_path).read_text(encoding="utf-8")
    assert canonical == snapshot, (
        f"Python canonicalize drifted from snapshot for {fixture_path.name}. "
        "If this is intentional, update the committed canonical fixture."
    )


def test_real_packs_round_trip() -> None:
    """Every repo-sources.json and bootstrap-answers.json in contextpacks/ must validate."""
    repo_root = Path(__file__).parent.parent.parent.parent
    for manifest_path in sorted(repo_root.glob("contextpacks/*/qmd/repo-sources.json")):
        raw = json.loads(manifest_path.read_text())
        model = validate_manifest(raw, path=str(manifest_path))
        dumped = dump_manifest(model)
        if canonicalize(dumped) != canonicalize(raw):
            validate_manifest(dumped, path=str(manifest_path))
            assert raw.get("manifest_version") == "qmd-repo-sources/v2", (
                f"Unexpected non-migration round-trip drift: {manifest_path}"
            )
        else:
            assert canonicalize(dumped) == canonicalize(raw), f"Round-trip failed: {manifest_path}"
    for answers_path in sorted(repo_root.glob("contextpacks/*/qmd/bootstrap/bootstrap-answers.json")):
        raw = json.loads(answers_path.read_text())
        model = validate_answers(raw, path=str(answers_path))
        dumped = dump_answers(model)
        assert canonicalize(dumped) == canonicalize(raw), f"Round-trip failed: {answers_path}"


# ---------------------------------------------------------------------------
# G1 constant alignment guard
# ---------------------------------------------------------------------------

def test_wizard_role_to_category_keys_match_role_options() -> None:
    """WIZARD_ROLE_TO_REPO_CATEGORY keys must exactly equal ROLE_OPTIONS.value strings.

    The authoritative source for values is:
      src/frontend/desktop/src/renderer/components/creation-steps/buildWizardConstants.ts
    If ROLE_OPTIONS changes, update WIZARD_ROLE_TO_REPO_CATEGORY in pack_constants.py too.
    """
    # Copied from ROLE_OPTIONS in buildWizardConstants.ts (keep in sync)
    expected_keys = {"backend", "frontend", "database", "infrastructure", "documents", "shared"}
    assert set(WIZARD_ROLE_TO_REPO_CATEGORY.keys()) == expected_keys


# ---------------------------------------------------------------------------
# G2 v2 manifest named round-trip tests
# ---------------------------------------------------------------------------

def test_manifest_v2_minimum_roundtrip() -> None:
    """minimum-v2.json round-trips through validate_manifest_v2 + dump_manifest_v2."""
    fixture_path = FIXTURES_DIR / "manifest" / "minimum-v2.json"
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    model = validate_manifest_v2(raw, path=str(fixture_path))
    dumped = dump_manifest_v2(model)
    assert canonicalize(dumped) == canonicalize(raw), "Round-trip mismatch for minimum-v2.json"


def test_manifest_v2_distributed_roundtrip() -> None:
    """distributed-v2.json round-trips with repo_category/repo_focus fields preserved."""
    fixture_path = FIXTURES_DIR / "manifest" / "distributed-v2.json"
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    model = validate_manifest_v2(raw, path=str(fixture_path))
    dumped = dump_manifest_v2(model)
    assert canonicalize(dumped) == canonicalize(raw), "Round-trip mismatch for distributed-v2.json"
    # Spot-check that v2 fields are preserved in the dumped output
    repos = dumped.get("repositories") or []
    assert len(repos) == 2
    api_repo = next(r for r in repos if r.get("repo_id") == "api")
    assert api_repo.get("repo_category") == "service"
    assert api_repo.get("repo_focus") == "primary"
    assert api_repo.get("repo_category_authored") is False
    assert api_repo.get("repo_focus_authored") is False
    web_repo = next(r for r in repos if r.get("repo_id") == "web")
    assert web_repo.get("repo_category") == "frontend"
    assert web_repo.get("repo_focus") == "primary"
    assert web_repo.get("repo_category_authored") is False
    assert web_repo.get("repo_focus_authored") is False


def test_manifest_v2_legacy_local_paths_normalize_to_structured() -> None:
    raw = {
        "manifest_version": "qmd-repo-sources/v2",
        "manifest_status": "approved",
        "estate_type": "distributed",
        "context_pack_id": "legacy-local-paths",
        "qmd_scope_root": "qmd/context-packs/legacy-local-paths",
        "primary_working_repo_ids": [],
        "primary_focus_area_ids": [],
        "repositories": [
            {
                "repo_id": "api",
                "repo_name": "API",
                "local_paths": ["C:\\Users\\example\\api"],
                "repo_category": "service",
                "repo_focus": "primary",
            }
        ],
    }
    model = validate_manifest_v2(raw)
    assert model.repositories is not None
    assert model.repositories[0].local_paths[0].host == "C:/Users/example/api"

    dumped = dump_manifest_v2(model)
    assert dumped["repositories"][0]["local_paths"] == [
        {"host": "C:/Users/example/api", "container": None}
    ]


def test_manifest_v2_local_paths_preserve_git_root() -> None:
    raw = {
        "manifest_version": "qmd-repo-sources/v2",
        "manifest_status": "approved",
        "estate_type": "monolith",
        "context_pack_id": "subtree-pack",
        "qmd_scope_root": "qmd/context-packs/subtree-pack",
        "primary_working_repo_ids": [],
        "primary_focus_area_ids": ["backend"],
        "repositories": [
            {
                "repo_id": "src",
                "repo_name": "Src",
                "local_paths": [
                    {
                        "host": "/repos/monolith/src",
                        "container": None,
                        "git_root": "/repos/monolith",
                    }
                ],
                "repo_category": "unknown",
                "repo_focus": "primary",
            }
        ],
    }

    model = validate_manifest_v2(raw)

    assert model.repositories is not None
    assert model.repositories[0].local_paths[0].git_root == "/repos/monolith"
    dumped = dump_manifest_v2(model)
    assert dumped["repositories"][0]["local_paths"] == [
        {
            "host": "/repos/monolith/src",
            "container": None,
            "git_root": "/repos/monolith",
        }
    ]
