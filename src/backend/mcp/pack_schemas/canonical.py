from __future__ import annotations

import json
from typing import Any


def canonicalize(obj: Any) -> str:
    """Return a stable JSON string with recursively sorted keys and 2-space indent.

    Output is byte-for-byte identical to the TypeScript packSchemas.canonical.ts
    implementation for all fixture values used in this codebase.
    """
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False, separators=(",", ": "))
