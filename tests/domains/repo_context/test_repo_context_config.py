from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_repo_context_config_module():
    from src.backend.mcp.repo_context_mcp import config
    return config


class RepoContextConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_repo_context_config_module()

    def test_server_config_reads_host_and_port_from_env(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                **os.environ,
                "REPO_CONTEXT_MCP_HOST": "127.0.0.1",
                "REPO_CONTEXT_MCP_PORT": "9911",
                "REPO_CONTEXT_MCP_AUTH_TOKEN": "local-token",
                "REPO_CONTEXT_MCP_MAX_REQUEST_BYTES": "2048",
            },
            clear=True,
        ):
            server_config = self.config.ServerConfig.from_env()

        self.assertEqual(server_config.host, "127.0.0.1")
        self.assertEqual(server_config.port, 9911)
        self.assertEqual(server_config.auth_token, "local-token")
        self.assertEqual(server_config.auth_header, "X-Repo-Context-Token")
        self.assertEqual(server_config.max_request_bytes, 2048)

    def test_repo_context_config_reads_activation_defaults_from_env(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                **os.environ,
                "CONTEXT_PACK_QMD_REPO_SOURCES_FILE": "qmd/manifest-v2.json",
                "CONTEXT_PACK_QMD_DRY_RUN_PLAN_FILE": "qmd/bootstrap/custom-plan.json",
                "QMD_GLOBAL_RETROSPECTIVE_ROOT": "qmd/shared/retrospectives",
                "QMD_MAX_FILES_PER_REPO": "25",
            },
            clear=True,
        ):
            repo_config = self.config.RepoContextConfig.from_env()

        self.assertEqual(repo_config.default_manifest, "qmd/manifest-v2.json")
        self.assertEqual(
            repo_config.default_plan_file,
            "qmd/bootstrap/custom-plan.json",
        )
        self.assertEqual(
            repo_config.global_retrospective_root,
            "qmd/shared/retrospectives",
        )
        self.assertEqual(repo_config.max_files_per_repo, 25)
        self.assertIn(".md", repo_config.allowed_suffixes)
        self.assertIn("shared", repo_config.allowed_layers)

    def test_socket_timeout_config_from_env(self) -> None:
        with mock.patch.dict(
            os.environ,
            {**os.environ, "REPO_CONTEXT_MCP_SOCKET_TIMEOUT": "45"},
            clear=True,
        ):
            server_config = self.config.ServerConfig.from_env()

        self.assertEqual(server_config.socket_timeout, 45)


if __name__ == "__main__":
    unittest.main()
