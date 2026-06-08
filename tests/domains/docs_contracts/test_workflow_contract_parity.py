"""Cross-language guard: the Python workflow-contract mirror must match the
TypeScript sources of truth, so the role IDs / registry field keys cannot drift
between the platform and the test suite.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from tests.support.workflow_contract import (
    PLANNER_ROLE_ID,
    PLATFORM_REQUIRED_REGISTRY_FIELDS,
    REQUIRED_REGISTRY_FIELDS,
    WORKFLOW_ROLE_IDS,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_TS = REPO_ROOT / "src/backend/platform/cli-provider/workflowContract.ts"
MODELS_TS = REPO_ROOT / "src/backend/platform/workflow-policy/models.ts"


def _const_str(name: str, text: str) -> str | None:
    match = re.search(name + r"\s*=\s*'([^']+)'", text)
    return match.group(1) if match else None


def _set_literal(name: str, text: str) -> tuple[str, ...]:
    match = re.search(name + r"\s*=\s*new Set\(\[(.*?)\]\)", text, re.S)
    return tuple(re.findall(r"'([^']+)'", match.group(1))) if match else ()


class WorkflowContractParityTests(unittest.TestCase):
    def test_role_ids_and_required_fields_match_ts_contract(self) -> None:
        text = CONTRACT_TS.read_text(encoding="utf-8")
        ts_roles = tuple(
            _const_str(name, text)
            for name in (
                "PLANNER_ROLE_ID",
                "PRODUCT_MANAGER_ROLE_ID",
                "SOFTWARE_ENGINEER_ROLE_ID",
                "QA_ROLE_ID",
            )
        )
        ts_fields = tuple(
            _const_str(name, text)
            for name in (
                "REGISTRY_FIELD_INSTRUCTION_PATH",
                "REGISTRY_FIELD_AGENT_PROFILE_PATH",
            )
        )
        self.assertEqual(ts_roles, WORKFLOW_ROLE_IDS)
        self.assertEqual(ts_fields, REQUIRED_REGISTRY_FIELDS)
        self.assertEqual(_const_str("PLANNER_ROLE_ID", text), PLANNER_ROLE_ID)

    def test_platform_required_fields_match_models_ts(self) -> None:
        text = MODELS_TS.read_text(encoding="utf-8")
        ts_platform = _set_literal("PLATFORM_REQUIRED_AGENT_REGISTRY_FIELDS", text)
        self.assertEqual(set(ts_platform), set(PLATFORM_REQUIRED_REGISTRY_FIELDS))


if __name__ == "__main__":
    unittest.main()
