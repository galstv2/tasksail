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


def atomic_write_text(path: Path, text: str) -> None:
    """Write *text* to *path* durably via temp file + ``os.replace``.

    ``flush`` + ``os.fsync`` run before the rename so the data is on disk
    before the rename becomes observable — without the fsync, a crash can
    leave the rename durable but the file contents lost or truncated.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fp:
            fp.write(text)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp_path_str, str(path))
    except BaseException:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            logger.warning("Failed to remove temp file %s during atomic write cleanup", tmp_path_str)
        raise


def atomic_write_json(
    path: Path,
    payload: Mapping[str, object],
) -> None:
    """Write *payload* as JSON durably via :func:`atomic_write_text`."""
    atomic_write_text(path, json.dumps(payload, indent=2) + "\n")


def read_existing_created_at(path: Path, fallback: str) -> str:
    """Return the ``created_at`` string from a JSON file, or *fallback* when
    the file is missing, unreadable, not an object, or lacks a usable value.
    """
    try:
        payload, _ = load_json_safe(path)
    except OSError:
        # Missing file / permission error: load_json_safe only guards JSON
        # decode errors, so the filesystem read can still raise here.
        return fallback
    if not payload:
        return fallback
    created_at = payload.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        return created_at.strip()
    return fallback
