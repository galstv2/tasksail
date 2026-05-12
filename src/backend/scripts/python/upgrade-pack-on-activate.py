#!/usr/bin/env python3
"""Lazy v1→v2 manifest upgrade, invoked during context pack activation.

Reads qmd/repo-sources.json from the context pack directory. If it is a v1
manifest, upgrades it in-place (atomic write). Exits 0 on success or no-op,
exits 1 on error (writes a JSON error line to stdout).

Usage:
    python upgrade-pack-on-activate.py --context-pack-dir <path> [--repo-root <path>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Ensure repo root is on sys.path so src.backend.* imports work.
_SCRIPT_DIR = Path(__file__).resolve()
_REPO_ROOT = _SCRIPT_DIR.parents[4]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.backend.mcp.pack_schemas.upgrade import (
    build_repo_roots_from_manifest,
    upgrade_manifest_file_atomic,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Lazy v1→v2 manifest upgrade for context pack activation.",
    )
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--repo-root", default=None)
    args = parser.parse_args()

    context_pack_dir = Path(args.context_pack_dir).resolve()
    repo_root_arg = Path(args.repo_root).resolve() if args.repo_root else None
    manifest_path = context_pack_dir / "qmd" / "repo-sources.json"

    if not manifest_path.exists():
        return 0

    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        fallback_base = repo_root_arg or manifest_path.parent.parent
        repo_roots = build_repo_roots_from_manifest(raw, fallback_base=fallback_base)
        upgraded = upgrade_manifest_file_atomic(
            manifest_path, repo_roots=repo_roots, raw=raw,
        )
        if upgraded:
            print(json.dumps({"status": "upgraded", "path": str(manifest_path)}))
        else:
            print(json.dumps({"status": "already_v2", "path": str(manifest_path)}))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
