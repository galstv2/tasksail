from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.backend.mcp.workspace_context_sync_deep_focus import (
    normalize_deep_focus_selection,
)
from src.backend.mcp.workspace_context_sync_service import (
    WorkspaceContextSyncService,
)

ACTIONS = ("preview", "apply", "clear")


def parse_json_argument(
    value: str | None, *, argument_name: str
) -> dict | list | None:
    if value is None:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{argument_name} must be valid JSON") from exc
    if parsed is None:
        return None
    if not isinstance(parsed, (dict, list)):
        raise ValueError(f"{argument_name} must decode to an object or null")
    return parsed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview, apply, or clear context-pack-managed workspace folder "
            "changes."
        )
    )
    parser.add_argument(
        "--action",
        choices=ACTIONS,
        required=True,
        help="Workspace sync action to perform.",
    )
    parser.add_argument(
        "--context-pack-dir",
        help="Path to the approved context pack directory.",
    )
    parser.add_argument(
        "--workspace-root",
        default=".",
        help="Workspace root containing the managed .code-workspace file.",
    )
    parser.add_argument(
        "--workspace-file",
        default="tasksail.code-workspace",
        help=(
            "Workspace file path relative to --workspace-root unless "
            "absolute."
        ),
    )
    parser.add_argument(
        "--state-file",
        default=".platform-state/workspace-context-sync.json",
        help=(
            "Sync state file path relative to --workspace-root unless "
            "absolute."
        ),
    )
    parser.add_argument(
        "--selected-repo-id",
        action="append",
        default=[],
        help="Optional selected repo id; may be repeated.",
    )
    parser.add_argument(
        "--selected-focus-id",
        action="append",
        default=[],
        help="Optional selected monolith focus id; may be repeated.",
    )
    parser.add_argument(
        "--scope-mode",
        choices=("focused",),
        default="focused",
        help="Scope mode contract forwarded into the sync service.",
    )
    parser.add_argument(
        "--deep-focus-enabled",
        action="store_true",
        default=False,
        help="Persist deep focus metadata alongside the selection.",
    )
    parser.add_argument(
        "--deep-focus-primary-repo-id",
        default=None,
        help="Deep focus primary repo id (singular, distributed packs).",
    )
    parser.add_argument(
        "--deep-focus-primary-focus-id",
        default=None,
        help="Deep focus primary focus area id (singular, monolith packs).",
    )
    parser.add_argument(
        "--selected-focus-path",
        default=None,
        help="Optional repo-relative primary focus path.",
    )
    parser.add_argument(
        "--selected-focus-target-kind",
        choices=("directory", "file"),
        default=None,
        help="Optional primary focus target kind.",
    )
    parser.add_argument(
        "--selected-test-target",
        default=None,
        help='Optional JSON object or null, e.g. {"path":"tests","kind":"directory"}.',
    )
    parser.add_argument(
        "--selected-support-target",
        action="append",
        default=[],
        help='Optional JSON object; may be repeated, e.g. {"path":"docs","kind":"directory"}.',
    )
    parser.add_argument(
        "--format",
        choices=("json",),
        default="json",
        help="Output format for stdout.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.action in {"preview", "apply"} and not args.context_pack_dir:
        print(
            f"--action {args.action} requires --context-pack-dir",
            file=sys.stderr,
        )
        return 1

    try:
        selected_test_target = parse_json_argument(
            args.selected_test_target,
            argument_name="--selected-test-target",
        )
        if selected_test_target is not None and not isinstance(
            selected_test_target, dict
        ):
            raise ValueError(
                "--selected-test-target must decode to an object or null"
            )
        selected_support_targets = [
            parse_json_argument(
                value,
                argument_name="--selected-support-target",
            )
            for value in args.selected_support_target
        ]
        if not all(
            isinstance(target, dict) for target in selected_support_targets
        ):
            raise ValueError(
                "--selected-support-target values must decode to objects"
            )
        deep_focus = normalize_deep_focus_selection(
            deep_focus_enabled=args.deep_focus_enabled,
            deep_focus_primary_repo_id=args.deep_focus_primary_repo_id,
            deep_focus_primary_focus_id=args.deep_focus_primary_focus_id,
            selected_focus_path=args.selected_focus_path,
            selected_focus_target_kind=args.selected_focus_target_kind,
            selected_test_target=selected_test_target,
            selected_test_target_provided=args.selected_test_target is not None,
            selected_support_targets=selected_support_targets,
        )
        service = WorkspaceContextSyncService(
            workspace_root=Path(args.workspace_root),
            workspace_file=args.workspace_file,
            state_file=args.state_file,
        )
        if args.action == "preview":
            payload = service.preview_sync(
                Path(args.context_pack_dir),
                selected_repo_ids=args.selected_repo_id,
                selected_focus_ids=args.selected_focus_id,
                scope_mode=args.scope_mode,
                deep_focus=deep_focus,
            )
        elif args.action == "apply":
            payload = service.apply_sync(
                Path(args.context_pack_dir),
                selected_repo_ids=args.selected_repo_id,
                selected_focus_ids=args.selected_focus_id,
                scope_mode=args.scope_mode,
                deep_focus=deep_focus,
            )
        else:
            payload = service.clear_context_pack_workspace()
    except ValueError as exc:
        print(f"Workspace sync failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2))
    return 0
