"""CLI helpers shared across platform scripts."""
from __future__ import annotations

import sys
from typing import NoReturn


def fail(message: str) -> NoReturn:
    """Print *message* to stderr and exit with code 1."""
    print(message, file=sys.stderr)
    raise SystemExit(1)
