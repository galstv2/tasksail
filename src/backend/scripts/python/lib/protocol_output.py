from __future__ import annotations

import json
import sys
from typing import Any


def write_protocol_stdout(text: str) -> None:
    sys.stdout.write(text)


def write_protocol_stderr(text: str) -> None:
    sys.stderr.write(text)


def write_protocol_json(
    value: Any,
    *,
    indent: int | None = None,
    sort_keys: bool = False,
    trailing_newline: bool = True,
) -> None:
    rendered = json.dumps(value, indent=indent, sort_keys=sort_keys)
    write_protocol_stdout(f"{rendered}{'' if not trailing_newline else chr(10)}")


__all__ = [
    "write_protocol_stdout",
    "write_protocol_stderr",
    "write_protocol_json",
]
