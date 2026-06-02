"""File-locking helpers shared across platform scripts."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl


def _lock_file(fd: int) -> None:
    if sys.platform == "win32":
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    else:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_file(fd: int) -> None:
    if sys.platform == "win32":
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)


def acquire_file_lock(
    lock_path: Path,
    timeout_seconds: float = 60.0,
    poll_interval: float | None = None,
) -> int:
    """Create (or open) *lock_path* and acquire an exclusive lock.

    Uses non-blocking attempts with exponential backoff by default.  When
    *poll_interval* is given, uses that as a fixed retry interval instead.
    Raises ``TimeoutError`` if the lock cannot be acquired within
    *timeout_seconds*.

    Returns the file descriptor — pass it to :func:`release_file_lock`
    when done.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR)

    deadline = time.monotonic() + timeout_seconds
    backoff = 0.05  # initial backoff in seconds (exponential mode only)

    while True:
        try:
            _lock_file(fd)
            return fd
        except (OSError, BlockingIOError):
            if time.monotonic() >= deadline:
                os.close(fd)
                raise TimeoutError(
                    f"Failed to acquire lock on {lock_path} "
                    f"within {timeout_seconds}s"
                )
            if poll_interval is not None:
                time.sleep(max(0, min(poll_interval, deadline - time.monotonic())))
            else:
                time.sleep(max(0, min(backoff, deadline - time.monotonic())))
                backoff = min(backoff * 2, 2.0)


def release_file_lock(fd: int) -> None:
    """Release the exclusive lock and close *fd*."""
    _unlock_file(fd)
    os.close(fd)
