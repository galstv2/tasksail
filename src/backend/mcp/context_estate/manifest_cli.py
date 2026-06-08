from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from src.backend.mcp.repo_context_mcp.utils import utc_now
from src.backend.scripts.python.lib.logging_config import configure_logging
from src.backend.scripts.python.lib.protocol_output import write_protocol_stdout

from .manifest import DEFAULT_MANIFEST_FILE, approve_manifest_from_files

logger = logging.getLogger(__name__)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate reviewed discovery data and persist an approved "
            "context-pack manifest."
        )
    )
    parser.add_argument(
        "--context-pack-dir",
        required=True,
        help="Path to the context pack directory.",
    )
    parser.add_argument(
        "--review-file",
        required=True,
        help="Path to the reviewed approval input JSON.",
    )
    parser.add_argument(
        "--draft-file",
        default="qmd/bootstrap/discovery-structure.json",
        help=(
            "Path to the discovery draft artifact relative to the "
            "context pack "
            "directory unless absolute."
        ),
    )
    parser.add_argument(
        "--manifest",
        default=DEFAULT_MANIFEST_FILE,
        help=(
            "Path to the approved manifest relative to the context pack "
            "directory unless absolute."
        ),
    )
    parser.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="json",
        help="Output format for stdout.",
    )
    return parser.parse_args(argv)


def render_markdown(payload: dict[str, object]) -> str:
    lines = [
        "# Approved Context-Pack Manifest",
        "",
        f"- Context pack ID: `{payload['context_pack_id']}`",
        f"- Display name: `{payload['display_name']}`",
        f"- Estate type: `{payload['estate_type']}`",
        f"- Manifest path: `{payload['manifest_path']}`",
        f"- Approved at: `{payload['approved_at']}`",
        "",
    ]

    repositories = payload.get("repositories") or []
    if isinstance(repositories, list) and repositories:
        lines.extend(["## Repositories", ""])
        for repo in repositories:
            if isinstance(repo, dict):
                lines.append(f"- `{repo['repo_id']}`")
        lines.append("")

    focusable_areas = payload.get("focusable_areas") or []
    if isinstance(focusable_areas, list) and focusable_areas:
        lines.extend(["## Focusable areas", ""])
        for area in focusable_areas:
            if isinstance(area, dict):
                lines.append(f"- `{area['focus_id']}`")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    configure_logging(stack="py", service="context-estate-manifest")
    args = parse_args(argv)
    try:
        manifest_path, manifest_payload = approve_manifest_from_files(
            context_pack_dir=Path(args.context_pack_dir),
            review_file=Path(args.review_file),
            approved_at=utc_now(),
            draft_file=args.draft_file,
            manifest_file=args.manifest,
        )
    except ValueError as exc:
        logger.error(
            "context_estate.manifest.approval_failed",
            extra={"error": str(exc), "context_pack_dir": args.context_pack_dir},
        )
        return 1

    output_payload = {
        "approved_at": manifest_payload["approved_at"],
        "context_pack_id": manifest_payload["context_pack_id"],
        "display_name": manifest_payload["display_name"],
        "estate_type": manifest_payload["estate_type"],
        "manifest_path": str(manifest_path),
        "repositories": manifest_payload.get("repositories", []),
        "focusable_areas": manifest_payload.get("focusable_areas", []),
    }

    if args.format == "json":
        write_protocol_stdout(str(json.dumps(output_payload, indent=2)) + '\n')
    else:
        write_protocol_stdout(str(render_markdown(output_payload)))
    return 0
