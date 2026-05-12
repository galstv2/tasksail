"""Tests for PackSeedState validator (Phase 5 G4)."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.pack_schemas.pack_seed_state import (
    PackSeedState,
    validate_pack_seed_state,
)
from src.backend.mcp.repo_context_mcp.record_factory import (
    pack_seed_state_path,
    state_file_path,
)

# ---------------------------------------------------------------------------
# validate_pack_seed_state — valid inputs
# ---------------------------------------------------------------------------


def test_valid_seeded_minimal() -> None:
    result = validate_pack_seed_state({"state": "seeded"})
    assert isinstance(result, PackSeedState)
    assert result.state == "seeded"
    assert result.created_at is None
    assert result.reason is None
    assert result.last_seed_at is None
    assert result.last_seed_run_id is None
    assert result.details is None


def test_valid_bootstrap_empty_full() -> None:
    result = validate_pack_seed_state({
        "state": "bootstrap-empty",
        "created_at": "2026-05-09T00:00:00Z",
        "reason": "new-flow-seed-opted-out",
        "details": {
            "plan_overall_status": "ready",
            "plan_repo_statuses": ["ready"],
            "plan_parsed": True,
        },
    })
    assert result.state == "bootstrap-empty"
    assert result.created_at == "2026-05-09T00:00:00Z"
    assert result.reason == "new-flow-seed-opted-out"
    assert result.details == {
        "plan_overall_status": "ready",
        "plan_repo_statuses": ["ready"],
        "plan_parsed": True,
    }


def test_valid_seeded_with_lifecycle_fields() -> None:
    result = validate_pack_seed_state({
        "state": "seeded",
        "last_seed_at": "2026-05-09T12:00:00Z",
        "last_seed_run_id": "seed-run-20260509T120000Z",
    })
    assert result.state == "seeded"
    assert result.last_seed_at == "2026-05-09T12:00:00Z"
    assert result.last_seed_run_id == "seed-run-20260509T120000Z"


# ---------------------------------------------------------------------------
# Graceful degradation — unknown / corrupt inputs default to "seeded"
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_state", [
    "seeding-in-progress",  # unknown future state
    "SEEDED",               # wrong case
    "",                     # empty string
])
def test_unknown_state_defaults_to_seeded(bad_state: str) -> None:
    """Unknown state values must default to 'seeded' to avoid false badges."""
    result = validate_pack_seed_state({"state": bad_state})
    assert result.state == "seeded"


def test_missing_state_defaults_to_seeded() -> None:
    result = validate_pack_seed_state({"reason": "orphan"})
    assert result.state == "seeded"


@pytest.mark.parametrize("bad_input", [
    ["garbage"],
    "string",
    42,
])
def test_non_dict_input_defaults_to_seeded(bad_input: object) -> None:
    result = validate_pack_seed_state(bad_input)
    assert result.state == "seeded"


def test_non_string_optional_fields_coerced_to_none() -> None:
    result = validate_pack_seed_state({
        "state": "seeded",
        "created_at": 12345,
        "reason": None,
        "last_seed_at": [],
    })
    assert result.state == "seeded"
    assert result.created_at is None
    assert result.reason is None
    assert result.last_seed_at is None


def test_unknown_top_level_keys_silently_ignored() -> None:
    result = validate_pack_seed_state({
        "state": "bootstrap-empty",
        "future_field": "some-value",
        "another_unknown": 42,
    })
    assert result.state == "bootstrap-empty"


def test_non_dict_details_coerced_to_none() -> None:
    result = validate_pack_seed_state({"state": "bootstrap-empty", "details": "not-a-dict"})
    assert result.details is None


# ---------------------------------------------------------------------------
# pack_seed_state_path vs state_file_path — must be distinct paths
# ---------------------------------------------------------------------------


def test_pack_seed_state_path_is_distinct_from_per_repo_state_file_path() -> None:
    """The pack-level and per-repo seed-state files must live at different paths."""
    scope_dir = Path("/some/scope")
    repo_id = "my-repo"
    pack_path = pack_seed_state_path(scope_dir)
    per_repo_path = state_file_path(scope_dir, repo_id)

    assert pack_path != per_repo_path
    # Pack-level: directly under scope_dir.
    assert pack_path == scope_dir / "seed-state.json"
    # Per-repo: under operational/bootstrap/<repo_id>/.
    assert "operational" in str(per_repo_path)
    assert repo_id in str(per_repo_path)
