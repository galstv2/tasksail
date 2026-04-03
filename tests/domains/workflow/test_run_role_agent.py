from __future__ import annotations

from pathlib import Path
import unittest

from tests.support.repo_file_sets import ROLE_AGENT_WORKSPACE_FILES
from tests.support.script_runner import run_script
from tests.support.workspace_builder import prepare_workspace


class RunRoleAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.script_relative_path = "src/backend/platform/agent-runner/cli.ts"

    def create_workspace(self) -> Path:
        workspace = prepare_workspace(
            self,
            relative_dirs=[
                ".git",
                "src/backend/scripts/python",
                ".github/agents",
                ".github/copilot/instructions",
            ],
            relative_files=[
                *ROLE_AGENT_WORKSPACE_FILES,
                "src/__init__.py",
                "src/backend/__init__.py",
            ],
            tree_paths=["src/backend/scripts/python/lib"],
            symlink_paths=["src/backend/mcp"],
        )
        return workspace

    def run_agent_cli(
        self,
        workspace: Path,
        *args: str,
        env: dict[str, str] | None = None,
    ):
        merged_env = {
            "RUN_ROLE_AGENT_ACTIVE_MODEL": "gpt-4.1",
            "RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS": "true",
            "RUN_ROLE_AGENT_ORCHESTRATOR_ID": "pipeline-sequencer",
        }
        if env:
            merged_env.update(env)
        return run_script(
            workspace,
            self.script_relative_path,
            "run",
            *args,
            env=merged_env,
        )

    def test_dry_run_accepts_registry_agent_id(self) -> None:
        workspace = self.create_workspace()

        completed = self.run_agent_cli(
            workspace,
            "--agent-id",
            "software-engineer",
            "--dry-run",
            "--skip-workflow-check",
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertIn("copilot --agent software-engineer", completed.stdout)

    def test_dry_run_accepts_short_agent_id(self) -> None:
        workspace = self.create_workspace()

        completed = self.run_agent_cli(
            workspace,
            "--agent-id",
            "dalton",
            "--dry-run",
            "--skip-workflow-check",
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertIn("copilot --agent software-engineer", completed.stdout)

    def test_unknown_agent_id_fails_with_clear_error(self) -> None:
        workspace = self.create_workspace()

        completed = self.run_agent_cli(
            workspace,
            "--agent-id",
            "unknown-agent",
            "--dry-run",
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('unknown agent-id for --agent-id: "unknown-agent"', completed.stderr)

    def test_skip_workflow_check_requires_known_orchestrator(self) -> None:
        workspace = self.create_workspace()

        completed = self.run_agent_cli(
            workspace,
            "--agent-id",
            "software-engineer",
            "--dry-run",
            "--skip-workflow-check",
            env={"RUN_ROLE_AGENT_ORCHESTRATOR_ID": "rogue-script"},
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("known orchestrator ID", completed.stderr)


if __name__ == "__main__":
    unittest.main()
