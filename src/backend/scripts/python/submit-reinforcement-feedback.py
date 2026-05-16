#!/usr/bin/env python3
"""CLI entrypoint: submit operator feedback for a completed task.

Invoked by the TS platform layer (reinforcementWrite.ts).  Outputs JSON
to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lib.protocol_output import write_protocol_stdout

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.mcp.reinforcement.engine import ReinforcementEngine
from src.backend.mcp.reinforcement.models import ROLE_MULTIPLIERS
from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.qmd_writer import QmdRewardWriter
from src.backend.mcp.reinforcement.realignment import RealignmentManager
from src.backend.scripts.python.lib.logging_config import configure_logging


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Submit reinforcement feedback for a task",
    )
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[4]))
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--task-id", required=True)
    parser.add_argument(
        "--feedback-type",
        required=True,
        choices=("none", "positive", "negative"),
    )
    parser.add_argument("--star-rating", type=int, default=None)
    parser.add_argument("--comment", default="")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_logging(stack="py", service="submit-reinforcement-feedback")
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    context_pack_dir = Path(args.context_pack_dir).resolve()

    store = ReinforcementStore(
        repo_root,
        legacy_context_pack_dir=context_pack_dir,
    )
    qmd_writer = QmdRewardWriter(repo_root)
    engine = ReinforcementEngine(store, qmd_writer=qmd_writer)

    result = engine.record_feedback(
        task_id=args.task_id,
        feedback_type=args.feedback_type,
        star_rating=args.star_rating,
        comment=args.comment,
    )

    if result.get("realignment_recommended"):
        mgr = RealignmentManager(store)
        session = mgr.start_session(
            trigger_task_id=args.task_id,
            trigger_feedback_id=result["event"]["feedback_id"],
            participating_agents=list(ROLE_MULTIPLIERS.keys()),
        )
        result["realignment_session"] = session.as_dict()

    write_protocol_stdout(str(json.dumps(result, indent=2)) + '\n')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
