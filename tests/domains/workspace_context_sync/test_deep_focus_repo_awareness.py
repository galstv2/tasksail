from __future__ import annotations

import pytest

from src.backend.mcp.workspace_context_sync_deep_focus import (
    dedupe_roots,
    derive_deep_focus_roots,
    normalize_deep_focus_selection,
    normalize_primary_focus_targets,
    normalize_relative_path,
)


def test_normalize_preserves_repo_identity_on_each_target() -> None:
    synthetic = normalize_deep_focus_selection(
        deep_focus_enabled=True,
        deep_focus_primary_repo_id="platform",
        deep_focus_primary_focus_id="billing",
        selected_focus_path="src",
        selected_focus_target_kind="directory",
    )

    assert synthetic["selected_focus_targets"] == [
        {
            "path": "src",
            "kind": "directory",
            "role": "anchor",
            "repo_id": "platform",
            "focus_id": "billing",
        }
    ]

    assert normalize_primary_focus_targets(
        [
            {
                "path": "src",
                "kind": "directory",
                "role": "anchor",
                "repoLocalPath": "/repos/platform",
                "repoId": "platform",
                "focusId": "platform-src",
            },
            {
                "path": "src",
                "kind": "directory",
                "repo_local_path": "/repos/tools",
                "repo_id": "tools",
                "focus_id": "tools-src",
            },
        ],
        field_name="selected_focus_targets",
    ) == [
        {
            "path": "src",
            "kind": "directory",
            "role": "anchor",
            "repo_local_path": "/repos/platform",
            "repo_id": "platform",
            "focus_id": "platform-src",
        },
        {
            "path": "src",
            "kind": "directory",
            "repo_local_path": "/repos/tools",
            "repo_id": "tools",
            "focus_id": "tools-src",
            "role": "primary",
        },
    ]


def test_derive_deep_focus_roots_includes_repo_local_path_per_root() -> None:
    result = derive_deep_focus_roots(
        selected_focus_path=None,
        selected_focus_target_kind=None,
        selected_focus_targets=[
            {
                "path": "src/app.py",
                "kind": "file",
                "role": "anchor",
                "repo_local_path": "/repos/platform",
                "repo_id": "platform",
                "focus_id": "platform-src",
                "test_target": {
                    "path": "tests/app",
                    "kind": "directory",
                },
                "support_targets": [
                    {
                        "path": "docs/app.md",
                        "kind": "file",
                    }
                ],
            },
            {
                "path": "src/app.py",
                "kind": "file",
                "role": "primary",
                "repo_local_path": "/repos/tools",
                "repo_id": "tools",
                "focus_id": "tools-src",
                "test_target": {
                    "path": "tests/app",
                    "kind": "directory",
                },
                "support_targets": [
                    {
                        "path": "docs/app.md",
                        "kind": "file",
                    }
                ],
            },
        ],
        selected_test_target={
            "path": "tests/global",
            "kind": "directory",
        },
        selected_support_targets=[
            {
                "path": "docs/global.md",
                "kind": "file",
            }
        ],
    )

    assert result["derived_writable_roots"] == [
        {
            "path": "src",
            "kind": "directory",
            "reason": "primary-focus-parent",
            "repoLocalPath": "/repos/platform",
            "sourceTargets": [
                {
                    "path": "src/app.py",
                    "kind": "file",
                    "role": "anchor",
                    "repo_local_path": "/repos/platform",
                    "repo_id": "platform",
                    "focus_id": "platform-src",
                    "test_target": {
                        "path": "tests/app",
                        "kind": "directory",
                    },
                    "support_targets": [
                        {
                            "path": "docs/app.md",
                            "kind": "file",
                        }
                    ],
                }
            ],
        },
        {
            "path": "tests/app",
            "kind": "directory",
            "reason": "scoped-test-target",
            "repoLocalPath": "/repos/platform",
        },
        {
            "path": "src",
            "kind": "directory",
            "reason": "primary-focus-parent",
            "repoLocalPath": "/repos/tools",
            "sourceTargets": [
                {
                    "path": "src/app.py",
                    "kind": "file",
                    "role": "primary",
                    "repo_local_path": "/repos/tools",
                    "repo_id": "tools",
                    "focus_id": "tools-src",
                    "test_target": {
                        "path": "tests/app",
                        "kind": "directory",
                    },
                    "support_targets": [
                        {
                            "path": "docs/app.md",
                            "kind": "file",
                        }
                    ],
                }
            ],
        },
        {
            "path": "tests/app",
            "kind": "directory",
            "reason": "scoped-test-target",
            "repoLocalPath": "/repos/tools",
        },
        {
            "path": "tests/global",
            "kind": "directory",
            "reason": "test-target",
            "repoLocalPath": "/repos/platform",
        },
    ]
    assert result["derived_readonly_context_roots"] == [
        {
            "path": "docs/app.md",
            "kind": "file",
            "reason": "scoped-support-target",
            "repoLocalPath": "/repos/platform",
        },
        {
            "path": "docs/app.md",
            "kind": "file",
            "reason": "scoped-support-target",
            "repoLocalPath": "/repos/tools",
        },
        {
            "path": "docs/global.md",
            "kind": "file",
            "reason": "support-target",
            "repoLocalPath": "/repos/platform",
        },
    ]


