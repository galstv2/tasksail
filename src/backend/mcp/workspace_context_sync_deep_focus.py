from __future__ import annotations

from typing import Any


TARGET_KINDS = {"directory", "file"}


def normalize_deep_focus_selection(
    *,
    deep_focus_enabled: bool = False,
    selected_focus_path: str | None = None,
    selected_focus_target_kind: str | None = None,
    selected_test_target: dict[str, Any] | None = None,
    selected_test_target_provided: bool = False,
    selected_support_targets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if not deep_focus_enabled:
        return {
            "deep_focus_enabled": False,
            "selected_focus_path": None,
            "selected_focus_target_kind": None,
            "selected_support_targets": [],
        }

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

    result = {
        "deep_focus_enabled": True,
        "selected_focus_path": selected_focus_path,
        "selected_focus_target_kind": selected_focus_target_kind,
        "selected_support_targets": normalize_deep_focus_targets(
            selected_support_targets, field_name="selected_support_targets"
        ),
    }
    if selected_test_target_provided:
        result["selected_test_target"] = normalize_deep_focus_target(
            selected_test_target, field_name="selected_test_target"
        )
    return result


def load_deep_focus_selection_from_state(state: dict[str, Any]) -> dict[str, Any]:
    return normalize_deep_focus_selection(
        deep_focus_enabled=state.get("deep_focus_enabled") is True,
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
        "selected_focus_path": source["selected_focus_path"],
        "selected_focus_target_kind": source["selected_focus_target_kind"],
        "selected_support_targets": source["selected_support_targets"],
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
