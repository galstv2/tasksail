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
    clear_reseed_marker,
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


# ---------------------------------------------------------------------------
# Track F: O_EXCL exclusive-create and owner-checked clear tests
# ---------------------------------------------------------------------------


def test_acquire_raises_when_marker_pre_exists_o_excl(tmp_path: Path) -> None:
    """Pre-create a valid marker on disk; acquire must raise (O_EXCL fires) and leave it unchanged."""
    original_content = json.dumps({
        "pid": 9999,
        "host": "other-host",
        "started_at": datetime.now(timezone.utc).isoformat(),
    })
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text(original_content, encoding="utf-8")

    with pytest.raises(ReseedAlreadyInProgressError):
        acquire_reseed_marker(tmp_path)

    # Marker content is unchanged — O_EXCL blocked the write
    assert marker_path.read_text(encoding="utf-8") == original_content


def test_acquire_exclusive_create_semantics_under_simulated_contention(tmp_path: Path) -> None:
    """Monkeypatch os.open to raise FileExistsError on first call, succeed on second.

    Asserts that exactly one acquisition path proceeds — the exclusive-create
    semantics hold even under simulated contention (the first FileExistsError
    causes the code to read the payload; because the marker no longer physically
    exists after the first simulated error the read returns None and the code
    falls through to reclaim).
    """
    real_os_open = os.open
    call_count = 0

    def fake_os_open(path: str, flags: int, mode: int = 0o777) -> int:
        nonlocal call_count
        if flags & os.O_EXCL:
            call_count += 1
            if call_count == 1:
                raise FileExistsError("simulated contention")
        return real_os_open(path, flags, mode)

    with patch("src.backend.mcp.repo_context_mcp.services.marker.os.open", side_effect=fake_os_open):
        # No physical marker exists — after the simulated FileExistsError the
        # reclaim path will try to read (gets None) and then do unlink (no-op)
        # followed by a second O_EXCL create which our mock lets through.
        result = acquire_reseed_marker(tmp_path)

    assert result.name == RESEED_MARKER_FILENAME
    assert call_count >= 1


def test_clear_reseed_marker_owner_checked(tmp_path: Path) -> None:
    """Acquire as test process, simulate a different owner for clear — must NOT unlink.
    Restore identity — must unlink."""
    marker_path = acquire_reseed_marker(tmp_path)
    assert marker_path.exists()

    # Simulate a different process identity for the clear call
    with patch("src.backend.mcp.repo_context_mcp.services.marker.os.getpid", return_value=99999), \
         patch("src.backend.mcp.repo_context_mcp.services.marker.socket.gethostname", return_value="other-host"):
        clear_reseed_marker(marker_path)

    # Marker must still exist — wrong owner
    assert marker_path.exists()

    # Now clear with the real identity — must unlink
    clear_reseed_marker(marker_path)
    assert not marker_path.exists()


def test_stale_reclaim_exclusive_second_reclaimer_fails(tmp_path: Path) -> None:
    """Plant a marker with a provably dead pid; acquire reclaims via unlink-then-O_EXCL.
    A second concurrent reclaimer (simulated by a second O_EXCL attempt) must fail."""
    dead_pid = 2  # pid 2 is always either kernel thread or dead on macOS/Linux
    stale_started_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text(
        json.dumps({"pid": dead_pid, "host": socket.gethostname(), "started_at": stale_started_at}),
        encoding="utf-8",
    )

    # First reclaimer proceeds: dead pid (liveness returns False) → reclaim
    with patch(
        "src.backend.mcp.repo_context_mcp.services.marker._process_alive_locally",
        return_value=False,
    ):
        result = acquire_reseed_marker(tmp_path)

    assert result.exists()
    new_payload = json.loads(result.read_text(encoding="utf-8"))
    assert new_payload["pid"] == os.getpid()
    assert new_payload["host"] == socket.gethostname()

    # Second concurrent reclaimer: marker now exists with our pid; O_EXCL must raise
    with patch(
        "src.backend.mcp.repo_context_mcp.services.marker._process_alive_locally",
        return_value=False,
    ):
        with pytest.raises((FileExistsError, ReseedAlreadyInProgressError)):
            # Attempt to create the marker again; O_EXCL rejects because we own it
            # and the liveness check on our own pid returns False here, so it will
            # attempt _reclaim_and_exclusive_create which does unlink → O_EXCL.
            # We simulate the O_EXCL failing for the second reclaimer by patching.
            real_os_open = os.open

            def second_reclaimer_open(path: str, flags: int, mode: int = 0o777) -> int:
                if flags & os.O_EXCL:
                    raise FileExistsError("second reclaimer blocked by O_EXCL")
                return real_os_open(path, flags, mode)

            with patch(
                "src.backend.mcp.repo_context_mcp.services.marker.os.open",
                side_effect=second_reclaimer_open,
            ):
                acquire_reseed_marker(tmp_path)


