from __future__ import annotations

from typing import Any

TARGET_KINDS = {"directory", "file"}


def normalize_deep_focus_selection(
    *,
    deep_focus_enabled: bool = False,
    deep_focus_primary_repo_id: str | None = None,
    deep_focus_primary_focus_id: str | None = None,
    selected_focus_path: str | None = None,
    selected_focus_target_kind: str | None = None,
    selected_focus_targets: list[dict[str, Any]] | None = None,
    selected_test_target: dict[str, Any] | None = None,
    selected_test_target_provided: bool = False,
    selected_support_targets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Always persist selections regardless of deep_focus_enabled — the
    # operator may toggle deep focus off temporarily and expects selections
    # to survive across sessions.  Only "Clear All" removes them.
    if selected_focus_path is not None and not isinstance(
        selected_focus_path, str
    ):
        raise ValueError("selected_focus_path must be a string when provided")
    if (
        selected_focus_target_kind is not None
        and selected_focus_target_kind not in TARGET_KINDS
    ):
        raise ValueError(
            "selected_focus_target_kind must be directory or file when provided"
        )

    normalized_test_target = (
        normalize_deep_focus_target(
            selected_test_target, field_name="selected_test_target"
        )
        if selected_test_target_provided
        else None
    )
    normalized_support_targets = normalize_deep_focus_targets(
        selected_support_targets, field_name="selected_support_targets"
    )
    normalized_primary_targets = normalize_primary_focus_targets(
        selected_focus_targets, field_name="selected_focus_targets"
    )
    if not normalized_primary_targets and selected_focus_path is not None:
        synthetic_anchor: dict[str, Any] = {
            "path": selected_focus_path,
            "kind": selected_focus_target_kind
            if selected_focus_target_kind in TARGET_KINDS
            else "directory",
            "role": "anchor",
        }
        if deep_focus_primary_repo_id is not None:
            synthetic_anchor["repo_id"] = deep_focus_primary_repo_id
        if deep_focus_primary_focus_id is not None:
            synthetic_anchor["focus_id"] = deep_focus_primary_focus_id
        normalized_primary_targets = [synthetic_anchor]
    derived = derive_deep_focus_roots(
        selected_focus_path=selected_focus_path,
        selected_focus_target_kind=selected_focus_target_kind,
        selected_focus_targets=normalized_primary_targets,
        selected_test_target=normalized_test_target,
        selected_support_targets=normalized_support_targets,
    )

    result: dict[str, Any] = {
        "deep_focus_enabled": bool(deep_focus_enabled),
        "deep_focus_primary_repo_id": deep_focus_primary_repo_id,
        "deep_focus_primary_focus_id": deep_focus_primary_focus_id,
        "selected_focus_path": selected_focus_path,
        "selected_focus_target_kind": selected_focus_target_kind,
        "selected_focus_targets": normalized_primary_targets,
        "selected_support_targets": normalized_support_targets,
        **derived,
    }
    if selected_test_target_provided:
        result["selected_test_target"] = normalized_test_target
    return result


def load_deep_focus_selection_from_state(state: dict[str, Any]) -> dict[str, Any]:
    return normalize_deep_focus_selection(
        deep_focus_enabled=state.get("deep_focus_enabled") is True,
        deep_focus_primary_repo_id=state.get("deep_focus_primary_repo_id"),
        deep_focus_primary_focus_id=state.get("deep_focus_primary_focus_id"),
        selected_focus_path=state.get("selected_focus_path"),
        selected_focus_target_kind=state.get("selected_focus_target_kind"),
        selected_focus_targets=state.get("selected_focus_targets"),
        selected_test_target=state.get("selected_test_target"),
        selected_test_target_provided="selected_test_target" in state,
        selected_support_targets=state.get("selected_support_targets"),
    )


def normalize_deep_focus_target(
    value: Any, *, field_name: str
) -> dict[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object or null")

    path = value.get("path")
    kind = value.get("kind")
    if not isinstance(path, str):
        raise ValueError(f"{field_name}.path must be a string")
    if kind not in TARGET_KINDS:
        raise ValueError(f"{field_name}.kind must be directory or file")
    return {"path": path, "kind": kind}


def extract_deep_focus_fields(source: dict[str, Any]) -> dict[str, Any]:
    """Extract deep focus fields from a resolved target or preview dict."""
    fields: dict[str, Any] = {
        "deep_focus_enabled": source["deep_focus_enabled"],
        "deep_focus_primary_repo_id": source.get("deep_focus_primary_repo_id"),
        "deep_focus_primary_focus_id": source.get("deep_focus_primary_focus_id"),
        "selected_focus_path": source["selected_focus_path"],
        "selected_focus_target_kind": source["selected_focus_target_kind"],
        "selected_focus_targets": source.get("selected_focus_targets") or [],
        "selected_support_targets": source["selected_support_targets"],
        "derived_writable_roots": source["derived_writable_roots"],
        "derived_readonly_context_roots": source[
            "derived_readonly_context_roots"
        ],
    }
    if "selected_test_target" in source:
        fields["selected_test_target"] = source["selected_test_target"]
    return fields


def normalize_deep_focus_targets(
    value: Any, *, field_name: str
) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list when provided")

    result: list[dict[str, str]] = []
    for index, item in enumerate(value):
        normalized = normalize_deep_focus_target(
            item, field_name=f"{field_name}[{index}]"
        )
        if normalized is None:
            raise ValueError(f"{field_name}[{index}] must not be null")
        result.append(normalized)
    return result


def normalize_primary_focus_targets(
    value: Any, *, field_name: str
) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list when provided")

    result: list[dict[str, Any]] = []
    explicit_anchor = False
    for index, item in enumerate(value):
        normalized = normalize_deep_focus_target(
            item, field_name=f"{field_name}[{index}]"
        )
        if normalized is None:
            raise ValueError(f"{field_name}[{index}] must not be null")
        role = item.get("role") if isinstance(item, dict) else None
        if role is not None and role not in {"anchor", "primary"}:
            raise ValueError(
                f"{field_name}[{index}].role must be anchor or primary"
            )
        if role == "anchor":
            if explicit_anchor:
                raise ValueError(f"{field_name} must contain at most one anchor")
            explicit_anchor = True
        # Preserve per-primary scoped fields so the TS → Python → TS round-trip
        # stays lossless. Accept both snake_case and camelCase on input (the
        # state file may have been written by either side); always emit
        # snake_case to match Python conventions.
        scoped: dict[str, Any] = {}
        if isinstance(item, dict):
            repo_local_path = item.get("repo_local_path", item.get("repoLocalPath"))
            if repo_local_path is not None:
                if not isinstance(repo_local_path, str):
                    raise ValueError(
                        f"{field_name}[{index}].repo_local_path must be a string"
                    )
                scoped["repo_local_path"] = repo_local_path
            repo_id = item.get("repo_id", item.get("repoId"))
            if repo_id is not None:
                if not isinstance(repo_id, str):
                    raise ValueError(
                        f"{field_name}[{index}].repo_id must be a string"
                    )
                scoped["repo_id"] = repo_id
            focus_id = item.get("focus_id", item.get("focusId"))
            if focus_id is not None:
                if not isinstance(focus_id, str):
                    raise ValueError(
                        f"{field_name}[{index}].focus_id must be a string"
                    )
                scoped["focus_id"] = focus_id
            raw_test_target = item.get("test_target", item.get("testTarget"))
            if raw_test_target is not None:
                scoped["test_target"] = normalize_deep_focus_target(
                    raw_test_target,
                    field_name=f"{field_name}[{index}].test_target",
                )
            raw_support_targets = item.get(
                "support_targets",
                item.get("supportTargets"),
            )
            if raw_support_targets is not None:
                scoped["support_targets"] = normalize_deep_focus_targets(
                    raw_support_targets,
                    field_name=f"{field_name}[{index}].support_targets",
                )
        result.append({**normalized, **({"role": role} if role else {}), **scoped})
    if not result:
        return []
    anchor_index = next(
        (index for index, target in enumerate(result) if target.get("role") == "anchor"),
        0,
    )
    return [
        {
            **target,
            "role": "anchor" if index == anchor_index else "primary",
        }
        for index, target in enumerate(result)
    ]


def derive_deep_focus_roots(
    *,
    selected_focus_path: str | None,
    selected_focus_target_kind: str | None,
    selected_focus_targets: list[dict[str, Any]],
    selected_test_target: dict[str, str] | None,
    selected_support_targets: list[dict[str, str]],
) -> dict[str, list[dict[str, Any]]]:
    writable_roots: list[dict[str, Any]] = []
    readonly_roots: list[dict[str, Any]] = []

    primary_path = normalize_relative_path(selected_focus_path or "")
    primary_kind = (
        selected_focus_target_kind
        if selected_focus_target_kind in TARGET_KINDS
        else "directory"
    )
    primary_targets = selected_focus_targets or [
        {"path": primary_path, "kind": primary_kind, "role": "anchor"}
    ]
    anchor_repo_local_path = next(
        (
            target.get("repo_local_path")
            for target in primary_targets
            if target.get("role") == "anchor"
            and isinstance(target.get("repo_local_path"), str)
        ),
        None,
    )
    if anchor_repo_local_path is None and primary_targets:
        first_repo_local_path = primary_targets[0].get("repo_local_path")
        if isinstance(first_repo_local_path, str):
            anchor_repo_local_path = first_repo_local_path
    for primary_target in primary_targets:
        target_path = normalize_relative_path(primary_target["path"])
        target_kind = primary_target["kind"]
        source_target = {
            **primary_target,
            "path": target_path,
        }
        repo_local_path = source_target.get("repo_local_path")
        root_identity = (
            {"repoLocalPath": repo_local_path}
            if isinstance(repo_local_path, str)
            else {}
        )
        if not target_path or target_kind == "directory":
            writable_roots.append(
                {
                    "path": target_path,
                    "kind": "directory",
                    "reason": "selected-primary",
                    **root_identity,
                    "sourceTargets": [source_target],
                }
            )
        else:
            writable_roots.append(
                {
                    "path": parent_relative_path(target_path),
                    "kind": "directory",
                    "reason": "primary-focus-parent",
                    **root_identity,
                    "sourceTargets": [source_target],
                }
            )
        primary_test_target = primary_target.get("test_target")
        if isinstance(primary_test_target, dict):
            writable_roots.append(
                {
                    "path": normalize_relative_path(primary_test_target["path"]),
                    "kind": primary_test_target["kind"],
                    "reason": "scoped-test-target",
                    **root_identity,
                }
            )
        primary_support_targets = primary_target.get("support_targets")
        if isinstance(primary_support_targets, list):
            for target in primary_support_targets:
                if not isinstance(target, dict):
                    continue
                readonly_roots.append(
                    {
                        "path": normalize_relative_path(target["path"]),
                        "kind": target["kind"],
                        "reason": "scoped-support-target",
                        **root_identity,
                    }
                )

    if selected_test_target is not None:
        anchor_identity = (
            {"repoLocalPath": anchor_repo_local_path}
            if isinstance(anchor_repo_local_path, str)
            else {}
        )
        writable_roots.append(
            {
                "path": normalize_relative_path(selected_test_target["path"]),
                "kind": selected_test_target["kind"],
                "reason": "test-target",
                **anchor_identity,
            }
        )

    for target in selected_support_targets:
        anchor_identity = (
            {"repoLocalPath": anchor_repo_local_path}
            if isinstance(anchor_repo_local_path, str)
            else {}
        )
        readonly_roots.append(
            {
                "path": normalize_relative_path(target["path"]),
                "kind": target["kind"],
                "reason": "support-target",
                **anchor_identity,
            }
        )

    return {
        "derived_writable_roots": dedupe_roots(writable_roots),
        "derived_readonly_context_roots": dedupe_roots(readonly_roots),
    }


def normalize_relative_path(value: str) -> str:
    candidate = value.replace("\\", "/").strip()
    if candidate.startswith("/"):
        raise ValueError(
            f"Path {value!r} must be a repo-relative path, not absolute."
        )
    return candidate.rstrip("/")


def parent_relative_path(value: str) -> str:
    normalized = normalize_relative_path(value)
    if "/" not in normalized:
        return ""
    return normalized.rsplit("/", 1)[0]


def dedupe_roots(roots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    result: list[dict[str, Any]] = []
    for root in roots:
        key = (
            str(root.get("repoLocalPath") or ""),
            root["path"],
            root["kind"],
            root["reason"],
        )
        existing = seen.get(key)
        if existing is not None:
            merge_source_targets(existing, root)
            continue
        seen[key] = root
        result.append(root)
    return result


def merge_source_targets(existing: dict[str, Any], incoming: dict[str, Any]) -> None:
    incoming_targets = incoming.get("sourceTargets")
    if not isinstance(incoming_targets, list):
        return
    existing_targets = existing.setdefault("sourceTargets", [])
    if not isinstance(existing_targets, list):
        existing["sourceTargets"] = incoming_targets
        return
    seen_targets = {
        (
            target.get("repo_local_path"),
            target.get("repo_id"),
            target.get("focus_id"),
            target.get("path"),
            target.get("kind"),
        )
        for target in existing_targets
        if isinstance(target, dict)
    }
    for target in incoming_targets:
        if not isinstance(target, dict):
            continue
        key = (
            target.get("repo_local_path"),
            target.get("repo_id"),
            target.get("focus_id"),
            target.get("path"),
            target.get("kind"),
        )
        if key in seen_targets:
            continue
        seen_targets.add(key)
        existing_targets.append(target)
