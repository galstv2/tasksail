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
    derived = derive_deep_focus_roots(
        selected_focus_path=selected_focus_path,
        selected_focus_target_kind=selected_focus_target_kind,
        selected_test_target=normalized_test_target,
        selected_support_targets=normalized_support_targets,
    )

    result: dict[str, Any] = {
        "deep_focus_enabled": bool(deep_focus_enabled),
        "deep_focus_primary_repo_id": deep_focus_primary_repo_id,
        "deep_focus_primary_focus_id": deep_focus_primary_focus_id,
        "selected_focus_path": selected_focus_path,
        "selected_focus_target_kind": selected_focus_target_kind,
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


def derive_deep_focus_roots(
    *,
    selected_focus_path: str | None,
    selected_focus_target_kind: str | None,
    selected_test_target: dict[str, str] | None,
    selected_support_targets: list[dict[str, str]],
) -> dict[str, list[dict[str, str]]]:
    writable_roots: list[dict[str, str]] = []
    readonly_roots: list[dict[str, str]] = []

    primary_path = normalize_relative_path(selected_focus_path or "")
    primary_kind = (
        selected_focus_target_kind
        if selected_focus_target_kind in TARGET_KINDS
        else "directory"
    )
    if not primary_path or primary_kind == "directory":
        writable_roots.append(
            {
                "path": primary_path,
                "kind": "directory",
                "reason": "selected-primary",
            }
        )
    else:
        writable_roots.append(
            {
                "path": parent_relative_path(primary_path),
                "kind": "directory",
                "reason": "primary-focus-parent",
            }
        )

    if selected_test_target is not None:
        writable_roots.append(
            {
                "path": normalize_relative_path(selected_test_target["path"]),
                "kind": selected_test_target["kind"],
                "reason": "test-target",
            }
        )

    for target in selected_support_targets:
        readonly_roots.append(
            {
                "path": normalize_relative_path(target["path"]),
                "kind": target["kind"],
                "reason": "support-target",
            }
        )

    return {
        "derived_writable_roots": dedupe_roots(writable_roots),
        "derived_readonly_context_roots": dedupe_roots(readonly_roots),
    }


def normalize_relative_path(value: str) -> str:
    return value.replace("\\", "/").strip().strip("/")


def parent_relative_path(value: str) -> str:
    normalized = normalize_relative_path(value)
    if "/" not in normalized:
        return ""
    return normalized.rsplit("/", 1)[0]


def dedupe_roots(roots: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str, str]] = set()
    result: list[dict[str, str]] = []
    for root in roots:
        key = (root["path"], root["kind"], root["reason"])
        if key in seen:
            continue
        seen.add(key)
        result.append(root)
    return result
