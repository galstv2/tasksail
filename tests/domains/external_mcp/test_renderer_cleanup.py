"""Tests for cleanup_stale_launches provider-PID sentinel behavior.

Covers:
- Dir with a live provider-PID sentinel is preserved.
- Dir with a dead provider-PID sentinel is removed.
- Legacy fallback: dir with no sentinel and a dead helper PID in its name
  is removed; dir with no sentinel and a live helper PID is preserved.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "src" / "backend" / "scripts" / "python"
)
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.role_agent.external_mcp import renderer  # noqa: E402
from lib.role_agent.external_mcp.renderer import (  # noqa: E402
    cleanup_stale_launches,
)

_AGENT_ID = "dalton"


def _make_cli_home(tmp_root: Path) -> Path:
    """Create the CLI home directory that cli_home_root returns."""
    # cli_home_root returns <root>/.platform-state/runtime/cli-home when
    # TASKSAIL_TASK_ID is unset. We patch cli_home_root directly so we
    # don't need to replicate the full directory structure.
    cli_home = tmp_root / "cli-home"
    cli_home.mkdir(parents=True, exist_ok=True)
    return cli_home


def _make_launch_dir(cli_home: Path, helper_pid: int, *, index: int = 1) -> Path:
    """Create a launch directory whose name embeds the helper PID."""
    name = f"{_AGENT_ID}-{1000000 + index}-{helper_pid}"
    d = cli_home / name
    d.mkdir()
    return d


class TestCleanupSentinelBehavior(unittest.TestCase):
    """Provider-PID sentinel takes precedence over the dir-name helper PID."""

    def test_live_provider_pid_sentinel_preserves_dir(self) -> None:
        """Dir with a live provider-PID sentinel must NOT be deleted."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            cli_home = _make_cli_home(tmp_root)

            live_pid = 12345
            dead_pid = 99999

            dir_live = _make_launch_dir(cli_home, helper_pid=1, index=1)
            dir_dead = _make_launch_dir(cli_home, helper_pid=2, index=2)

            # Write sentinels: dir_live has a live PID, dir_dead has a dead one.
            (dir_live / ".provider-pid").write_text(str(live_pid))
            (dir_dead / ".provider-pid").write_text(str(dead_pid))

            def fake_is_pid_alive(pid: int) -> bool:
                return pid == live_pid

            with (
                mock.patch.object(renderer, "cli_home_root", return_value=cli_home),
                mock.patch.object(renderer, "_is_pid_alive", side_effect=fake_is_pid_alive),
            ):
                deleted = cleanup_stale_launches(tmp_root, _AGENT_ID)

            self.assertEqual(deleted, 1)
            self.assertTrue(dir_live.exists(), "live sentinel dir should be preserved")
            self.assertFalse(dir_dead.exists(), "dead sentinel dir should be removed")

    def test_garbage_sentinel_falls_back_to_legacy(self) -> None:
        """A sentinel with garbage content falls back to legacy helper-PID behavior."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            cli_home = _make_cli_home(tmp_root)

            dead_helper_pid = 88888

            dir_garbage = _make_launch_dir(cli_home, helper_pid=dead_helper_pid, index=1)
            # Write a non-numeric sentinel — should be treated as absent.
            (dir_garbage / ".provider-pid").write_text("not-a-pid")

            def fake_is_pid_alive(pid: int) -> bool:
                return False  # helper PID is dead

            with (
                mock.patch.object(renderer, "cli_home_root", return_value=cli_home),
                mock.patch.object(renderer, "_is_pid_alive", side_effect=fake_is_pid_alive),
            ):
                deleted = cleanup_stale_launches(tmp_root, _AGENT_ID)

            self.assertEqual(deleted, 1)
            self.assertFalse(dir_garbage.exists())


class TestCleanupLegacyFallback(unittest.TestCase):
    """Dirs without a sentinel still follow the legacy helper-PID behavior."""

    def test_no_sentinel_dead_helper_pid_removed(self) -> None:
        """Dir with no sentinel and a dead helper PID in its name is deleted."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            cli_home = _make_cli_home(tmp_root)

            dead_pid = 77777
            dir_dead = _make_launch_dir(cli_home, helper_pid=dead_pid, index=1)
            # No .provider-pid sentinel.

            with (
                mock.patch.object(renderer, "cli_home_root", return_value=cli_home),
                mock.patch.object(renderer, "_is_pid_alive", return_value=False),
            ):
                deleted = cleanup_stale_launches(tmp_root, _AGENT_ID)

            self.assertEqual(deleted, 1)
            self.assertFalse(dir_dead.exists())

    def test_no_sentinel_live_helper_pid_preserved(self) -> None:
        """Dir with no sentinel and a live helper PID in its name is preserved."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            cli_home = _make_cli_home(tmp_root)

            live_pid = 66666
            dir_live = _make_launch_dir(cli_home, helper_pid=live_pid, index=1)
            # No .provider-pid sentinel.

            with (
                mock.patch.object(renderer, "cli_home_root", return_value=cli_home),
                mock.patch.object(renderer, "_is_pid_alive", return_value=True),
            ):
                deleted = cleanup_stale_launches(tmp_root, _AGENT_ID)

            self.assertEqual(deleted, 0)
            self.assertTrue(dir_live.exists())


if __name__ == "__main__":
    unittest.main()
