from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.backend.mcp.workspace_context_sync_service import (
    WorkspaceContextSyncService,
)


ACTIONS = ("preview", "apply", "clear")


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
            )
        elif args.action == "apply":
            payload = service.apply_sync(
                Path(args.context_pack_dir),
                selected_repo_ids=args.selected_repo_id,
                selected_focus_ids=args.selected_focus_id,
                scope_mode=args.scope_mode,
            )
        else:
            payload = service.clear_context_pack_workspace()
    except ValueError as exc:
        print(f"Workspace sync failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2))
    return 0