def test_global_support_target_uses_its_own_repo_identity() -> None:
    result = normalize_deep_focus_selection(
        deep_focus_enabled=True,
        deep_focus_primary_repo_id="platform",
        selected_focus_path="",
        selected_focus_target_kind="directory",
        selected_focus_targets=[
            {
                "path": "",
                "kind": "directory",
                "role": "anchor",
                "repo_local_path": "/repos/platform",
                "repo_id": "platform",
            }
        ],
        selected_support_targets=[
            {
                "path": "Acme.Cli",
                "kind": "directory",
                "repoLocalPath": "/repos/tools",
                "repoId": "tools",
            }
        ],
    )

    assert result["selected_support_targets"] == [
        {
            "path": "Acme.Cli",
            "kind": "directory",
            "repo_local_path": "/repos/tools",
            "repo_id": "tools",
        }
    ]
    assert result["derived_readonly_context_roots"] == [
        {
            "path": "Acme.Cli",
            "kind": "directory",
            "reason": "support-target",
            "repoLocalPath": "/repos/tools",
        }
    ]


def test_dedupe_does_not_collapse_same_path_across_different_repos() -> None:
    roots = dedupe_roots(
        [
            {
                "path": "src",
                "kind": "directory",
                "reason": "selected-primary",
                "repoLocalPath": "/repos/platform",
            },
            {
                "path": "src",
                "kind": "directory",
                "reason": "selected-primary",
                "repoLocalPath": "/repos/tools",
            },
        ]
    )

    assert roots == [
        {
            "path": "src",
            "kind": "directory",
            "reason": "selected-primary",
            "repoLocalPath": "/repos/platform",
        },
        {
            "path": "src",
            "kind": "directory",
            "reason": "selected-primary",
            "repoLocalPath": "/repos/tools",
        },
    ]


def test_dedupe_does_collapse_same_path_within_same_repo() -> None:
    roots = dedupe_roots(
        [
            {
                "path": "src",
                "kind": "directory",
                "reason": "selected-primary",
                "repoLocalPath": "/repos/platform",
                "sourceTargets": [
                    {
                        "path": "src/app.py",
                        "kind": "file",
                        "repo_local_path": "/repos/platform",
                        "repo_id": "platform",
                        "focus_id": "app",
                    }
                ],
            },
            {
                "path": "src",
                "kind": "directory",
                "reason": "selected-primary",
                "repoLocalPath": "/repos/platform",
                "sourceTargets": [
                    {
                        "path": "src/app.py",
                        "kind": "file",
                        "repo_local_path": "/repos/platform",
                        "repo_id": "platform",
                        "focus_id": "app",
                    },
                    {
                        "path": "src/api.py",
                        "kind": "file",
                        "repo_local_path": "/repos/platform",
                        "repo_id": "platform",
                        "focus_id": "api",
                    },
                ],
            },
        ]
    )

    assert roots == [
        {
            "path": "src",
            "kind": "directory",
            "reason": "selected-primary",
            "repoLocalPath": "/repos/platform",
            "sourceTargets": [
                {
                    "path": "src/app.py",
                    "kind": "file",
                    "repo_local_path": "/repos/platform",
                    "repo_id": "platform",
                    "focus_id": "app",
                },
                {
                    "path": "src/api.py",
                    "kind": "file",
                    "repo_local_path": "/repos/platform",
                    "repo_id": "platform",
                    "focus_id": "api",
                },
            ],
        }
    ]