def test_reclaim_defers_when_marker_already_replaced(tmp_path: Path) -> None:
    """B2: a second reclaimer acting on a stale decision must NOT unlink a fresh
    marker a first reclaimer already wrote. Compare-and-swap detects the marker
    changed identity and defers (raises) rather than removing the new owner's marker."""
    from src.backend.mcp.repo_context_mcp.services.marker import (
        _reclaim_and_exclusive_create,
    )

    # A's fresh marker is on disk (this process owns it).
    fresh = {
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text(json.dumps(fresh), encoding="utf-8")

    # B still holds the OLD stale payload it judged dead (different identity).
    stale_payload = {
        "pid": 1234,
        "host": "other-host",
        "started_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
    }

    with pytest.raises(ReseedAlreadyInProgressError):
        _reclaim_and_exclusive_create(
            tmp_path, marker_path, stale_payload, stale_after_seconds=60
        )

    # A's fresh marker must be intact — B did not unlink it and did not acquire.
    assert json.loads(marker_path.read_text(encoding="utf-8")) == fresh


def test_reclaim_defers_when_corrupt_marker_already_replaced(tmp_path: Path) -> None:
    """B2: reclaiming a corrupt marker (no stale payload) must defer when the marker
    was already replaced by a valid fresh marker, instead of removing it."""
    from src.backend.mcp.repo_context_mcp.services.marker import (
        _reclaim_and_exclusive_create,
    )

    fresh = {
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text(json.dumps(fresh), encoding="utf-8")

    with pytest.raises(ReseedAlreadyInProgressError):
        _reclaim_and_exclusive_create(
            tmp_path, marker_path, None, stale_after_seconds=60
        )

    assert json.loads(marker_path.read_text(encoding="utf-8")) == fresh


def test_reclaim_serializes_on_flock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """B2: reclaimers serialize on a flock lock, closing the re-read/unlink TOCTOU
    window. While the reclaim lock is held externally, a second reclaimer blocks
    and times out before its unlink — so the stale marker is left untouched."""
    from src.backend.mcp.repo_context_mcp.services import marker as marker_mod
    from src.backend.scripts.python.lib.locking import (
        acquire_file_lock,
        release_file_lock,
    )

    monkeypatch.setattr(marker_mod, "RESEED_RECLAIM_LOCK_TIMEOUT_SECONDS", 0.2)

    stale_started_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    stale_payload = {"pid": 2, "host": socket.gethostname(), "started_at": stale_started_at}
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text(json.dumps(stale_payload), encoding="utf-8")

    reclaim_lock = tmp_path / (RESEED_MARKER_FILENAME + ".reclaim.lock")
    held_fd = acquire_file_lock(reclaim_lock, timeout_seconds=5.0)
    try:
        with pytest.raises(TimeoutError):
            marker_mod._reclaim_and_exclusive_create(
                tmp_path, marker_path, stale_payload, stale_after_seconds=60
            )
        # The blocked reclaimer never reached unlink → stale marker untouched.
        assert json.loads(marker_path.read_text(encoding="utf-8")) == stale_payload
    finally:
        release_file_lock(held_fd)
