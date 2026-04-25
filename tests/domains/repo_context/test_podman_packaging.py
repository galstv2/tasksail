from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class PodmanPackagingTests(unittest.TestCase):
    """Validate the Podman packaging assets expected by the platform."""

    def test_containerfile_uses_non_root_user_and_module_entrypoint(
        self,
    ) -> None:
        containerfile = (
            REPO_ROOT / "podman" / "repo-context-mcp" / "Containerfile"
        )
        lines = containerfile.read_text(encoding="utf-8").splitlines()

        copy_src_lines = [
            line for line in lines if line.startswith("COPY") and "src" in line
        ]
        self.assertTrue(
            copy_src_lines,
            "Containerfile must COPY src/ into the image",
        )

        user_lines = [line for line in lines if line.startswith("USER")]
        self.assertTrue(
            user_lines,
            "Containerfile must switch to non-root USER",
        )
        self.assertNotEqual(
            user_lines[-1].split()[-1],
            "root",
            "Container must not run as root",
        )

        entrypoint_or_cmd = [
            line
            for line in lines
            if line.startswith(("CMD", "ENTRYPOINT"))
            and "src.backend.mcp.repo_context_mcp" in line
        ]
        self.assertTrue(
            entrypoint_or_cmd,
            "Containerfile CMD/ENTRYPOINT must invoke src.backend.mcp.repo_context_mcp",
        )

    def test_podman_compose_file_is_valid_yaml_with_expected_service(
        self,
    ) -> None:
        compose_file = (
            REPO_ROOT / "podman" / "compose" / "podman-compose.yml"
        )
        contents = compose_file.read_text(encoding="utf-8")

        ports: list[str] = []
        try:
            import yaml  # noqa: PLC0415

            compose = yaml.safe_load(contents)
            self.assertIn("services", compose)
            self.assertIn("repo-context-mcp", compose["services"])
            service = compose["services"]["repo-context-mcp"]
            self.assertEqual(
                service.get("userns_mode"),
                "keep-id",
                "Podman service must preserve host UID/GID mapping",
            )
            ports = [str(p) for p in service.get("ports", [])]
        except ImportError:
            self.assertIn("services:", contents)
            self.assertIn("repo-context-mcp:", contents)
            self.assertIn(
                "userns_mode: keep-id",
                contents,
                "Podman service must preserve host UID/GID mapping",
            )

        self.assertTrue(
            any(
                p.startswith("127.0.0.1:") and p.endswith(":8811")
                for p in ports
            )
            or "127.0.0.1:" in contents and ":8811" in contents,
            "Service must bind host 127.0.0.1 → container port 8811 "
            "(tolerates ${REPO_CONTEXT_MCP_PORT:-8811} parameterization)",
        )
        self.assertRegex(
            contents,
            r"../../:/workspace:ro",
            "Workspace volume must be mounted read-only",
        )
        self.assertIn(
            "podman/repo-context-mcp/Containerfile",
            contents,
            "Compose file must reference the Podman Containerfile",
        )


    def test_app_containerfile_exists(self) -> None:
        containerfile = REPO_ROOT / "podman" / "app" / "Containerfile"
        self.assertTrue(
            containerfile.exists(),
            "podman/app/Containerfile must exist",
        )


if __name__ == "__main__":
    unittest.main()
