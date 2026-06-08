"""Reseed marker and pack seed-state lifecycle helpers for SeedingService.

These helpers keep the main service module below the 500-LOC limit.  All
callers reside within the ``repo_context_mcp.services`` package; do not import
this module from ``app.py``, ``transport/``, or frontend code.
"""
from __future__ import annotations

import errno
import json
import logging
import os
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.backend.mcp.pack_schemas.pack_seed_state import (
    PackSeedState,
    validate_pack_seed_state,
)
from src.backend.scripts.python.lib.locking import (
    acquire_file_lock,
    release_file_lock,
)

from ..record_factory import pack_seed_state_path
from ..utils import utc_now, write_json_atomic

logger = logging.getLogger(__name__)

RESEED_MARKER_FILENAME = ".reseed-in-progress.json"
RESEED_MARKER_STALE_AFTER_SECONDS = 3600
RESEED_RECLAIM_LOCK_TIMEOUT_SECONDS = 30.0
RESEED_IN_PROGRESS_ERROR_CODE = "reseed_in_progress"


@dataclass(slots=True)
class ReseedAlreadyInProgressError(RuntimeError):
    pid: int | None
    host: str | None
    started_at: str | None
    same_host: bool
    stale_after_seconds: int

    def __post_init__(self) -> None:
        message = (
            "reseed already in progress"
            f" (pid={self.pid}, host={self.host}, started_at={self.started_at}, "
            f"same_host={self.same_host})"
        )
        self.args = (message,)


