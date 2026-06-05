"""Regression tests proving that the corrected R5 reseed marker serializes
live manifest and scope-index writes per pack (architecture decision R10).

Design rationale (documented here per spec requirement):
  _execute_seed_run_with_marker writes repo-sources.json (seeding_service.py,
  write_text_atomic call) and calls write_scope_indexes (indexes.py) INSIDE the
  window between acquire_reseed_marker and clear_reseed_marker.  The corrected
  R5 marker uses O_CREAT|O_EXCL for acquisition and an owner-checked clear,
  making it the single cross-process mutex that guarantees at most one seed
  process runs per pack at a time.

  A dedicated per-scope lock for these writes is intentionally omitted:
  it would be redundant and could produce a lock-ordering inversion against the
  marker (holder of A tries to acquire B; another path acquires B then tries A).

  These tests prove the property without adding any lock:
    1. While one caller holds the reseed marker for a pack, a second acquire
       for the same pack raises ReseedAlreadyInProgressError — demonstrating
       that manifest and index writes cannot run concurrently for that pack.
    2. The marker is cleared AFTER all writes complete, so the exclusion window
       fully covers both the manifest write and the index writes.
"""
from __future__ import annotations

import json
import os
import socket
import sys
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


def test_second_acquire_blocked_while_first_holds_marker(tmp_path: Path) -> None:
    """Acquire the reseed marker for a pack; assert a second acquire for the
    same pack raises ReseedAlreadyInProgressError.

    This is the core locking proof for R10: because both the manifest write
    (seeding_service.py write_text_atomic) and the index writes
    (write_scope_indexes) execute inside the marker hold, two seeders for the
    same pack cannot interleave those writes.
    """
    # First caller acquires the marker — represents a seed run in progress.
    marker_path = acquire_reseed_marker(tmp_path)
    assert marker_path.exists(), "marker must exist after acquisition"

    try:
        # Second caller for the same pack must be excluded.
        # Patch _process_alive_locally so the marker is not reclaimed as dead.
        with patch(
            "src.backend.mcp.repo_context_mcp.services.marker._process_alive_locally",
            return_value=True,
        ):
            with pytest.raises(ReseedAlreadyInProgressError) as exc_info:
                acquire_reseed_marker(tmp_path)

        err = exc_info.value
        assert err.pid == os.getpid(), "blocked marker is owned by this process"
        assert err.host == socket.gethostname(), "blocked marker is on this host"
        assert err.same_host is True
    finally:
        clear_reseed_marker(marker_path)

    # After clear, a new acquisition succeeds — exclusion is scoped to the hold.
    new_marker = acquire_reseed_marker(tmp_path)
    assert new_marker.exists()
    clear_reseed_marker(new_marker)


def test_second_acquire_blocked_for_same_pack_different_simulated_pid(tmp_path: Path) -> None:
    """Simulate a concurrent seed from a different PID on the same host.

    Plants a marker as if written by pid=77777 on the current host, marks that
    pid alive, and asserts acquire raises ReseedAlreadyInProgressError — proving
    cross-process exclusion for the same pack.
    """
    marker_path = tmp_path / RESEED_MARKER_FILENAME
    marker_path.write_text(
        json.dumps({
            "pid": 77777,
            "host": socket.gethostname(),
            "started_at": "2026-01-01T00:00:00+00:00",
        }),
        encoding="utf-8",
    )

    with patch(
        "src.backend.mcp.repo_context_mcp.services.marker._process_alive_locally",
        return_value=True,
    ):
        with pytest.raises(ReseedAlreadyInProgressError) as exc_info:
            acquire_reseed_marker(tmp_path)

    err = exc_info.value
    assert err.pid == 77777
    assert err.same_host is True


