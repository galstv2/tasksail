"""Typed dataclass model and validator for seed-plan.json (SeedPlan)."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Literal, cast, get_args

from src.backend.mcp.pack_schemas.errors import PackSchemaError

# Closed-set status enumerations (G2 §Required changes — `Literal` for closed enums).
# Source of truth for emitted values: src/backend/scripts/python/plan-qmd-seeding.py
# (lines 267–289 set `"ready" | "blocked" | "needs-review"`; line 348 sets overall
# to `"ready" | "needs-review"`).
SeedPlanRepositoryStatus = Literal["ready", "blocked", "needs-review"]
SeedPlanOverallStatus = Literal["ready", "needs-review"]


@dataclass(slots=True)
class SeedPlanRepository:
    repo_id: str
    repo_name: str
    status: SeedPlanRepositoryStatus
    system_layer: str
    owner: str | None
    bounded_context: str | None
    languages: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    existing_roots: list[str] = field(default_factory=list)
    missing_roots: list[str] = field(default_factory=list)
    scan_targets: list[str] = field(default_factory=list)
    qmd_targets: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SeedPlan:
    plan_type: str
    plan_version: str
    manifest_version: str
    context_pack_id: str
    context_pack_dir: str
    manifest_path: str
    qmd_scope_root: str
    overall_status: SeedPlanOverallStatus
    repository_count: int
    ready_count: int
    blocked_count: int
    warning_count: int
    repositories: list[SeedPlanRepository] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)


_PLAN_REQUIRED = {
    "plan_type",
    "plan_version",
    "manifest_version",
    "context_pack_id",
    "context_pack_dir",
    "manifest_path",
    "qmd_scope_root",
    "overall_status",
    "repository_count",
    "ready_count",
    "blocked_count",
    "warning_count",
    "repositories",
}

_REPO_REQUIRED = {"repo_id", "repo_name", "status", "system_layer"}

_REPO_STATUS_VALUES: frozenset[str] = frozenset(get_args(SeedPlanRepositoryStatus))
_OVERALL_STATUS_VALUES: frozenset[str] = frozenset(get_args(SeedPlanOverallStatus))


def _validate_repo(raw: Any, index: int, errors: list[str]) -> SeedPlanRepository | None:
    if not isinstance(raw, dict):
        errors.append(f"repositories[{index}] must be a JSON object")
        return None
    missing = [f for f in _REPO_REQUIRED if f not in raw]
    if missing:
        errors.append(f"repositories[{index}] missing required fields: {missing}")
        return None
    status = str(raw["status"])
    if status not in _REPO_STATUS_VALUES:
        errors.append(
            f"repositories[{index}].status must be one of "
            f"{sorted(_REPO_STATUS_VALUES)}, got {status!r}"
        )
        return None
    return SeedPlanRepository(
        repo_id=str(raw["repo_id"]),
        repo_name=str(raw["repo_name"]),
        status=cast(SeedPlanRepositoryStatus, status),
        system_layer=str(raw["system_layer"]),
        owner=raw.get("owner"),
        bounded_context=raw.get("bounded_context"),
        languages=list(raw.get("languages") or []),
        tags=list(raw.get("tags") or []),
        existing_roots=list(raw.get("existing_roots") or []),
        missing_roots=list(raw.get("missing_roots") or []),
        scan_targets=list(raw.get("scan_targets") or []),
        qmd_targets=dict(raw.get("qmd_targets") or {}),
        warnings=list(raw.get("warnings") or []),
    )


def validate_plan(
    d: dict[str, Any],
    *,
    path: str | None = None,
) -> SeedPlan:
    """Validate a raw dict against SeedPlan, collecting all errors.

    Raises PackSchemaError if any validation errors are found.
    Ignores unknown keys for forward-compat.
    Status fields are validated against the closed Literal sets defined above.
    """
    errors: list[str] = []

    if not isinstance(d, dict):
        raise PackSchemaError("SeedPlan", ["Expected a JSON object"], path=path)

    missing_top = [f for f in _PLAN_REQUIRED if f not in d]
    if missing_top:
        errors.append(f"Missing required fields: {missing_top}")

    overall_status_raw = str(d["overall_status"]) if "overall_status" in d else ""
    if overall_status_raw and overall_status_raw not in _OVERALL_STATUS_VALUES:
        errors.append(
            f"overall_status must be one of "
            f"{sorted(_OVERALL_STATUS_VALUES)}, got {overall_status_raw!r}"
        )

    repositories: list[SeedPlanRepository] = []
    raw_repos = d.get("repositories")
    if raw_repos is not None:
        if not isinstance(raw_repos, list):
            errors.append("'repositories' must be a list")
        else:
            for i, raw_repo in enumerate(raw_repos):
                repo = _validate_repo(raw_repo, i, errors)
                if repo is not None:
                    repositories.append(repo)

    if errors:
        raise PackSchemaError("SeedPlan", errors, path=path)

    return SeedPlan(
        plan_type=str(d["plan_type"]),
        plan_version=str(d["plan_version"]),
        manifest_version=str(d["manifest_version"]),
        context_pack_id=str(d["context_pack_id"]),
        context_pack_dir=str(d["context_pack_dir"]),
        manifest_path=str(d["manifest_path"]),
        qmd_scope_root=str(d["qmd_scope_root"]),
        overall_status=cast(SeedPlanOverallStatus, overall_status_raw),
        repository_count=int(d["repository_count"]),
        ready_count=int(d["ready_count"]),
        blocked_count=int(d["blocked_count"]),
        warning_count=int(d["warning_count"]),
        repositories=repositories,
        next_steps=list(d.get("next_steps") or []),
    )


def dump_plan(model: SeedPlan) -> dict[str, Any]:
    """Convert a SeedPlan to a dict.

    Preserves None values (serialized as JSON null) since the plan schema
    uses explicit null for optional fields like owner and bounded_context.
    """
    return dataclasses.asdict(model)
