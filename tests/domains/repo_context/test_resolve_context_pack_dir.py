"""Boundary-case tests for resolve_context_pack_dir."""

from pathlib import Path

import pytest

from src.backend.mcp.repo_context_mcp.utils import resolve_context_pack_dir


class TestResolveContextPackDir:
    workspace = Path("/workspace")

    def test_workspace_subpath_accepted(self) -> None:
        result = resolve_context_pack_dir(
            self.workspace, "/workspace/AgentWorkSpace/context-pack"
        )
        assert str(result) == "/workspace/AgentWorkSpace/context-pack"

    def test_context_pack_roots_mount_accepted(self) -> None:
        result = resolve_context_pack_dir(
            self.workspace, "/context-pack-roots/0"
        )
        assert str(result) == "/context-pack-roots/0"

    def test_context_pack_roots_subpath_accepted(self) -> None:
        result = resolve_context_pack_dir(
            self.workspace, "/context-pack-roots/0/sub/dir"
        )
        assert str(result) == "/context-pack-roots/0/sub/dir"

    def test_context_pack_roots_requires_index_segment(self) -> None:
        with pytest.raises(ValueError, match="not under any allowed mount root"):
            resolve_context_pack_dir(self.workspace, "/context-pack-roots")

    def test_context_pack_roots_requires_numeric_index(self) -> None:
        with pytest.raises(ValueError, match="not under any allowed mount root"):
            resolve_context_pack_dir(
                self.workspace,
                "/context-pack-roots/not-an-index/sub/dir",
            )

    def test_legacy_mount_context_pack_rejected(self) -> None:
        with pytest.raises(ValueError, match="not under any allowed mount root"):
            resolve_context_pack_dir(self.workspace, "/mnt/context-pack")

    def test_relative_path_rejected(self) -> None:
        with pytest.raises(ValueError, match="absolute POSIX path"):
            resolve_context_pack_dir(self.workspace, "AgentWorkSpace/context-pack")

    def test_windows_shaped_path_rejected(self) -> None:
        with pytest.raises(ValueError, match="absolute POSIX path"):
            resolve_context_pack_dir(self.workspace, "C:\\Users\\foo\\pack")

    def test_out_of_bounds_posix_rejected(self) -> None:
        with pytest.raises(ValueError, match="not under any allowed mount root"):
            resolve_context_pack_dir(self.workspace, "/etc/passwd")

    def test_empty_string_rejected(self) -> None:
        with pytest.raises(ValueError):
            resolve_context_pack_dir(self.workspace, "")
