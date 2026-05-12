#!/usr/bin/env python3
"""Compatibility/recovery CLI for approving a context estate manifest.

This script is a thin shim into ``context_estate_manifest_cli``.  It is
**not** the primary desktop creation path - all production manifest writes
originate from the Electron create flow, which calls
``src/backend/scripts/python/bootstrap-context-pack.py``.

All manifest writes are routed through
``src/backend/mcp/context_estate/manifest.py::write_approved_manifest()``,
which validates and persists via ``PackWriter.write_manifest()``.  No code
path may write ``qmd/repo-sources.json`` outside ``PackWriter``.

Ref: context-pack-creation-hardening Phase 6 Gate G5.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

if __name__ == "__main__":
    from src.backend.mcp.context_estate_manifest_cli import main

    raise SystemExit(main())
