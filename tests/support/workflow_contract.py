"""Provider-neutral workflow contract — Python mirror of
src/backend/platform/cli-provider/workflowContract.ts (role IDs + registry field
keys) and the platform-required registry fields from
src/backend/platform/workflow-policy/models.ts.

Shared test code references these instead of hardcoding the literals, so a new
CLI provider that conforms to the contract needs no test-support edits. Kept in
sync with the TypeScript sources by
tests/domains/docs_contracts/test_workflow_contract_parity.py.
"""
from __future__ import annotations

PLANNER_ROLE_ID = "planning-agent"
PRODUCT_MANAGER_ROLE_ID = "product-manager"
SOFTWARE_ENGINEER_ROLE_ID = "software-engineer"
QA_ROLE_ID = "qa"

WORKFLOW_ROLE_IDS = (
    PLANNER_ROLE_ID,
    PRODUCT_MANAGER_ROLE_ID,
    SOFTWARE_ENGINEER_ROLE_ID,
    QA_ROLE_ID,
)

REGISTRY_FIELD_INSTRUCTION_PATH = "instruction_path"
REGISTRY_FIELD_AGENT_PROFILE_PATH = "agent_profile_path"

# Provider-declared registry fields (CliProvider.requiredRegistryFields()).
REQUIRED_REGISTRY_FIELDS = (
    REGISTRY_FIELD_INSTRUCTION_PATH,
    REGISTRY_FIELD_AGENT_PROFILE_PATH,
)

# Platform-required registry fields (workflow-policy models.ts).
PLATFORM_REQUIRED_REGISTRY_FIELDS = (
    "agent_id",
    "role_name",
    "human_name",
    "autonomy_profile",
    "workflow_order",
)