def test_manifest_and_index_writes_occur_inside_marker_window(tmp_path: Path) -> None:
    """Verify the marker exists throughout _execute_seed_run_with_marker by
    observing it during both the manifest write and the index-write phase.

    The manifest write (write_text_atomic on repo-sources.json) only fires when
    enrich_manifest_missing_git_roots detects missing git roots.  We force it to
    True deterministically via a patch so the write always fires in this test.
    The key invariants:
      - marker is present at the manifest write
      - marker is present at the index write
      - marker is absent after execute_seed_run returns
    """
    import importlib

    # Build a minimal context pack on disk.
    context_pack_dir = tmp_path / "context-pack"
    qmd_dir = context_pack_dir / "qmd"
    qmd_dir.mkdir(parents=True)
    repo_dir = tmp_path / "repo"
    (repo_dir / "src").mkdir(parents=True)
    (repo_dir / "src" / "app.py").write_text("print('hello')\n", encoding="utf-8")
    manifest = {
        "context_pack_id": "test-org",
        "qmd_scope_root": "qmd/context-packs/test-org",
        "repositories": [
            {
                "repo_id": "repo",
                "repo_name": "repo",
                "local_paths": [str(repo_dir)],
                "system_layer": "backend",
                "languages": ["python"],
                "artifact_roots": ["src"],
            }
        ],
    }
    manifest_path = qmd_dir / "repo-sources.json"
    manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")

    marker_path = context_pack_dir / RESEED_MARKER_FILENAME
    observations: dict[str, bool] = {
        "at_manifest_write": False,
        "at_index_write": False,
    }

    seeding_mod = importlib.import_module(
        "src.backend.mcp.repo_context_mcp.services.seeding_service"
    )

    real_write_text_atomic = seeding_mod.write_text_atomic
    real_write_scope_indexes = seeding_mod.write_scope_indexes

    def patched_write_text_atomic(path: Path, content: str) -> None:
        if path.name == "repo-sources.json":
            observations["at_manifest_write"] = marker_path.exists()
        real_write_text_atomic(path, content)

    def patched_write_scope_indexes(service, *, context_pack_dir, scope_dir, **kwargs):
        observations["at_index_write"] = marker_path.exists()
        return {
            "context_pack_index": str(scope_dir / "indexes" / "context-pack-index.json"),
            "repositories": str(scope_dir / "indexes" / "repositories.json"),
            "tasks": str(scope_dir / "indexes" / "tasks.json"),
            "lineage": str(scope_dir / "indexes" / "lineage.json"),
        }

    # Force enrich_manifest_missing_git_roots to return True so the manifest
    # write always fires — making the observation deterministic.
    git_roots_mod = importlib.import_module("src.backend.mcp.git_roots")
    real_enrich = git_roots_mod.enrich_manifest_missing_git_roots

    def patched_enrich(manifest: dict, *, context_pack_dir: Path) -> bool:
        real_enrich(manifest, context_pack_dir=context_pack_dir)
        return True  # force write regardless of whether roots were found

    with (
        patch.object(seeding_mod, "write_text_atomic", side_effect=patched_write_text_atomic),
        patch.object(seeding_mod, "write_scope_indexes", side_effect=patched_write_scope_indexes),
        patch.object(
            seeding_mod,
            "enrich_manifest_missing_git_roots",
            side_effect=patched_enrich,
        ),
    ):
        app_mod = importlib.import_module("src.backend.mcp.repo_context_mcp.app")
        app_mod._SEEDING_SERVICE = None
        app_mod._ARCHIVE_SERVICE = None

        with patch("pathlib.Path.cwd", return_value=tmp_path):
            app_mod.execute_seed_run(
                context_pack_dir=str(context_pack_dir),
                plan_mode="manifest-only",
            )

    assert observations["at_manifest_write"], (
        "marker was absent during the manifest write — "
        "manifest write is not covered by the reseed marker"
    )
    assert observations["at_index_write"], (
        "marker was absent during the index write — "
        "index write is not covered by the reseed marker"
    )
    assert not marker_path.exists(), "reseed marker must be cleared after execute_seed_run"


def test_different_pack_dirs_acquire_independently(tmp_path: Path) -> None:
    """Two different pack directories can each acquire their own marker.

    Exclusion is per-pack: holding a marker for pack-A does not block pack-B.
    """
    pack_a = tmp_path / "pack-a"
    pack_b = tmp_path / "pack-b"
    pack_a.mkdir()
    pack_b.mkdir()

    marker_a = acquire_reseed_marker(pack_a)
    try:
        marker_b = acquire_reseed_marker(pack_b)
        assert marker_b.exists(), "pack-B must acquire its own marker independently"
        clear_reseed_marker(marker_b)
    finally:
        clear_reseed_marker(marker_a)
