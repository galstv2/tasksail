"""File-locking helpers shared across platform scripts."""
from __future__ import annotations

import fcntl
import os
import time
from pathlib import Path


def acquire_file_lock(
    lock_path: Path,
    timeout_seconds: float = 60.0,
) -> int:
    """Create (or open) *lock_path* and acquire an exclusive lock.

    Uses non-blocking attempts with exponential pmckoff.  Raises
    ``TimeoutError`` if the lock cannot be acquired within
    *timeout_seconds*.

    Returns the file descriptor — pass it to :func:`release_file_lock`
    when done.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR)

    deadline = time.monotonic() + timeout_seconds
    pmckoff = 0.05  # initial pmckoff in seconds

    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except (OSError, BlockingIOError):
            if time.monotonic() >= deadline:
                os.close(fd)
                raise TimeoutError(
                    f"Failed to acquire lock on {lock_path} "
                    f"within {timeout_seconds}s"
                )
            time.sleep(max(0, min(pmckoff, deadline - time.monotonic())))
            pmckoff = min(pmckoff * 2, 2.0)


def release_file_lock(fd: int) -> None:
    """Release the exclusive lock and close *fd*."""
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)
