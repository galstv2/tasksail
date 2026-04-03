"""Context estate discovery, manifest approval, and bootstrap orchestration."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure repo root is on sys.path so ``src.backend.*`` imports resolve from
# any submodule in this package.
_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
