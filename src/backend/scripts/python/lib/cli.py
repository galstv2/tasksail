"""CLI helpers shared across platform scripts."""
from __future__ import annotations

from typing import NoReturn

from .protocol_output import write_protocol_stderr


def fail(message: str) -> NoReturn:
    """Print *message* to stderr and exit with code 1."""
    write_protocol_stderr(str(message) + '\n')
    raise SystemExit(1)
