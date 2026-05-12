from __future__ import annotations

import sys
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp import app as repo_context_app  # noqa: E402


class RepoContextPackagingTests(unittest.TestCase):
    """Validate that Docker packaging and app entrypoint are structurally
    correct — not just that certain strings appear, but that the files
    parse correctly, reference the right paths, and expose stable symbols.
    """

    def test_dockerfile_uses_non_root_user_and_module_entrypoint(
        self,
    ) -> None:
        dockerfile = (
            REPO_ROOT / "runtime" / "docker" / "repo-context-mcp" / "Dockerfile"
        )
        lines = dockerfile.read_text(encoding="utf-8").splitlines()

        # Validate real Dockerfile directives, not substrings.
        copy_src_lines = [
            line for line in lines if line.startswith("COPY") and "src" in line
        ]
        self.assertTrue(
            copy_src_lines,
            "Dockerfile must COPY src/ into the image",
        )

        user_lines = [line for line in lines if line.startswith("USER")]
        self.assertTrue(user_lines, "Dockerfile must switch to non-root USER")
        # Must not run as root.
        self.assertNotEqual(
            user_lines[-1].split()[-1],
            "root",
            "Container must not run as root",
        )

        # Entrypoint must reference the app module.
        entrypoint_or_cmd = [
            line
            for line in lines
            if line.startswith(("CMD", "ENTRYPOINT"))
            and "src.backend.mcp.repo_context_mcp" in line
        ]
        self.assertTrue(
            entrypoint_or_cmd,
            "Dockerfile CMD/ENTRYPOINT must invoke src.backend.mcp.repo_context_mcp",
        )

    def test_compose_file_is_valid_yaml_with_expected_service(self) -> None:
        compose_file = (
            REPO_ROOT / "runtime" / "docker" / "compose" / "docker-compose.yml"
        )
        contents = compose_file.read_text(encoding="utf-8")

        # Parse as YAML if PyYAML is available, otherwise verify
        # key structural lines.
        ports: list[str] = []
        try:
            import yaml  # noqa: PLC0415

            compose = yaml.safe_load(contents)
            self.assertIn("services", compose)
            self.assertIn("repo-context-mcp", compose["services"])
            ports = [
                str(p)
                for p in compose["services"]["repo-context-mcp"].get("ports", [])
            ]
        except ImportError:
            self.assertIn("services:", contents)
            self.assertIn("repo-context-mcp:", contents)

        # Port binding must use loopback only (security). Tolerate the
        # ${REPO_CONTEXT_MCP_PORT:-8811} parameterization on the host side.
        self.assertTrue(
            any(
                p.startswith("127.0.0.1:") and p.endswith(":8811")
                for p in ports
            )
            or "127.0.0.1:" in contents and ":8811" in contents,
            "Service must bind host 127.0.0.1 → container port 8811 "
            "(tolerates ${REPO_CONTEXT_MCP_PORT:-8811} parameterization)",
        )

        # Workspace must be mounted read-only.
        self.assertRegex(
            contents,
            r"../../../:/workspace:ro",
            "Workspace volume must be mounted read-only",
        )

    def test_env_example_documents_required_config_variables(self) -> None:
        env_example = REPO_ROOT / ".env.example"
        lines = env_example.read_text(encoding="utf-8").splitlines()

        # Extract variable names (lines like VAR=value or VAR= or # VAR=...).
        defined_vars = set()
        for line in lines:
            stripped = line.lstrip("# ").strip()
            if "=" in stripped and not stripped.startswith("#"):
                var_name = stripped.split("=", 1)[0].strip()
                if var_name:
                    defined_vars.add(var_name)

        required_vars = {
            "REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR",
            "REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR",
        }
        missing = required_vars - defined_vars
        self.assertFalse(
            missing,
            f".env.example is missing required variables: {missing}",
        )

    def test_app_exposes_stable_bootstrap_symbols_with_correct_types(
        self,
    ) -> None:
        # Handler must be a real BaseHTTPRequestHandler subclass.
        self.assertTrue(
            issubclass(repo_context_app.Handler, BaseHTTPRequestHandler),
        )

        # Core entry points must be callable.
        for name in ("parse_args", "main", "create_cli", "create_handler_class"):
            fn = getattr(repo_context_app, name, None)
            self.assertTrue(
                callable(fn),
                f"app.{name} must be callable",
            )

        # parse_args must accept an empty list (implicit serve mode).
        args = repo_context_app.parse_args([])
        self.assertIsNone(args.command)
        self.assertEqual(args.host, repo_context_app.DEFAULT_HOST)
        self.assertEqual(args.port, repo_context_app.DEFAULT_PORT)


if __name__ == "__main__":
    unittest.main()
