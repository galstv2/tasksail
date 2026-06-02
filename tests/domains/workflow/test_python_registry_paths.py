from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "src" / "backend" / "scripts" / "python"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib import registry  # noqa: E402


def _write_registry(path: Path, role_name: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({
            "schema_version": 1,
            "agents": [{
                "agent_id": "software-engineer",
                "role_name": role_name,
                "human_name": "Dalton",
                "workflow_order": 1,
            }],
        }),
        encoding="utf-8",
    )


class PythonRegistryPathTests(unittest.TestCase):
    def setUp(self) -> None:
        registry._load_agents.cache_clear()
        registry.agent_roles.cache_clear()
        registry.agent_names.cache_clear()
        registry.workflow_roles.cache_clear()
        registry.contribution_section_names.cache_clear()
        self.tmpdir = Path(tempfile.mkdtemp(prefix="registry-paths-"))

    def tearDown(self) -> None:
        registry._load_agents.cache_clear()
        registry.agent_roles.cache_clear()
        registry.agent_names.cache_clear()
        registry.workflow_roles.cache_clear()
        registry.contribution_section_names.cache_clear()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_env_override_path_drives_public_helpers(self) -> None:
        custom_registry = self.tmpdir / "agents" / "registry.json"
        _write_registry(custom_registry, "Custom Software Engineer")

        with mock.patch.dict(
            os.environ,
            {"TASKSAIL_AGENT_REGISTRY_PATH": str(custom_registry)},
            clear=False,
        ):
            self.assertEqual(
                registry.agent_roles()["software-engineer"],
                "Custom Software Engineer",
            )
            self.assertEqual(
                registry.workflow_roles(),
                (("Dalton", "Custom Software Engineer"),),
            )

    def test_empty_env_fails_closed_with_actionable_error(self) -> None:
        with mock.patch.dict(os.environ, {"TASKSAIL_AGENT_REGISTRY_PATH": "  "}, clear=False):
            with self.assertRaisesRegex(
                RuntimeError,
                (
                    "TASKSAIL_AGENT_REGISTRY_PATH is required; set it to the "
                    "active CLI provider agent registry path"
                ),
            ):
                registry.agent_roles()

    def test_absent_env_fails_closed_with_actionable_error(self) -> None:
        env = {
            key: value
            for key, value in os.environ.items()
            if key != "TASKSAIL_AGENT_REGISTRY_PATH"
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(
                RuntimeError,
                (
                    "TASKSAIL_AGENT_REGISTRY_PATH is required; set it to the "
                    "active CLI provider agent registry path"
                ),
            ):
                registry.agent_roles()


if __name__ == "__main__":
    unittest.main()
