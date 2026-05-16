#!/usr/bin/env python3
"""Explicit v1→v2 pack schema upgrade CLI.

Upgrades one or more context pack manifests from v1 to v2 format.
Prints a JSON line per pack describing the action taken.
Exits 0 if all packs upgrade or are already v2, 1 if any fail.

Usage:
    python upgrade-pack-schema.py --context-pack-dir <path> [--dry-run]
    python upgrade-pack-schema.py --all-under <root-dir> [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from lib.protocol_output import write_protocol_stdout

# Ensure repo root is on sys.path.
_REPO_ROOT = Path(__file__).resolve().parents[4]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.backend.mcp.pack_constants import MANIFEST_VERSION_V2
from src.backend.mcp.pack_io import write_text_atomic
from src.backend.mcp.pack_schemas import canonicalize, dump_manifest_v2, validate_manifest_v2
from src.backend.mcp.pack_schemas.upgrade import (
    build_repo_roots_from_manifest,
    upgrade_manifest_file_atomic,
    upgrade_v1_to_v2,
)
from src.backend.scripts.python.lib.logging_config import bind, configure_logging

logger = bind(logging.getLogger(__name__), module="scripts/python/upgrade-pack-schema")


def _read_manifest(manifest_path: Path) -> dict | None:
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(
            "pack_schema_upgrade.manifest.load.failed",
            extra={
                "manifest_path": str(manifest_path),
                "error": str(exc),
            },
            exc_info=True,
        )
        return None


def _process_pack(
    context_pack_dir: Path,
    *,
    dry_run: bool,
) -> dict:
    manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
    result: dict = {
        "path": str(manifest_path),
        "context_pack_dir": str(context_pack_dir),
        "current_version": None,
        "target_version": MANIFEST_VERSION_V2,
        "action": None,
        "reason": None,
    }

    if not manifest_path.exists():
        result["action"] = "skip"
        result["reason"] = "manifest_not_found"
        return result

    raw = _read_manifest(manifest_path)
    if raw is None:
        result["action"] = "skip"
        result["reason"] = "schema_error"
        return result

    current_version = raw.get("manifest_version") or ""
    result["current_version"] = current_version

    if current_version == MANIFEST_VERSION_V2:
        try:
            model = validate_manifest_v2(raw, path=str(manifest_path))
            normalized = dump_manifest_v2(model)
            changed = canonicalize(normalized) != canonicalize(raw)
            if changed and not dry_run:
                write_text_atomic(manifest_path, canonicalize(normalized) + "\n")
        except Exception as exc:
            logger.error(
                "pack_schema_upgrade.pack.failed",
                extra={
                    "context_pack_dir": str(context_pack_dir),
                    "manifest_path": str(manifest_path),
                    "phase": "normalize_v2",
                    "current_version": current_version,
                    "dry_run": dry_run,
                    "error": str(exc),
                },
                exc_info=True,
            )
            result["action"] = "skip"
            result["reason"] = f"error: {exc}"
            return result

        result["action"] = "upgrade" if changed else "noop"
        prefix = "dry_run: " if dry_run and changed else ""
        result["reason"] = (
            f"{prefix}normalize local_paths"
            if changed
            else "already_v2"
        )
        return result

    try:
        repo_roots = build_repo_roots_from_manifest(raw)
        if dry_run:
            upgrade_v1_to_v2(raw, repo_roots=repo_roots)
        else:
            upgrade_manifest_file_atomic(
                manifest_path, repo_roots=repo_roots, raw=raw,
            )
    except Exception as exc:
        logger.error(
            "pack_schema_upgrade.pack.failed",
            extra={
                "context_pack_dir": str(context_pack_dir),
                "manifest_path": str(manifest_path),
                "phase": "upgrade_v1_to_v2",
                "current_version": current_version,
                "dry_run": dry_run,
                "error": str(exc),
            },
            exc_info=True,
        )
        # Action stays in {upgrade,noop,skip}; failures are reported as skip
        # with a "error:"-prefixed reason so the exit-code logic can detect them.
        result["action"] = "skip"
        result["reason"] = f"error: {exc}"
        return result

    result["action"] = "upgrade"
    suffix = "dry_run: " if dry_run else ""
    result["reason"] = f"{suffix}{current_version!r} -> {MANIFEST_VERSION_V2!r}"
    return result


def _find_packs_under(root: Path) -> list[Path]:
    """Find all context pack directories (those with qmd/repo-sources.json) under root."""
    packs: list[Path] = []
    for manifest_path in sorted(root.rglob("qmd/repo-sources.json")):
        packs.append(manifest_path.parent.parent)
    return packs


def main() -> int:
    configure_logging(stack="py", service="upgrade-pack-schema")
    parser = argparse.ArgumentParser(
        description="Upgrade context pack manifests from v1 to v2."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--context-pack-dir",
        help="Path to a single context pack directory.",
    )
    group.add_argument(
        "--all-under",
        help="Root directory to search for context packs recursively.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print what would be changed without writing any files.",
    )
    # Tolerate the literal '--' separator that pnpm/npm forwards from
    # `pnpm run upgrade-pack-schema -- --all-under <root> --dry-run`. Without
    # this, argparse treats '--' as an "end of options" marker but still tries
    # to consume the trailing args as positionals, which fails since this
    # parser has none.
    argv = [a for a in sys.argv[1:] if a != "--"]
    args = parser.parse_args(argv)

    packs: list[Path]
    if args.context_pack_dir:
        packs = [Path(args.context_pack_dir).resolve()]
    else:
        root = Path(args.all_under).resolve()
        packs = _find_packs_under(root)
        if not packs:
            # Also check if the root itself is a pack
            if (root / "qmd" / "repo-sources.json").exists():
                packs = [root]

    if not packs:
        write_protocol_stdout(str(json.dumps({"status": "no_packs_found", "searched": str(args.all_under)})) + '\n')
        return 0

    any_error = False
    for pack_dir in packs:
        result = _process_pack(pack_dir, dry_run=args.dry_run)
        write_protocol_stdout(str(json.dumps(result)) + '\n')
        reason = result.get("reason") or ""
        if isinstance(reason, str) and reason.startswith("error:"):
            any_error = True

    return 1 if any_error else 0


if __name__ == "__main__":
    sys.exit(main())
