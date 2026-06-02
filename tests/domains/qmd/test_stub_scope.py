"""Tests for stub_scope.write_empty_scope_tree (Phase 5 G1) and the
pack seed-state lifecycle in the seeding service (Phase 5 G2)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _make_v2_manifest(
    context_pack_id: str,
    qmd_scope_root: str,
    repositories: list[dict],
) -> dict:
    return {
        "manifest_version": "qmd-repo-sources/v2",
        "manifest_status": "approved",
        "estate_type": "distributed",
        "context_pack_id": context_pack_id,
        "qmd_scope_root": qmd_scope_root,
        "repositories": repositories,
    }


class WriteEmptyScopeTreeTests(unittest.TestCase):
    """Gate G1: structurally complete empty scope tree after new-flow create."""

    def _write_manifest(self, context_pack_dir: Path, manifest: dict) -> Path:
        qmd_dir = context_pack_dir / "qmd"
        qmd_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = qmd_dir / "repo-sources.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return manifest_path

    def test_writes_partition_dirs_and_gitkeep(self) -> None:
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest(
                "my-pack",
                "qmd/context-packs/my-pack",
                [{"repo_id": "api", "repo_name": "api", "system_layer": "backend"}],
            )
            manifest_path = self._write_manifest(pack_dir, manifest)

            result = write_empty_scope_tree(pack_dir, manifest_path)

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            assert scope_dir.exists()
            for part in ("canonical", "operational", "archive"):
                assert (scope_dir / part / ".gitkeep").exists(), f"missing {part}/.gitkeep"
            assert (scope_dir / "estate" / "backend" / "api" / ".gitkeep").exists()
            assert result["wrote"] is True
            assert result["repo_count"] == 1

    def test_writes_all_four_empty_indexes(self) -> None:
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest("my-pack", "qmd/context-packs/my-pack", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            write_empty_scope_tree(pack_dir, manifest_path)

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            for index_name in ("repositories.json", "tasks.json", "lineage.json", "context-pack-index.json"):
                index_path = scope_dir / "indexes" / index_name
                assert index_path.exists(), f"missing indexes/{index_name}"
                raw = json.loads(index_path.read_text())
                assert "schema_version" in raw, f"indexes/{index_name} missing schema_version"

    def test_writes_bootstrap_empty_marker(self) -> None:
        from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest("my-pack", "qmd/context-packs/my-pack", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            write_empty_scope_tree(
                pack_dir,
                manifest_path,
                plan_overall_status="ready",
                plan_repo_statuses=["ready"],
            )

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            marker = json.loads(pack_seed_state_path(scope_dir).read_text())
            assert marker["state"] == "bootstrap-empty"
            assert marker["reason"] == "new-flow-seed-opted-out"
            assert marker["details"]["plan_overall_status"] == "ready"
            assert marker["details"]["plan_repo_statuses"] == ["ready"]
            assert marker["details"]["plan_parsed"] is True

    def test_marker_reason_new_flow_empty_repos(self) -> None:
        from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest("my-pack", "qmd/context-packs/my-pack", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            write_empty_scope_tree(
                pack_dir,
                manifest_path,
                plan_overall_status="needs-review",
                plan_repo_statuses=["blocked"],
            )

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            marker = json.loads(pack_seed_state_path(scope_dir).read_text())
            assert marker["reason"] == "new-flow-empty-repos"

    def test_marker_reason_new_flow_needs_review(self) -> None:
        from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest("my-pack", "qmd/context-packs/my-pack", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            write_empty_scope_tree(
                pack_dir,
                manifest_path,
                plan_overall_status="needs-review",
                plan_repo_statuses=["needs-review", "ready"],
            )

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            marker = json.loads(pack_seed_state_path(scope_dir).read_text())
            assert marker["reason"] == "new-flow-needs-review"

    def test_marker_reason_plan_parse_failure(self) -> None:
        """If plan info is absent, reason should be new-flow-seed-skipped."""
        from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest("my-pack", "qmd/context-packs/my-pack", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            # Called with no plan info (plan parse failed)
            write_empty_scope_tree(pack_dir, manifest_path)

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            marker = json.loads(pack_seed_state_path(scope_dir).read_text())
            assert marker["reason"] == "new-flow-seed-skipped"
            assert marker["details"]["plan_parsed"] is False

    def test_missing_system_layer_defaults_to_shared(self) -> None:
        """Auto-heal: repo with no system_layer goes to estate/shared/<repo_id>."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "my-pack"
            manifest = _make_v2_manifest(
                "my-pack",
                "qmd/context-packs/my-pack",
                [{"repo_id": "orphan", "repo_name": "orphan"}],
            )
            manifest_path = self._write_manifest(pack_dir, manifest)

            write_empty_scope_tree(pack_dir, manifest_path)

            scope_dir = pack_dir / "qmd/context-packs/my-pack"
            assert (scope_dir / "estate" / "shared" / "orphan" / ".gitkeep").exists()


