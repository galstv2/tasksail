#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lib.protocol_output import write_protocol_stderr, write_protocol_stdout

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.context_estate.bootstrap import bootstrap_context_pack
from src.backend.mcp.context_estate.constants import ALLOWED_DISCOVERY_MODES
from src.backend.scripts.python.lib.logging_config import configure_logging

_MAX_INLINE_BYTES = 32 * 1024


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create or refresh a context pack from structured bootstrap answers "
            "using the shared backend bootstrap model."
        )
    )
    parser.add_argument("--context-pack-dir", required=True)
    answers_group = parser.add_mutually_exclusive_group(required=True)
    answers_group.add_argument(
        "--answers-file",
        help="Path to bootstrap-answers.json. Legacy operator CLI path.",
    )
    answers_group.add_argument(
        "--answers-json",
        help=(
            "Bootstrap answers as inline JSON string, or '-' to read from stdin. "
            "Use '-' (stdin) for IPC callers to avoid argv length limits."
        ),
    )
    parser.add_argument("--discovery-root", required=True)
    parser.add_argument(
        "--mode",
        choices=ALLOWED_DISCOVERY_MODES,
        default="auto",
    )
    parser.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="json",
    )
    return parser.parse_args(argv)


def load_answers(args: argparse.Namespace) -> dict:  # type: ignore[type-arg]
    if args.answers_file:
        answers_path = Path(args.answers_file)
        return json.loads(answers_path.read_text(encoding="utf-8"))  # type: ignore[return-value]
    raw = args.answers_json
    if raw == "-":
        raw = sys.stdin.read()
    else:
        if len(raw.encode("utf-8")) > _MAX_INLINE_BYTES:
            write_protocol_stderr(str("Error: --answers-json inline payload exceeds 32 KiB. "
                "Use '--answers-json -' to read from stdin instead.") + '\n')
            raise SystemExit(1)
    return json.loads(raw)  # type: ignore[return-value]


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
    configure_logging(stack="py", service="bootstrap-context-pack")
    args = parse_args(argv)
    try:
        answers_payload = load_answers(args)
        payload = bootstrap_context_pack(
            Path(args.context_pack_dir),
            answers_payload,
            Path(args.discovery_root),
            requested_mode=args.mode,
        )
    except (ValueError, FileNotFoundError) as exc:
        write_protocol_stderr(str(f"Context-pack bootstrap failed: {exc}") + '\n')
        return 1

    if args.format == "json":
        write_protocol_stdout(str(json.dumps(payload, indent=2)) + '\n')
    else:
        write_protocol_stdout(str(render_markdown(payload)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
