#!/usr/bin/env python3
"""CLI entrypoint: update the Global Realignment Document.

Invoked by the TS platform layer (reinforcementWrite.ts).  Accepts
field updates as CLI flags or JSON on stdin.  Outputs the updated
document to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.mcp.reinforcement.fairness import FairnessManager, VersionConflictError
from src.backend.mcp.reinforcement.persistence import ReinforcementStore


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update the Global Realignment Document",
    )
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--field", default=None, help="Field name to update")
    parser.add_argument("--value", default=None, help="JSON-encoded value")
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Read full update payload from stdin as JSON",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    context_pack_dir = Path(args.context_pack_dir).resolve()

    store = ReinforcementStore(repo_root, legacy_context_pack_dir=context_pack_dir)
    manager = FairnessManager(store)

    if args.stdin:
        updates = json.load(sys.stdin)
    elif args.field and args.value is not None:
        updates = {args.field: json.loads(args.value)}
    else:
        print("Provide --field/--value or --stdin", file=sys.stderr)
        return 1

    try:
        doc = manager.update_global_document(updates)
    except VersionConflictError as exc:
        print(json.dumps({"error": "version_conflict", "message": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(doc.as_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
