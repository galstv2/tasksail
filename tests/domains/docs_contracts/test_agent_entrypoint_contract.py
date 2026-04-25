"""Contract tests: pnpm run agent is wired as the canonical launch entrypoint."""
from __future__ import annotations

import json
import unittest
from pathlib import Path


class AgentEntrypointContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.pkg = json.loads(
            (cls.repo_root / "package.json").read_text(encoding="utf-8"),
        )
        cls.makefile = (
            cls.repo_root / "Makefile"
        ).read_text(encoding="utf-8")

    def test_agent_script_exists(self) -> None:
        self.assertIn("agent", self.pkg["scripts"])

    def test_agent_script_targets_ts_cli(self) -> None:
        script = self.pkg["scripts"]["agent"]
        self.assertIn("agent-runner/cli.ts", script)
        self.assertIn("run", script)

    def test_agent_pipeline_script_exists(self) -> None:
        self.assertIn("agent:pipeline", self.pkg["scripts"])

    def test_makefile_has_agent_target(self) -> None:
        self.assertIn("agent:", self.makefile)

    def test_agent_scripts_do_not_target_python_launchers(self) -> None:
        for name in ("agent", "agent:pipeline"):
            self.assertNotIn(".py", self.pkg["scripts"][name])


if __name__ == "__main__":
    unittest.main()
