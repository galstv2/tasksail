#!/usr/bin/env python3
"""CLI entrypoint: dismiss an operator-visible realignment recommendation."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lib.protocol_output import write_protocol_stderr, write_protocol_stdout

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.realignment import RealignmentManager
from src.backend.scripts.python.lib.logging_config import configure_logging


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dismiss a corrective realignment recommendation",
    )
    parser.add_argument("--repo-root", default=str(ROOT_DIR))
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--realignment-id", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_logging(stack="py", service="dismiss-realignment-session")
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    context_pack_dir = Path(args.context_pack_dir).resolve()

    store = ReinforcementStore(
        repo_root,
        legacy_context_pack_dir=context_pack_dir,
    )
    manager = RealignmentManager(store)
    result = manager.dismiss_session(args.realignment_id)
    if result["status"] == "blocked":
        write_protocol_stderr(str(json.dumps({
            "error": result["reason"],
            "message": "This realignment cannot be dismissed in its current state.",
        })) + "\n")
        return 1
    if result["status"] == "not_found":
        write_protocol_stderr(str(json.dumps({
            "error": "realignment_not_found",
            "message": f"Realignment session {args.realignment_id} was not found.",
        })) + "\n")
        return 1
    write_protocol_stdout(str(json.dumps(result, indent=2)) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
