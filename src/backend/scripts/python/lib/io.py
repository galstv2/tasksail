"""File I/O helpers shared across platform scripts."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def load_text(path: Path) -> str:
    """Read *path* as UTF-8.  Returns ``""`` when the file is missing."""
    return path.read_text(encoding="utf-8") if path.exists() else ""


def load_json(path: Path) -> dict[str, Any]:
    """Load a JSON object from *path*.

    Raises ``json.JSONDecodeError`` on malformed JSON and ``TypeError``
    if the top-level value is not an object.
    """
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected a JSON object, got {type(payload).__name__}")
    return payload


def load_json_safe(
    path: Path,
) -> tuple[dict[str, Any] | None, str | None]:
    """Load a JSON object, returning ``(payload, None)`` on success or
    ``(None, error_message)`` on failure.
    """
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return None, f"JSON parse failed ({exc.msg})"
    if not isinstance(payload, dict):
        return None, "JSON payload must be an object"
    return payload, None


def write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write *payload* as pretty-printed JSON using the backend
    ``write_text_atomic`` helper (temp-file + rename within the same
    directory).

    This variant is used by callers that already depend on the backend
    ``src.backend.mcp.repo_context_mcp.utils`` package.
    """
    from importlib import import_module

    _utils = import_module("src.backend.mcp.repo_context_mcp.utils")
    _utils.write_text_atomic(
        path,
        json.dumps(payload, indent=2, sort_keys=False) + "\n",
    )


def atomic_write_json(
    path: Path,
    payload: Mapping[str, object],
) -> None:
    """Write *payload* as JSON via a temp file + ``os.replace`` for
    atomicity.  Does **not** depend on the backend utilities package.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, indent=2)
            fp.write("\n")
        os.replace(tmp_path_str, str(path))
    except BaseException:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            logger.warning("Failed to remove temp file %s during atomic write cleanup", tmp_path_str)
        raise
