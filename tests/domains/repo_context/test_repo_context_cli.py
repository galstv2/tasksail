from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp.services import ReseedAlreadyInProgressError  # noqa: E402
from src.backend.mcp.repo_context_mcp.transport.cli import RepoContextCli  # noqa: E402


class RepoContextCliTests(unittest.TestCase):
    def run_with_stdout(
        self,
        cli: RepoContextCli,
        argv: list[str],
    ) -> tuple[int, str]:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            exit_code = cli.run(argv, run_server=mock.Mock())
        return exit_code, stdout.getvalue()

    def make_cli(
        self,
        *,
        execute_seed_run: mock.Mock | None = None,
        load_context_pack_conventions_summary: mock.Mock | None = None,
        build_carry_forward_summary: mock.Mock | None = None,
        build_task_lineage_summary: mock.Mock | None = None,
        load_behavior_correction_memo_summary: mock.Mock | None = None,
        render_context_pack_conventions_summary: mock.Mock | None = None,
        render_behavior_correction_memo: mock.Mock | None = None,
        render_run_markdown: mock.Mock | None = None,
    ) -> RepoContextCli:
        return RepoContextCli(
            default_host="127.0.0.1",
            default_port=8765,
            default_manifest="qmd/repo-sources.json",
            default_plan_file="qmd/repo-sources.plan.json",
            execute_seed_run=execute_seed_run or mock.Mock(),
            load_context_pack_conventions_summary=(
                load_context_pack_conventions_summary or mock.Mock()
            ),
            build_carry_forward_summary=(
                build_carry_forward_summary or mock.Mock()
            ),
            build_task_lineage_summary=(
                build_task_lineage_summary or mock.Mock()
            ),
            load_behavior_correction_memo_summary=(
                load_behavior_correction_memo_summary or mock.Mock()
            ),
            render_context_pack_conventions_summary=(
                render_context_pack_conventions_summary
                or mock.Mock(return_value="# Context-Pack Conventions")
            ),
            render_behavior_correction_memo=(
                render_behavior_correction_memo
                or mock.Mock(return_value="# Behavior Corrections")
            ),
            render_run_markdown=(
                render_run_markdown or mock.Mock(return_value="rendered run")
            ),
        )

    def test_seed_command_dispatches_to_execute_seed_run(self) -> None:
        execute_seed_run = mock.Mock(
            return_value={"overall_status": "success", "run_started_at": "now"}
        )
        cli = self.make_cli(execute_seed_run=execute_seed_run)

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "seed",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--format",
                "markdown",
            ],
        )

        self.assertEqual(exit_code, 0)
        execute_seed_run.assert_called_once_with(
            context_pack_dir="/tmp/context-pack",
            manifest="qmd/repo-sources.json",
            plan_file="qmd/repo-sources.plan.json",
            plan_mode="prefer-plan",
            write_report=True,
        )
        self.assertEqual(stdout, "rendered run\n")

    def test_serve_command_dispatches_default_host_and_port(self) -> None:
        cli = self.make_cli()
        run_server = mock.Mock(return_value=7)

        exit_code = cli.run([], run_server=run_server)

        self.assertEqual(exit_code, 7)
        run_server.assert_called_once_with("127.0.0.1", 8765)

    def test_seed_command_json_output_returns_nonzero_for_failed_status(
        self,
    ) -> None:
        execute_seed_run = mock.Mock(
            return_value={
                "overall_status": "failed",
                "run_started_at": "now",
                "seeded_repo_count": 0,
            }
        )
        cli = self.make_cli(execute_seed_run=execute_seed_run)

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "seed",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--format",
                "json",
                "--no-write-report",
            ],
        )

        self.assertEqual(exit_code, 1)
        self.assertEqual(
            json.loads(stdout)["overall_status"],
            "failed",
        )
        execute_seed_run.assert_called_once_with(
            context_pack_dir="/tmp/context-pack",
            manifest="qmd/repo-sources.json",
            plan_file="qmd/repo-sources.plan.json",
            plan_mode="prefer-plan",
            write_report=False,
        )

    def test_seed_command_returns_structured_conflict_for_active_reseed(self) -> None:
        execute_seed_run = mock.Mock(
            side_effect=ReseedAlreadyInProgressError(
                pid=1234,
                host="host-a",
                started_at="2026-05-10T12:00:00+00:00",
                same_host=True,
                stale_after_seconds=3600,
            )
        )
        cli = self.make_cli(execute_seed_run=execute_seed_run)

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "seed",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--format",
                "markdown",
            ],
        )

        self.assertEqual(exit_code, 2)
        payload = json.loads(stdout)
        self.assertEqual(payload["error"], "reseed_in_progress")
        self.assertEqual(payload["pid"], 1234)
        self.assertEqual(payload["host"], "host-a")
        self.assertEqual(payload["started_at"], "2026-05-10T12:00:00+00:00")
        self.assertTrue(payload["same_host"])
        self.assertEqual(payload["stale_after_seconds"], 3600)

    def test_conventions_command_supports_json_and_markdown_output(
        self,
    ) -> None:
        load_context_pack_conventions_summary = mock.Mock(
            return_value={
                "conventions_summary_status": "available",
                "rendered_summary_markdown": "# Context-Pack Conventions",
            }
        )
        render_context_pack_conventions_summary = mock.Mock(
            return_value="# Context-Pack Conventions"
        )
        cli = self.make_cli(
            load_context_pack_conventions_summary=(
                load_context_pack_conventions_summary
            ),
            render_context_pack_conventions_summary=(
                render_context_pack_conventions_summary
            ),
        )

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "conventions",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--format",
                "markdown",
            ],
        )

        self.assertEqual(exit_code, 0)
        load_context_pack_conventions_summary.assert_called_once_with(
            context_pack_dir="/tmp/context-pack",
        )
        render_context_pack_conventions_summary.assert_called_once()
        self.assertEqual(stdout, "# Context-Pack Conventions\n")

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "conventions",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--format",
                "json",
            ],
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            json.loads(stdout)[
                "conventions_summary_status"
            ],
            "available",
        )

    def test_carry_forward_command_trims_optional_identifiers(self) -> None:
        build_carry_forward_summary = mock.Mock(
            return_value={
                "rendered_summary_markdown": "# Carry-Forward Summary",
                "parent_task_id": "CAP-1001",
            }
        )
        cli = self.make_cli(
            build_carry_forward_summary=build_carry_forward_summary,
        )

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "carry-forward",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--parent-qmd-scope",
                "qmd/context-packs/sample-org",
                "--parent-qmd-record-id",
                "   ",
                "--parent-task-id",
                " CAP-1001 ",
            ],
        )

        self.assertEqual(exit_code, 0)
        build_carry_forward_summary.assert_called_once_with(
            context_pack_dir="/tmp/context-pack",
            parent_qmd_scope="qmd/context-packs/sample-org",
            parent_qmd_record_id=None,
            parent_task_id="CAP-1001",
        )
        self.assertEqual(stdout, "# Carry-Forward Summary\n")

    def test_lineage_command_supports_root_task_json_output(self) -> None:
        build_task_lineage_summary = mock.Mock(
            return_value={
                "rendered_summary_markdown": "# Task Lineage Summary",
                "root_task_id": "CAP-ROOT-1",
            }
        )
        cli = self.make_cli(
            build_task_lineage_summary=build_task_lineage_summary,
        )

        exit_code, stdout = self.run_with_stdout(
            cli,
            [
                "lineage",
                "--context-pack-dir",
                "/tmp/context-pack",
                "--qmd-scope",
                "qmd/context-packs/sample-org",
                "--root-task-id",
                " CAP-ROOT-1 ",
                "--format",
                "json",
            ],
        )

        self.assertEqual(exit_code, 0)
        build_task_lineage_summary.assert_called_once_with(
            context_pack_dir="/tmp/context-pack",
            qmd_scope="qmd/context-packs/sample-org",
            task_id=None,
            root_task_id="CAP-ROOT-1",
        )
        self.assertEqual(
            json.loads(stdout)["root_task_id"],
            "CAP-ROOT-1",
        )


if __name__ == "__main__":
    unittest.main()