def _parse_started_at(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _read_marker_payload(marker_path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(marker_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        logger.warning("reseed_marker: corrupt marker at %s; reclaiming", marker_path)
        return None
    if not isinstance(payload, dict):
        logger.warning("reseed_marker: non-object marker at %s; reclaiming", marker_path)
        return None
    if not isinstance(payload.get("started_at"), str):
        logger.warning("reseed_marker: missing started_at at %s; reclaiming", marker_path)
        return None
    if not isinstance(payload.get("host"), str):
        logger.warning("reseed_marker: missing host at %s; reclaiming", marker_path)
        return None
    if not isinstance(payload.get("pid"), int):
        logger.warning("reseed_marker: missing pid at %s; reclaiming", marker_path)
        return None
    if _parse_started_at(payload["started_at"]) is None:
        logger.warning("reseed_marker: unparseable started_at at %s; reclaiming", marker_path)
        return None
    return payload


def _process_alive_locally(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError as exc:
        if exc.errno == errno.ESRCH:
            return False
        if exc.errno == errno.EPERM:
            return True
        logger.debug("reseed_marker: liveness probe failed for pid %s", pid, exc_info=True)
        return False
    except Exception:  # noqa: BLE001
        logger.warning("reseed_marker: liveness probe unavailable; using TTL fallback")
        return False
    return True


def _marker_is_stale(started_at: str, *, stale_after_seconds: int) -> bool:
    parsed = _parse_started_at(started_at)
    if parsed is None:
        return True
    elapsed = datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)
    return elapsed.total_seconds() > stale_after_seconds


def write_reseed_marker(context_pack_path: Path) -> Path:
    """Write a reseed-in-progress marker and return its path."""
    marker_path = context_pack_path / RESEED_MARKER_FILENAME
    write_json_atomic(
        marker_path,
        {
            "started_at": utc_now(),
            "pid": os.getpid(),
            "host": socket.gethostname(),
        },
    )
    return marker_path


def _exclusive_create_marker(context_pack_path: Path) -> Path:
    """Write marker via O_CREAT|O_EXCL; raises FileExistsError on contention."""
    marker_path = context_pack_path / RESEED_MARKER_FILENAME
    payload = json.dumps(
        {
            "started_at": utc_now(),
            "pid": os.getpid(),
            "host": socket.gethostname(),
        }
    ).encode()
    fd = os.open(str(marker_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    try:
        os.write(fd, payload)
    finally:
        os.close(fd)
    return marker_path


def _same_marker_identity(a: dict, b: dict) -> bool:
    return (
        a.get("started_at") == b.get("started_at")
        and a.get("pid") == b.get("pid")
        and a.get("host") == b.get("host")
    )


def _reclaim_and_exclusive_create(
    context_pack_path: Path,
    marker_path: Path,
    stale_payload: dict | None,
    *,
    stale_after_seconds: int,
) -> Path:
    """Reclaim a stale/corrupt marker exclusively so two reclaimers cannot both win.

    Reclaimers serialize on a flock-based reclaim lock (fcntl.flock / Windows
    msvcrt.locking), which the OS auto-releases on process exit so a crashed
    reclaimer cannot wedge reclamation. Under that lock we re-read the marker
    (compare-and-swap): if another reclaimer already replaced it with a fresh
    marker, defer instead of unlinking theirs. Serializing closes the
    re-read/unlink TOCTOU window; the O_EXCL create remains the final backstop
    against a concurrent (non-reclaiming) fresh acquirer.
    """
    reclaim_lock_path = context_pack_path / (RESEED_MARKER_FILENAME + ".reclaim.lock")
    fd = acquire_file_lock(
        reclaim_lock_path, timeout_seconds=RESEED_RECLAIM_LOCK_TIMEOUT_SECONDS
    )
    try:
        current = _read_marker_payload(marker_path)
        if current is not None and (
            stale_payload is None or not _same_marker_identity(current, stale_payload)
        ):
            raise ReseedAlreadyInProgressError(
                pid=current.get("pid"),
                host=current.get("host"),
                started_at=current.get("started_at"),
                same_host=current.get("host") == socket.gethostname(),
                stale_after_seconds=stale_after_seconds,
            )
        try:
            marker_path.unlink()
        except FileNotFoundError:
            pass
        try:
            return _exclusive_create_marker(context_pack_path)
        except FileExistsError:
            winner = _read_marker_payload(marker_path) or {}
            raise ReseedAlreadyInProgressError(
                pid=winner.get("pid"),
                host=winner.get("host"),
                started_at=winner.get("started_at"),
                same_host=winner.get("host") == socket.gethostname(),
                stale_after_seconds=stale_after_seconds,
            )
    finally:
        release_file_lock(fd)


def acquire_reseed_marker(
    context_pack_path: Path,
    *,
    stale_after_seconds: int = RESEED_MARKER_STALE_AFTER_SECONDS,
) -> Path:
    marker_path = context_pack_path / RESEED_MARKER_FILENAME
    try:
        return _exclusive_create_marker(context_pack_path)
    except FileExistsError:
        pass

    payload = _read_marker_payload(marker_path)
    if payload is None:
        return _reclaim_and_exclusive_create(
            context_pack_path, marker_path, None, stale_after_seconds=stale_after_seconds
        )

    pid = payload["pid"]
    host = payload["host"]
    started_at = payload["started_at"]
    same_host = host == socket.gethostname()
    if same_host:
        if _process_alive_locally(pid):
            raise ReseedAlreadyInProgressError(
                pid=pid,
                host=host,
                started_at=started_at,
                same_host=True,
                stale_after_seconds=stale_after_seconds,
            )
        logger.warning(
            "reseed_marker: stale marker from dead pid %s on this host (started_at %s); reclaiming",
            pid,
            started_at,
        )
        return _reclaim_and_exclusive_create(
            context_pack_path, marker_path, payload, stale_after_seconds=stale_after_seconds
        )

    if _marker_is_stale(started_at, stale_after_seconds=stale_after_seconds):
        logger.warning(
            "reseed_marker: stale marker from foreign host %s (started_at %s); reclaiming",
            host,
            started_at,
        )
        return _reclaim_and_exclusive_create(
            context_pack_path, marker_path, payload, stale_after_seconds=stale_after_seconds
        )

    raise ReseedAlreadyInProgressError(
        pid=pid,
        host=host,
        started_at=started_at,
        same_host=False,
        stale_after_seconds=stale_after_seconds,
    )


def clear_reseed_marker(marker_path: Path) -> None:
    """Remove the reseed marker only if the current process owns it."""
    payload = _read_marker_payload(marker_path)
    if payload is None:
        logger.warning(
            "reseed_marker: clear skipped — marker at %s is missing or unreadable",
            marker_path,
        )
        return
    if payload.get("pid") != os.getpid() or payload.get("host") != socket.gethostname():
        logger.warning(
            "reseed_marker: clear skipped — marker owned by pid=%s host=%s, not this process",
            payload.get("pid"),
            payload.get("host"),
        )
        return
    try:
        marker_path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("failed to clear reseed marker %s", marker_path, exc_info=True)


def _base_pack_seed_state(marker_path: Path, *, fallback_state: str) -> PackSeedState:
    try:
        return validate_pack_seed_state(
            json.loads(marker_path.read_text(encoding="utf-8"))
        )
    except FileNotFoundError:
        pass
    except Exception:  # noqa: BLE001
        logger.warning(
            "pack_seed_state: failed to read marker at %s - using minimal base",
            marker_path,
            exc_info=True,
        )
    return validate_pack_seed_state({"state": fallback_state})


def _pack_seed_state_payload(base: PackSeedState) -> dict[str, Any]:
    payload: dict[str, Any] = {"state": base.state}
    for key, value in {
        "created_at": base.created_at,
        "reason": base.reason,
        "details": base.details,
        "last_seed_at": base.last_seed_at,
        "last_seed_run_id": base.last_seed_run_id,
        "last_failure_at": base.last_failure_at,
        "last_failure_reason": base.last_failure_reason,
        "last_failure_run_id": base.last_failure_run_id,
    }.items():
        if value is not None:
            payload[key] = value
    return payload


def update_pack_seed_state(
    *,
    scope_dir: Path,
    indexed_at: str,
    last_seed_run_id: str,
) -> None:
    """Write the pack-level seed-state marker as ``seeded``.

    Callers gate on ``overall_status`` and ``seeded_count``; this function
    only handles the write itself.  A failed write logs a warning and does
    not propagate - seed results take precedence over the marker.
    """
    marker_path = pack_seed_state_path(scope_dir)
    base = _base_pack_seed_state(marker_path, fallback_state="seeded")
    payload = _pack_seed_state_payload(base)
    payload.update(
        {
            "state": "seeded",
            "last_seed_at": indexed_at,
            "last_seed_run_id": last_seed_run_id,
        }
    )
    try:
        write_json_atomic(marker_path, payload)
    except Exception:  # noqa: BLE001
        logger.warning(
            "pack_seed_state: failed to write marker at %s - seed results are intact",
            marker_path,
            exc_info=True,
        )


def update_pack_seed_state_failure(
    *,
    scope_dir: Path,
    failed_at: str,
    reason: str,
    last_failure_run_id: str | None,
) -> None:
    marker_path = pack_seed_state_path(scope_dir)
    base = _base_pack_seed_state(marker_path, fallback_state="bootstrap-empty")
    payload = _pack_seed_state_payload(base)
    payload.update(
        {
            "last_failure_at": failed_at,
            "last_failure_reason": reason,
        }
    )
    if last_failure_run_id is not None:
        payload["last_failure_run_id"] = last_failure_run_id
    else:
        payload.pop("last_failure_run_id", None)
    try:
        write_json_atomic(marker_path, payload)
    except Exception:  # noqa: BLE001
        logger.warning(
            "pack_seed_state: failed to write failure marker at %s",
            marker_path,
            exc_info=True,
        )
