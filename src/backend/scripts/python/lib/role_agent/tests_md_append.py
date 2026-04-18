"""Locked append semantics for tests.md in parallel Dalton runs.

Each parallel Dalton appends its own section to the shared tests.md file.
File-level locking via :mod:`lib.locking` prevents concurrent writes from
clobbering each other.  Idempotency checks prevent duplicate sections.

With ``TASKSAIL_TASK_ID`` set, ``tests.md`` and its lock live under the
per-task handoffs directory, enabling independent parallel writes across
different tasks.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ..io import load_text
from ..locking import acquire_file_lock, release_file_lock
from ..workspace_paths import handoffs_dir


def _instance_marker(instance_id: str) -> str:
    return f"(Instance: {instance_id})"


def _section_header(slice_id: str, instance_id: str) -> str:
    return f"## Slice: {slice_id} {_instance_marker(instance_id)}"


def instance_section_exists(root_dir: Path, instance_id: str) -> bool:
    """Return True if tests.md already contains a section for *instance_id*.

    .. note:: This is an unlocked optimistic check.  For authoritative
       idempotency, use :func:`append_tests_md_section` which re-checks
       under the exclusive lock.
    """
    return _instance_marker(instance_id) in load_text(handoffs_dir(root_dir) / "tests.md")


def append_tests_md_section(
    root_dir: Path,
    instance_id: str,
    slice_id: str,
    slice_path: str,
    content: str,
) -> bool:
    """Append a slice section to tests.md under an exclusive file lock.

    Returns True if content was written, False if the section already existed
    (idempotency guard).
    """
    tests_md = handoffs_dir(root_dir) / "tests.md"
    lock_path = handoffs_dir(root_dir) / "tests.md.lock"

    fd = acquire_file_lock(lock_path)
    try:
        existing = load_text(tests_md)
        if _instance_marker(instance_id) in existing:
            return False

        separator = "\n---\n\n" if existing.strip() else ""
        header = _section_header(slice_id, instance_id)
        section = f"{separator}{header}\n\n<!-- Slice path: {slice_path} -->\n\n{content}\n"
        tests_md.write_text(existing + section, encoding="utf-8")
        return True
    finally:
        release_file_lock(fd)


def write_stub_section(
    root_dir: Path,
    instance_id: str,
    slice_id: str,
    slice_path: str,
) -> bool:
    """Write a minimal stub section noting the agent did not fill in tests.md."""
    stub = (
        "> **Stub — agent did not populate this section.**\n"
        f"> QA: review slice `{slice_path}` and add test details.\n"
    )
    return append_tests_md_section(root_dir, instance_id, slice_id, slice_path, stub)


# ---------------------------------------------------------------------------
# CLI entry-points (called from run-role-agent-helper.py subcommands)
# ---------------------------------------------------------------------------

def cmd_check_parallel_tests_md_section(args: argparse.Namespace) -> int:
    """Exit 0 if section exists, 1 if missing."""
    return 0 if instance_section_exists(args.root_dir.resolve(), args.instance_id) else 1


def cmd_write_parallel_tests_md_stub(args: argparse.Namespace) -> int:
    """Write a stub section. Exit 0 on success."""
    write_stub_section(
        args.root_dir.resolve(),
        args.instance_id,
        args.slice_id,
        args.slice_path,
    )
    return 0
