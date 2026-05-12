#!/usr/bin/env python3
"""CLI shim: write an empty scope tree for a new-flow context pack.

Called from TypeScript (main.contextPackActions.ts) via runPythonScriptCommand
after the planner step when np.initGitRepos === true && np.seedOnCreate === false.
Prints a JSON summary on stdout.

Usage:
    python write-stub-scope-tree.py \\
        --context-pack-dir <path> \\
        [--plan-overall-status <str>] \\
        [--plan-repo-statuses-json <json-array>]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Write an empty scope tree for a new-flow context pack.")
    parser.add_argument("--context-pack-dir", required=True, help="Absolute path to the context pack directory.")
    parser.add_argument("--plan-overall-status", default=None, help="overall_status from the seed plan JSON.")
    parser.add_argument("--plan-repo-statuses-json", default=None, help="JSON array of per-repo status strings from the seed plan.")
    args = parser.parse_args()

    context_pack_dir = Path(args.context_pack_dir).resolve()
    manifest_path = context_pack_dir / "qmd" / "repo-sources.json"

    plan_overall_status: str | None = args.plan_overall_status
    plan_repo_statuses: list[str] | None = None
    if args.plan_repo_statuses_json is not None:
        try:
            parsed = json.loads(args.plan_repo_statuses_json)
            if isinstance(parsed, list):
                plan_repo_statuses = [str(s) for s in parsed if isinstance(s, str)]
        except (json.JSONDecodeError, TypeError):
            pass  # non-fatal; treated as plan_parsed=False in _derive_reason

    # Import here so the sys.path is set up correctly when invoked from the
    # repo root (where PYTHONPATH includes the project root).
    from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree  # noqa: PLC0415

    result = write_empty_scope_tree(
        context_pack_dir=context_pack_dir,
        manifest_path=manifest_path,
        plan_overall_status=plan_overall_status,
        plan_repo_statuses=plan_repo_statuses,
    )

    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"wrote": False, "error": str(exc)}))
        sys.exit(1)
