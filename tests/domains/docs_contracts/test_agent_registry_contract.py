from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


class AgentRegistryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.registry_path = (
            cls.repo_root / ".github" / "agents" / "registry.json"
        )
        cls.required_agent_ids = {
            "planning-agent",
            "product-manager",
            "software-engineer",
            "software-engineer-verify",
            "qa",
        }
        cls.required_fields = {
            "agent_id",
            "role_name",
            "human_name",
            "instruction_path",
            "agent_profile_path",
            "autonomy_profile",
            "workflow_order",
        }
        cls.expected_autonomy_profiles = {
            "planning-agent": "artifact-author",
            "product-manager": "artifact-author",
            "software-engineer": "repo-executor",
            "software-engineer-verify": "repo-executor",
            "qa": "qa-executor",
        }

    def load_registry(self) -> dict[str, object]:
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def load_agents(self) -> list[dict[str, object]]:
        payload = self.load_registry()
        return payload.get("agents", payload) if isinstance(payload, dict) else payload

    def test_registry_is_valid_json_object(self) -> None:
        payload = self.load_registry()

        self.assertIsInstance(payload, dict)
        self.assertEqual(payload.get("schema_version"), 1)
        self.assertIsInstance(payload.get("agents"), list)

    def test_registry_contains_exact_required_agent_ids(self) -> None:
        actual_agent_ids = {
            item["agent_id"]
            for item in self.load_agents()
        }

        self.assertEqual(actual_agent_ids, self.required_agent_ids)

    def test_each_registry_entry_has_required_fields(self) -> None:
        for item in self.load_agents():
            with self.subTest(agent_id=item.get("agent_id", "unknown")):
                self.assertTrue(self.required_fields.issubset(item))
                for field_name in self.required_fields - {"human_name"}:
                    if field_name == "workflow_order":
                        self.assertIsInstance(item[field_name], int)
                        continue
                    self.assertTrue(item[field_name])

    def test_required_model_pins_match_current_contract(self) -> None:
        registry_map = {
            item["agent_id"]: item
            for item in self.load_agents()
        }

        self.assertEqual(
            registry_map["planning-agent"].get("required_model"),
            "claude-sonnet-4.6",
        )
        self.assertEqual(
            registry_map["product-manager"].get("required_model"),
            "gpt-5.4",
        )
        self.assertEqual(
            registry_map["software-engineer"].get("required_model"),
            "claude-sonnet-4.6",
        )
        self.assertEqual(
            registry_map["software-engineer-verify"].get("required_model"),
            "claude-sonnet-4.6",
        )
        self.assertEqual(
            registry_map["qa"].get("required_model"),
            "gpt-5.4",
        )

    def test_autonomy_profiles_match_current_contract(self) -> None:
        registry_map = {
            item["agent_id"]: item
            for item in self.load_agents()
        }

        self.assertEqual(
            {
                agent_id: registry_map[agent_id].get("autonomy_profile")
                for agent_id in self.expected_autonomy_profiles
            },
            self.expected_autonomy_profiles,
        )


    def _parse_team_roster_table(self) -> list[dict[str, object]]:
        content = (
            self.repo_root
            / ".github"
            / "copilot"
            / "instructions"
            / "global.instructions.md"
        ).read_text(encoding="utf-8")

        match = re.search(r"^## Team Roster\s*\n", content, re.MULTILINE)
        self.assertIsNotNone(match, "## Team Roster section not found")
        assert match is not None

        section_start = match.end()
        next_section = re.search(
            r"^## ", content[section_start:], re.MULTILINE
        )
        section_end = (
            section_start + next_section.start()
            if next_section
            else len(content)
        )
        section_text = content[section_start:section_end]

        table_lines = [
            line.strip()
            for line in section_text.split("\n")
            if line.strip().startswith("|")
            and not re.match(r"^\|[-\s|]+\|$", line.strip())
        ]
        self.assertGreaterEqual(len(table_lines), 2, "Team Roster table too short")

        rows: list[dict[str, object]] = []
        for line in table_lines[1:]:
            cells = [c.strip() for c in line.split("|")[1:-1]]
            if len(cells) >= 5:
                rows.append(
                    {
                        "name": cells[0],
                        "role": cells[1],
                        "agent_id": cells[2],
                        "autonomy": cells[3],
                        "order": int(cells[4]),
                    }
                )
        return rows

    def test_glopml_roster_table_matches_registry(self) -> None:
        agents = sorted(self.load_agents(), key=lambda a: a["workflow_order"])
        roster_rows = self._parse_team_roster_table()

        self.assertEqual(
            len(roster_rows),
            len(agents),
            f"Roster table has {len(roster_rows)} rows but registry has "
            f"{len(agents)} agents",
        )

        for i, agent in enumerate(agents):
            with self.subTest(agent_id=agent["agent_id"]):
                row = roster_rows[i]
                self.assertEqual(row["name"], agent["human_name"])
                self.assertEqual(row["role"], agent["role_name"])
                self.assertEqual(row["agent_id"], agent["agent_id"])
                self.assertEqual(row["autonomy"], agent["autonomy_profile"])
                self.assertEqual(row["order"], agent["workflow_order"])

if __name__ == "__main__":
    unittest.main()
