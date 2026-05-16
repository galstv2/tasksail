"""Backward-compatible shim — re-exports from context_estate subpackage."""
from __future__ import annotations

import argparse
import json
import logging
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
from src.backend.scripts.python.lib.logging_config import configure_logging
from src.backend.scripts.python.lib.protocol_output import write_protocol_stdout

# Keep CLI entry point here since it's the script entrypoint
OUTPUT_FORMATS = ("json", "markdown")
logger = logging.getLogger(__name__)


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
    configure_logging(stack="py", service="context-estate-discovery")
    args = parse_args(argv)
    if args.write_qmd_draft and not args.context_pack_dir:
        logger.error(
            "context_estate.discovery.missing_context_pack_dir",
            extra={"argument": "--context-pack-dir"},
        )
        return 1

    if args.mode == "auto":
        logger.warning(
            "context_estate.discovery.auto_mode",
            extra={"mode": args.mode},
        )

    try:
        payload = discover_estate(args.root, mode=args.mode)
    except ValueError as exc:
        logger.error(
            "context_estate.discovery.failed",
            extra={"error": str(exc), "root": args.root, "mode": args.mode},
        )
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
            logger.error(
                "context_estate.discovery.qmd_draft_write_failed",
                extra={"error": str(exc), "context_pack_dir": args.context_pack_dir},
            )
            return 1

        payload = dict(payload)
        payload["qmd_draft_artifact_path"] = str(draft_path)
        payload["qmd_draft_artifact_status"] = "written"

    if args.format == "json":
        write_protocol_stdout(str(json.dumps(payload, indent=2)) + '\n')
    else:
        write_protocol_stdout(str(render_markdown(payload)))
    return 0