class QmdScopeRootContainmentTests(unittest.TestCase):
    """Containment: qmd_scope_root must resolve inside context_pack_dir."""

    def _write_manifest(self, context_pack_dir: Path, manifest: dict) -> Path:
        qmd_dir = context_pack_dir / "qmd"
        qmd_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = qmd_dir / "repo-sources.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return manifest_path

    def test_missing_qmd_scope_root_uses_default(self) -> None:
        """Absent qmd_scope_root falls back to qmd/context-packs/<pack-name>."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "alpha-pack"
            manifest = {
                "manifest_version": "qmd-repo-sources/v2",
                "context_pack_id": "alpha-pack",
                # qmd_scope_root intentionally omitted
                "repositories": [],
            }
            manifest_path = self._write_manifest(pack_dir, manifest)

            result = write_empty_scope_tree(pack_dir, manifest_path)

            expected_scope = pack_dir / "qmd" / "context-packs" / "alpha-pack"
            assert result["scope_root"] == str(expected_scope.resolve())

    def test_valid_relative_scope_root_resolves_inside_pack(self) -> None:
        """A valid relative qmd_scope_root resolves inside context_pack_dir."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "beta-pack"
            manifest = _make_v2_manifest(
                "beta-pack",
                "qmd/context-packs/beta-pack",
                [],
            )
            manifest_path = self._write_manifest(pack_dir, manifest)

            result = write_empty_scope_tree(pack_dir, manifest_path)

            expected_scope = pack_dir / "qmd" / "context-packs" / "beta-pack"
            assert result["scope_root"] == str(expected_scope.resolve())
            assert result["wrote"] is True

    def test_dot_dot_escape_is_rejected(self) -> None:
        """A qmd_scope_root with .. escaping the pack directory raises ValueError."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "gamma-pack"
            manifest = _make_v2_manifest(
                "gamma-pack",
                "../../outside",
                [],
            )
            manifest_path = self._write_manifest(pack_dir, manifest)

            with self.assertRaises(ValueError):
                write_empty_scope_tree(pack_dir, manifest_path)

    def test_posix_absolute_path_is_rejected(self) -> None:
        """A POSIX-absolute qmd_scope_root raises ValueError."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "delta-pack"
            manifest = _make_v2_manifest(
                "delta-pack",
                "/etc/passwd",
                [],
            )
            manifest_path = self._write_manifest(pack_dir, manifest)

            with self.assertRaises(ValueError):
                write_empty_scope_tree(pack_dir, manifest_path)

    def test_windows_drive_absolute_path_rejected_on_all_os(self) -> None:
        """Windows drive-absolute paths (C:\\...) are rejected on every host OS,
        not silently sandboxed on POSIX."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "epsilon-pack"
            manifest = _make_v2_manifest("epsilon-pack", "C:\\Windows\\System32", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            with self.assertRaises(ValueError):
                write_empty_scope_tree(pack_dir, manifest_path)

    def test_unc_like_path_rejected_on_all_os(self) -> None:
        """UNC-like paths (\\\\server\\share) are rejected on every host OS, not
        silently sandboxed on POSIX."""
        from src.backend.mcp.repo_context_mcp.services.stub_scope import write_empty_scope_tree

        with tempfile.TemporaryDirectory() as tmp:
            pack_dir = Path(tmp) / "zeta-pack"
            manifest = _make_v2_manifest("zeta-pack", "\\\\server\\share\\data", [])
            manifest_path = self._write_manifest(pack_dir, manifest)

            with self.assertRaises(ValueError):
                write_empty_scope_tree(pack_dir, manifest_path)


class PackSeedStateLifecycleTests(unittest.TestCase):
    """Gate G2: seeding service updates the pack-level seed-state marker."""

    @classmethod
    def setUpClass(cls) -> None:
        from src.backend.mcp.repo_context_mcp import app
        cls.app = app

    def _create_context_pack(self, temp_dir: Path, repositories: list[dict]) -> Path:
        pack_dir = temp_dir / "test-pack"
        (pack_dir / "qmd").mkdir(parents=True, exist_ok=True)
        manifest = {
            "context_pack_id": "test-pack",
            "qmd_scope_root": "qmd/context-packs/test-pack",
            "repositories": repositories,
        }
        (pack_dir / "qmd" / "repo-sources.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        return pack_dir

    def _run_seed(self, workspace_root: Path, context_pack_dir: str) -> dict:
        self.app._SEEDING_SERVICE = None
        self.app._ARCHIVE_SERVICE = None
        with mock.patch("pathlib.Path.cwd", return_value=workspace_root):
            return self.app.execute_seed_run(
                context_pack_dir=context_pack_dir,
                plan_mode="manifest-only",
            )

    def test_success_seed_writes_seeded_marker(self) -> None:
        from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path

        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            repo_dir = temp_dir / "my-service"
            repo_dir.mkdir()
            (repo_dir / "main.py").write_text("# hello", encoding="utf-8")

            pack_dir = self._create_context_pack(
                temp_dir,
                [{"repo_id": "my-service", "repo_name": "my-service",
                  "system_layer": "backend", "local_paths": [str(repo_dir)]}],
            )

            report = self._run_seed(temp_dir, str(pack_dir))
            assert report["overall_status"] in {"success", "partial-failure", "completed-with-blocked-repos"}

            scope_dir = pack_dir / "qmd/context-packs/test-pack"
            marker_path = pack_seed_state_path(scope_dir)
            if report["overall_status"] == "success" or (
                report["overall_status"] in {"partial-failure", "completed-with-blocked-repos"}
                and report["seeded_repo_count"] >= 1
            ):
                assert marker_path.exists(), "expected pack seed-state marker to be written"
                marker = json.loads(marker_path.read_text())
                assert marker["state"] == "seeded"
                assert "last_seed_at" in marker

    def test_failed_seed_does_not_write_seeded_marker(self) -> None:
        """A fully-failed seed must not touch an existing bootstrap-empty marker."""
        from src.backend.mcp.repo_context_mcp.record_factory import pack_seed_state_path

        with tempfile.TemporaryDirectory() as tmp:
            temp_dir = Path(tmp)
            pack_dir = self._create_context_pack(
                temp_dir,
                [{"repo_id": "ghost", "repo_name": "ghost",
                  "system_layer": "backend",
                  "local_paths": [str(temp_dir / "nonexistent-dir")]}],
            )

            scope_dir = pack_dir / "qmd/context-packs/test-pack"
            scope_dir.mkdir(parents=True, exist_ok=True)
            marker_path = pack_seed_state_path(scope_dir)
            marker_path.write_text(
                json.dumps({"state": "bootstrap-empty", "created_at": "2026-05-09T00:00:00Z"}),
                encoding="utf-8",
            )

            self._run_seed(temp_dir, str(pack_dir))

            # Marker must still exist and state must be unchanged.
            assert marker_path.exists()
            marker = json.loads(marker_path.read_text())
            assert marker["state"] == "bootstrap-empty"


if __name__ == "__main__":
    unittest.main()