def test_legacy_targets_without_repo_local_path_round_trip_unchanged() -> None:
    assert normalize_deep_focus_selection(
        deep_focus_enabled=True,
        deep_focus_primary_repo_id="platform",
        deep_focus_primary_focus_id="billing",
        selected_focus_path="src/app.py",
        selected_focus_target_kind="file",
        selected_focus_targets=[
            {
                "path": "src/app.py",
                "kind": "file",
                "role": "anchor",
            },
            {
                "path": "src/api.py",
                "kind": "file",
                "role": "primary",
            },
        ],
    ) == {
        "deep_focus_enabled": True,
        "deep_focus_primary_repo_id": "platform",
        "deep_focus_primary_focus_id": "billing",
        "selected_focus_path": "src/app.py",
        "selected_focus_target_kind": "file",
        "selected_focus_targets": [
            {
                "path": "src/app.py",
                "kind": "file",
                "role": "anchor",
            },
            {
                "path": "src/api.py",
                "kind": "file",
                "role": "primary",
            },
        ],
        "selected_support_targets": [],
        "derived_writable_roots": [
            {
                "path": "src",
                "kind": "directory",
                "reason": "primary-focus-parent",
                "sourceTargets": [
                    {
                        "path": "src/app.py",
                        "kind": "file",
                        "role": "anchor",
                    },
                    {
                        "path": "src/api.py",
                        "kind": "file",
                        "role": "primary",
                    },
                ],
            }
        ],
        "derived_readonly_context_roots": [],
    }


def test_derive_deep_focus_roots_emits_scoped_reason_for_per_primary_test_target() -> None:
    # Per-primary test/support targets must be tagged with `scoped-*` reasons
    # so downstream consumers can distinguish them from global ones.
    result = derive_deep_focus_roots(
        selected_focus_path=None,
        selected_focus_target_kind=None,
        selected_focus_targets=[
            {
                "path": "src/api",
                "kind": "directory",
                "role": "anchor",
                "test_target": {"path": "tests/api", "kind": "directory"},
                "support_targets": [{"path": "libs/api-shared", "kind": "directory"}],
            },
        ],
        selected_test_target=None,
        selected_support_targets=[],
    )
    test_reasons = [
        r["reason"]
        for r in result["derived_writable_roots"]
        if r.get("path") == "tests/api"
    ]
    support_reasons = [
        r["reason"]
        for r in result["derived_readonly_context_roots"]
        if r.get("path") == "libs/api-shared"
    ]
    assert "scoped-test-target" in test_reasons
    assert "scoped-support-target" in support_reasons


def test_derive_deep_focus_roots_emits_global_reason_for_top_level_targets() -> None:
    # Global slots stay untagged ("test-target" / "support-target") to
    # preserve the existing reason taxonomy for non-scoped roots.
    result = derive_deep_focus_roots(
        selected_focus_path="src",
        selected_focus_target_kind="directory",
        selected_focus_targets=[
            {"path": "src", "kind": "directory", "role": "anchor"},
        ],
        selected_test_target={"path": "tests", "kind": "directory"},
        selected_support_targets=[{"path": "libs/shared", "kind": "directory"}],
    )
    test_reasons = [r["reason"] for r in result["derived_writable_roots"]]
    support_reasons = [r["reason"] for r in result["derived_readonly_context_roots"]]
    assert "test-target" in test_reasons
    assert "support-target" in support_reasons


def test_normalize_relative_path_rejects_absolute_path() -> None:
    # Mirrors the TS rejection of leading-slash paths via
    # getInvalidRelativePathReason. Prior behavior silently stripped.
    with pytest.raises(ValueError):
        normalize_relative_path("/src/api")


def test_normalize_relative_path_accepts_repo_relative_path() -> None:
    assert normalize_relative_path("src/api/") == "src/api"
    assert normalize_relative_path("src/api") == "src/api"
