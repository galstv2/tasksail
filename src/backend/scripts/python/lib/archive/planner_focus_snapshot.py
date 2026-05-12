"""Planner focus snapshot archival helpers."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_or_build_planner_focus_snapshot(
    *,
    repo_root: Path,
    context_pack_dir: Path,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    """Load or synthesize planner focus from immutable task/archive artifacts."""
    task_id = str(payload["task_id"])
    active_snapshot_path = (
        repo_root / "AgentWorkSpace" / "tasks" / task_id
        / ".planner-focus-snapshot.json"
    )
    if active_snapshot_path.exists():
        try:
            parsed = json.loads(active_snapshot_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                return parsed, "active"
        except json.JSONDecodeError:
            pass

    pack_snapshot = _load_json_object(
        repo_root / "AgentWorkSpace" / "tasks" / task_id / "pack-snapshot.json",
    )
    task_sidecar = _load_json_object(
        repo_root / "AgentWorkSpace" / "tasks" / task_id / ".task.json",
    )
    from_pack = _build_from_pack_snapshot(
        pack_snapshot=pack_snapshot,
        task_sidecar=task_sidecar,
        context_pack_dir=context_pack_dir,
        payload=payload,
    )
    if from_pack is not None:
        return from_pack, "pack-snapshot"

    from_archive = _build_from_archive_payload(
        context_pack_dir=context_pack_dir,
        payload=payload,
    )
    if from_archive is not None:
        return from_archive, "archive-payload"
    raise ValueError("no immutable planner focus source found")


def _load_json_object(path: Path) -> dict[str, Any] | None:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _as_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_string(*values: Any) -> str:
    for value in values:
        text = _as_string(value)
        if text:
            return text
    return ""


def _string_list(value: Any) -> list[str]:
    return [item.strip() for item in _as_list(value) if isinstance(item, str) and item.strip()]


def _target_list(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in _as_list(value) if isinstance(item, dict)]


def _target_or_none(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, dict) else None


def _build_from_pack_snapshot(
    *,
    pack_snapshot: dict[str, Any] | None,
    task_sidecar: dict[str, Any] | None,
    context_pack_dir: Path,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    if pack_snapshot is None:
        return None

    primary = _as_object(pack_snapshot.get("primary"))
    deep_focus = _as_object(pack_snapshot.get("deepFocus"))
    sidecar_binding = _as_object(_as_object(task_sidecar).get("contextPackBinding"))
    selection = _as_object(sidecar_binding.get("selection"))

    primary_targets = _target_list(
        deep_focus.get("primaryFocusTargets") or selection.get("selectedFocusTargets"),
    )
    selected_test_target = _target_or_none(
        deep_focus.get("selectedTestTarget") or selection.get("selectedTestTarget"),
    )
    support_targets = _target_list(
        deep_focus.get("supportTargets") or selection.get("selectedSupportTargets"),
    )

    primary_repo_root = _as_string(primary.get("repoRoot"))
    primary_repo_id = _first_string(
        selection.get("deepFocusPrimaryRepoId"),
        selection.get("primaryRepoId"),
        primary.get("repoId"),
        _first_target_value(primary_targets, "repoId"),
        *_string_list(selection.get("selectedRepoIds")),
        Path(primary_repo_root).name if primary_repo_root else "",
    )
    if not primary_repo_root or not primary_repo_id:
        return None

    context_pack_id = _first_string(
        pack_snapshot.get("contextPackId"),
        payload.get("context_pack_id"),
        context_pack_dir.name,
    )
    selected_repo_ids = _string_list(selection.get("selectedRepoIds")) or [primary_repo_id]
    selected_focus_ids = _string_list(selection.get("selectedFocusIds"))
    primary_focus_path = (
        primary.get("primaryFocusRelativePath")
        if primary.get("primaryFocusRelativePath") is not None
        else selection.get("selectedFocusPath")
    )
    primary_focus_kind = (
        deep_focus.get("primaryFocusTargetKind")
        if deep_focus.get("primaryFocusTargetKind") is not None
        else selection.get("selectedFocusTargetKind")
    )
    deep_focus_enabled = bool(deep_focus.get("enabled") or selection.get("deepFocusEnabled"))

    context_binding: dict[str, Any] = {
        "contextPackDir": _first_string(pack_snapshot.get("contextPackDir"), str(context_pack_dir)),
        "contextPackId": context_pack_id,
        "scopeMode": _first_string(selection.get("scopeMode"), "focused"),
        "selectedRepoIds": selected_repo_ids,
        "selectedFocusIds": selected_focus_ids,
        "deepFocusEnabled": deep_focus_enabled,
        "selectedFocusPath": primary_focus_path,
        "selectedFocusTargetKind": primary_focus_kind,
        "selectedFocusTargets": primary_targets,
        "selectedTestTarget": selected_test_target,
        "selectedSupportTargets": support_targets,
    }
    primary_focus_id = _first_string(
        selection.get("deepFocusPrimaryFocusId"),
        selection.get("primaryFocusId"),
        primary.get("focusId"),
        _first_target_value(primary_targets, "focusId"),
    )
    if primary_repo_id:
        context_binding["primaryRepoId"] = primary_repo_id
    if primary_focus_id:
        context_binding["primaryFocusId"] = primary_focus_id

    return {
        "version": 1,
        "contextPackDir": context_binding["contextPackDir"],
        "contextPackId": context_pack_id,
        "title": _first_string(payload.get("task_title"), payload.get("title"), payload.get("task_id")),
        "primaryRepoId": primary_repo_id,
        "primaryRepoRoot": primary_repo_root,
        "primaryFocusRelativePath": primary_focus_path,
        "primaryFocusTargetKind": primary_focus_kind,
        "primaryFocusTargets": primary_targets,
        "selectedTestTarget": selected_test_target,
        "supportTargets": support_targets,
        "deepFocusEnabled": deep_focus_enabled,
        "contextPackBinding": context_binding,
    }


def _first_target_value(targets: list[dict[str, Any]], key: str) -> str:
    for target in targets:
        value = _as_string(target.get(key))
        if value:
            return value
    return ""


def _build_from_archive_payload(
    *,
    context_pack_dir: Path,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    handoffs = [item for item in _as_list(payload.get("branch_handoffs")) if isinstance(item, dict)]
    primary_handoff = _choose_primary_handoff(handoffs)
    primary_repo_root = _first_string(primary_handoff.get("repo_root") if primary_handoff else "")
    if primary_handoff is None or not primary_repo_root:
        return None
    primary_repo_id = _first_string(
        primary_handoff.get("repo_label") if primary_handoff else "",
        Path(primary_repo_root).name,
        payload.get("repo_name"),
        context_pack_dir.name,
    )
    selected_repo_ids = [
        label for label in (_as_string(item.get("repo_label")) for item in handoffs) if label
    ] or [primary_repo_id]
    context_pack_id = _first_string(payload.get("context_pack_id"), context_pack_dir.name)

    context_binding = {
        "contextPackDir": str(context_pack_dir),
        "contextPackId": context_pack_id,
        "scopeMode": "focused",
        "primaryRepoId": primary_repo_id,
        "selectedRepoIds": selected_repo_ids,
        "selectedFocusIds": [],
        "deepFocusEnabled": False,
        "selectedFocusPath": None,
        "selectedFocusTargetKind": None,
        "selectedFocusTargets": [],
        "selectedTestTarget": None,
        "selectedSupportTargets": [],
    }
    return {
        "version": 1,
        "contextPackDir": str(context_pack_dir),
        "contextPackId": context_pack_id,
        "title": _first_string(payload.get("task_title"), payload.get("title"), payload.get("task_id")),
        "primaryRepoId": primary_repo_id,
        "primaryRepoRoot": primary_repo_root,
        "primaryFocusRelativePath": None,
        "primaryFocusTargetKind": None,
        "primaryFocusTargets": [],
        "selectedTestTarget": None,
        "supportTargets": [],
        "deepFocusEnabled": False,
        "contextPackBinding": context_binding,
    }


def _choose_primary_handoff(handoffs: list[dict[str, Any]]) -> dict[str, Any] | None:
    for handoff in handoffs:
        commits_ahead = handoff.get("commits_ahead")
        if isinstance(commits_ahead, int) and commits_ahead > 0:
            return handoff
    return handoffs[0] if handoffs else None
