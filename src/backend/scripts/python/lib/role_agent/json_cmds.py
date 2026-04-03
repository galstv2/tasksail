"""JSON utility commands."""
from __future__ import annotations

import argparse
import json

from ..cli import fail


def cmd_print_json_array_lines(args: argparse.Namespace) -> int:
    """Print each item of a JSON array on its own line."""
    try:
        payload = json.loads(args.json_payload)
    except json.JSONDecodeError as exc:
        fail(f"JSON array payload must be valid JSON ({exc.msg}).")
    if not isinstance(payload, list):
        fail("JSON array payload must decode to a JSON array.")
    for item in payload:
        value = str(item).strip()
        if value:
            print(value)
    return 0
