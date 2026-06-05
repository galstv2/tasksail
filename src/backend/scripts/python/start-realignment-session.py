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

from lib.protocol_output import write_protocol_stderr, write_protocol_stdout

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.mcp.reinforcement.models import AGENT_REWARD_MULTIPLIERS
from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.realignment import RealignmentManager
from src.backend.scripts.python.lib.logging_config import configure_logging

ACTIVE_ITEMS_DIR_RELATIVE_PATH = "AgentWorkSpace/pendingitems/.active-items"


def _active_item_task_id(repo_root: Path) -> str | None:
    """Return the first active task ID found in .active-items/, or None."""
    active_items_dir = repo_root / ACTIVE_ITEMS_DIR_RELATIVE_PATH
    try:
        markers = [
            entry.name
            for entry in active_items_dir.iterdir()
            if not entry.name.endswith(".completing")
        ]
    except FileNotFoundError:
        return None
    if not markers:
        return None
    return markers[0].removesuffix(".md")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start a corrective realignment session",
    )
    parser.add_argument("--repo-root", default=str(ROOT_DIR))
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--trigger-task-id", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_logging(stack="py", service="start-realignment-session")
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
        write_protocol_stderr(str(json.dumps(error)) + '\n')
        return 1

    store = ReinforcementStore(
        repo_root,
        legacy_context_pack_dir=context_pack_dir,
    )
    mgr = RealignmentManager(store)
    session = mgr.start_session(
        trigger_task_id=args.trigger_task_id,
        trigger_feedback_id="ui-triggered",
        participating_agents=list(AGENT_REWARD_MULTIPLIERS.keys()),
    )

    write_protocol_stdout(str(json.dumps(session.as_dict(), indent=2)) + '\n')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
