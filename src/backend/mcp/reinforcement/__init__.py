"""Agentic reinforcement engine — per-context-pack reward tracking."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure repo root is on sys.path so ``scripts.python.lib.*`` imports work
# from any submodule in this package.
_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
