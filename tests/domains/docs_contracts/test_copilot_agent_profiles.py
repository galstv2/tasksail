from __future__ import annotations

import json
from pathlib import Path
import re
import unittest


class CopilotAgentProfilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.agent_dir = cls.repo_root / ".github" / "agents"
        registry_payload = json.loads(
            (cls.agent_dir / "registry.json").read_text(encoding="utf-8")
        )
        cls.expected_agents = {
            item["agent_id"]: item
            for item in registry_payload["agents"]
        }

    def parse_profile(self, path: Path) -> tuple[dict[str, str], str]:
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        self.assertGreaterEqual(len(lines), 5)
        first_non_empty_index = next(
            index for index, line in enumerate(lines) if line.strip()
        )
        first_non_empty_line = lines[first_non_empty_index].strip()
        if first_non_empty_line == "```chatagent":
            frontmatter_start = first_non_empty_index + 1
            content_end = lines.index("```", frontmatter_start + 1)
        else:
            self.assertEqual(first_non_empty_line, "---")
            frontmatter_start = first_non_empty_index
            content_end = len(lines)

        self.assertEqual(lines[frontmatter_start].strip(), "---")
        frontmatter_end = lines.index("---", frontmatter_start + 1)

        frontmatter: dict[str, str] = {}
        for line in lines[frontmatter_start + 1:frontmatter_end]:
            stripped = line.strip()
            if not stripped:
                continue
            key, value = stripped.split(":", 1)
            frontmatter[key.strip()] = value.strip()

        body = "\n".join(lines[frontmatter_end + 1:content_end]).strip()
        return frontmatter, body

    def test_agent_profiles_exist_and_match_repo_contract(self) -> None:
        actual_profiles = {path.stem for path in self.agent_dir.glob("*.md")}
        self.assertEqual(actual_profiles, set(self.expected_agents))

        model_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]*$")

        for agent_id, expectations in self.expected_agents.items():
            with self.subTest(agent_id=agent_id):
                path = self.agent_dir / f"{agent_id}.md"
                frontmatter, body = self.parse_profile(path)
                role_name = expectations["role_name"]
                instruction_path = expectations["instruction_path"]

                self.assertEqual(frontmatter.get("name"), agent_id)
                self.assertTrue(frontmatter.get("description", "").strip())
                if "model" in frontmatter:
                    self.assertRegex(frontmatter["model"], model_pattern)

                self.assertTrue(body)
                self.assertIn("Act as ", body)
                self.assertIn(
                    f"Read `{instruction_path}` for your instructions.",
                    body,
                )


if __name__ == "__main__":
    unittest.main()
