"""Backward-compatible shim — re-exports from context_estate subpackage."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.backend.mcp.context_estate.constants import (  # noqa: F401
    ALLOWED_DISCOVERY_MODES,
    DEFAULT_DISTRIBUTED_SCAN_DEPTH,
    DIRECT_FOCUS_TYPES,
    ESTATE_TYPES,
    GROUP_CHILD_TYPES,
    HIGH_SIGNAL_TYPE_ALIASES,
    SKIP_DIR_NAMES,
)

# Re-export all public discovery symbols
from src.backend.mcp.context_estate.discovery import (  # noqa: F401
    build_focus_area,
    build_high_signal_entry,
    build_repo_candidate,
    classify_high_signal,
    collect_repo_high_signal_paths,
    collect_root_high_signal_paths,
    discover_candidate_focus_areas,
    discover_candidate_repos,
    discover_estate,
    has_git_marker,
    normalize_directory_candidate,
    resolve_existing_root,
    safe_iterdir,
)
from src.backend.mcp.context_estate.rendering import render_markdown  # noqa: F401
from src.backend.mcp.context_estate_draft_index import (
    DEFAULT_DRAFT_FILE,
    write_draft_artifact,
)
from src.backend.mcp.repo_context_mcp.utils import utc_now  # noqa: F401

# Keep CLI entry point here since it's the script entrypoint
OUTPUT_FORMATS = ("json", "markdown")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scan a distributed-estate root or monolith root and emit a "
            "machine-readable draft discovery model."
        )
    )
    parser.add_argument(
        "--root",
        required=True,
        help="Path to the discovery root.",
    )
    parser.add_argument(
        "--mode",
        choices=ALLOWED_DISCOVERY_MODES,
        default="auto",
        help="Discovery mode. Defaults to auto-inference.",
    )
    parser.add_argument(
        "--format",
        choices=OUTPUT_FORMATS,
        default="json",
        help="Output format for stdout.",
    )
    parser.add_argument(
        "--write-qmd-draft",
        action="store_true",
        help="Write the discovery output into a QMD draft structure artifact.",
    )
    parser.add_argument(
        "--context-pack-dir",
        help=(
            "Path to the context pack directory that should receive the QMD "
            "draft artifact."
        ),
    )
    parser.add_argument(
        "--draft-file",
        default=DEFAULT_DRAFT_FILE,
        help=(
            "Path to the draft artifact relative to --context-pack-dir unless "
            "absolute."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.write_qmd_draft and not args.context_pack_dir:
        print(
            "--write-qmd-draft requires --context-pack-dir",
            file=sys.stderr,
        )
        return 1

    if args.mode == "auto":
        print(
            "[WARN] --mode auto: estate type will be inferred from directory structure. "
            "Pass an explicit mode for deterministic output.",
            file=sys.stderr,
        )

    try:
        payload = discover_estate(args.root, mode=args.mode)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.write_qmd_draft:
        try:
            draft_path = write_draft_artifact(
                Path(args.context_pack_dir),
                payload,
                generated_at=utc_now(),
                draft_file=args.draft_file,
            )
        except ValueError as exc:
            print(f"QMD draft write failed: {exc}", file=sys.stderr)
            return 1

        payload = dict(payload)
        payload["qmd_draft_artifact_path"] = str(draft_path)
        payload["qmd_draft_artifact_status"] = "written"

    if args.format == "json":
        print(json.dumps(payload, indent=2))
    else:
        print(render_markdown(payload), end="")
    return 0
