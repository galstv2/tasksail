#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.context_pack_bootstrap import bootstrap_context_pack


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create or refresh a context pack from structured bootstrap answers "
            "using the shared backend bootstrap model."
        )
    )
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--answers-file", required=True)
    parser.add_argument("--discovery-root", required=True)
    parser.add_argument(
        "--mode",
        choices=("auto", "distributed", "monolith"),
        default="auto",
    )
    parser.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="json",
    )
    return parser.parse_args(argv)


def render_markdown(payload: dict[str, object]) -> str:
    lines = [
        "# Context-Pack Bootstrap",
        "",
        f"- Context pack ID: `{payload['context_pack_id']}`",
        f"- Display name: `{payload['display_name']}`",
        f"- Estate type: `{payload['estate_type']}`",
        f"- Discovery root: `{payload['discovery_root']}`",
        f"- Manifest path: `{payload['manifest_path']}`",
        f"- Draft path: `{payload['draft_path']}`",
        f"- Bootstrap answers path: `{payload['bootstrap_answers_path']}`",
        "",
    ]
    warnings = payload.get("warnings") or []
    if isinstance(warnings, list) and warnings:
        lines.extend(["## Warnings", ""])
        for warning in warnings:
            lines.append(f"- {warning}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    answers_path = Path(args.answers_file)
    try:
        answers_payload = json.loads(answers_path.read_text(encoding="utf-8"))
        payload = bootstrap_context_pack(
            Path(args.context_pack_dir),
            answers_payload,
            Path(args.discovery_root),
            requested_mode=args.mode,
        )
    except ValueError as exc:
        print(f"Context-pack bootstrap failed: {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"Context-pack bootstrap failed: {exc}", file=sys.stderr)
        return 1

    if args.format == "json":
        print(json.dumps(payload, indent=2))
    else:
        print(render_markdown(payload), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
