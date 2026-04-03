#!/usr/bin/env python3
"""Thin CLI launcher for the repo-context-mcp application.

All implementation lives in src/backend/mcp/repo_context_mcp/.  This file
exists so that host-side shell scripts can invoke the app without
needing PYTHONPATH or ``-m`` flags.
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.backend.mcp.repo_context_mcp.app import main  # noqa: E402

raise SystemExit(main())
