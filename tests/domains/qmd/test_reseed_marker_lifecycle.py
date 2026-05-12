from __future__ import annotations

import json
import os
import socket
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp.services.marker import (  # noqa: E402
    RESEED_MARKER_FILENAME,
    ReseedAlreadyInProgressError,
    acquire_reseed_marker,
)


def _write_marker(
    pack_dir: Path,
    *,
    pid: int,
    host: str,
    started_at: str | None = None,
) -> Path:
    marker_path = pack_dir / RESEED_MARKER_FILENAME
    marker_path.write_text(
        json.dumps({
            "pid": pid,
            "host": host,
            "started_at": started_at or datetime.now(timezone.utc).isoformat(),
        }),
        encoding="utf-8",
    )
    return marker_path


def test_acquire_reseed_marker_writes_marker_when_absent(tmp_path: Path) -> None:
    marker_path = acquire_reseed_marker(tmp_path)

    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert marker_path.name == RESEED_MARKER_FILENAME
    assert payload["pid"] == os.getpid()
    assert payload["host"] == socket.gethostname()
    assert isinstance(payload["started_at"], str)


def test_acquire_reseed_marker_rejects_live_same_host_marker(tmp_path: Path) -> None:
    _write_marker(tmp_path, pid=1234, host=socket.gethostname())

    with patch(
        "src.backend.mcp.repo_context_mcp.services.marker._process_alive_locally",
        return_value=True,
    ):
        with pytest.raises(ReseedAlreadyInProgressError) as exc_info:
            acquire_reseed_marker(tmp_path)

    assert exc_info.value.pid == 1234
    assert exc_info.value.same_host is True


def test_acquire_reseed_marker_reclaims_dead_same_host_marker(tmp_path: Path) -> None:
    marker_path = _write_marker(tmp_path, pid=1234, host=socket.gethostname())

    with patch(
        "src.backend.mcp.repo_context_mcp.services.marker._process_alive_locally",
        return_value=False,
    ):
        acquire_reseed_marker(tmp_path)

    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert payload["pid"] == os.getpid()


def test_acquire_reseed_marker_rejects_recent_foreign_host_marker(tmp_path: Path) -> None:
    _write_marker(tmp_path, pid=1234, host="other-host")

    with pytest.raises(ReseedAlreadyInProgressError) as exc_info:
        acquire_reseed_marker(tmp_path, stale_after_seconds=3600)

    assert exc_info.value.host == "other-host"
    assert exc_info.value.same_host is False


def test_acquire_reseed_marker_reclaims_stale_foreign_host_marker(tmp_path: Path) -> None:
    stale_started_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    marker_path = _write_marker(
        tmp_path,
        pid=1234,
        host="other-host",
        started_at=stale_started_at,
    )

    acquire_reseed_marker(tmp_path, stale_after_seconds=60)

    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert payload["host"] == socket.gethostname()


def test_acquire_reseed_marker_reclaims_corrupt_marker(tmp_path: Path) -> None:
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text("{", encoding="utf-8")

    acquire_reseed_marker(tmp_path)

    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert payload["pid"] == os.getpid()
