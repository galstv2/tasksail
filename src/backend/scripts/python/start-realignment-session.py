#!/usr/bin/env python3
"""CLI entrypoint: start a corrective realignment session from the UI.

Invoked by the TS platform layer (reinforcementWrite.ts).  Checks the
active-work guardrail before creating the session.  Outputs JSON to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.mcp.reinforcement.models import ROLE_MULTIPLIERS
from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.realignment import RealignmentManager

ACTIVE_ITEM_RELATIVE_PATH = "AgentWorkSpace/pendingitems/.active-item"


def _active_item_task_id(repo_root: Path) -> str | None:
    """Return the active task ID if a valid .active-item claim exists."""
    marker = repo_root / ACTIVE_ITEM_RELATIVE_PATH
    try:
        name = marker.read_text().strip()
    except FileNotFoundError:
        return None
    if not name:
        return None
    pending_file = repo_root / "AgentWorkSpace" / "pendingitems" / name
    if not pending_file.exists():
        return None
    return name.removesuffix(".md")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start a corrective realignment session",
    )
    parser.add_argument("--repo-root", default=str(ROOT_DIR))
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--trigger-task-id", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    context_pack_dir = Path(args.context_pack_dir).resolve()

    active_task = _active_item_task_id(repo_root)
    if active_task is not None:
        error = {
            # Must match desktopContract.ERROR_CODE_ACTIVE_WORK_BLOCKED
            "error": "active_work_blocked",
            "message": (
                f'Corrective realignment is blocked while pending item '
                f'"{active_task}" is active. Complete or remove the active '
                f'item before starting realignment.'
            ),
            "activeTaskId": active_task,
        }
        print(json.dumps(error), file=sys.stderr)
        return 1

    store = ReinforcementStore(
        repo_root,
        legacy_context_pack_dir=context_pack_dir,
    )
    mgr = RealignmentManager(store)
    session = mgr.start_session(
        trigger_task_id=args.trigger_task_id,
        trigger_feedback_id="ui-triggered",
        participating_agents=list(ROLE_MULTIPLIERS.keys()),
    )

    print(json.dumps(session.as_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
