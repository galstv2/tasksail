"""Named repository file groups for shared test workspaces."""

from tests.support.workflow_contract import WORKFLOW_ROLE_IDS

# Copilot path templates; the role list comes from the provider-neutral contract
# so a roster change flows from one place. A non-Copilot provider adds its own set.
AGENT_INSTRUCTION_FILES = [
    f".github/copilot/instructions/{role}.instructions.md" for role in WORKFLOW_ROLE_IDS
]

AGENT_PROFILE_FILES = [
    f".github/agents/{role}.md" for role in WORKFLOW_ROLE_IDS
]

AGENT_CONTRACT_FILES = [
    *AGENT_INSTRUCTION_FILES,
    *AGENT_PROFILE_FILES,
    ".github/copilot/prompts/start-task.prompt.md",
    ".github/copilot/prompts/continue-task.prompt.md",
    ".github/copilot/prompts/execute-task.prompt.md",
    ".github/agents/registry.json",
]

ROLE_AGENT_WORKSPACE_FILES = [
    "src/backend/scripts/python/run-role-agent-helper.py",
    "src/backend/scripts/python/repo-context-app.py",
    *AGENT_CONTRACT_FILES,
]

QUEUE_POLICY_WORKSPACE_FILES = [
    *AGENT_CONTRACT_FILES,
]

QUEUE_RUNTIME_WORKSPACE_FILES = [
    "src/backend/scripts/python/file-task-archive.py",
    *AGENT_CONTRACT_FILES,
    "src/__init__.py",
    "src/backend/__init__.py",
    "src/backend/mcp/__init__.py",
    "src/backend/mcp/repo_context_mcp/__init__.py",
    "src/backend/mcp/repo_context_mcp/config.py",
    "src/backend/mcp/repo_context_mcp/utils.py",
    "src/backend/mcp/repo_context_mcp/models.py",
    "src/backend/mcp/repo_context_mcp/services/__init__.py",
    "src/backend/mcp/repo_context_mcp/services/archive_service.py",
    "src/backend/mcp/repo_context_mcp/services/qmd_index_service.py",
    "src/backend/mcp/repo_context_mcp/services/record_cache.py",
]

PARALLEL_DALTONS_WORKSPACE_FILES = [
    "src/backend/scripts/python/repo-context-app.py",
    *AGENT_CONTRACT_FILES,
]

WORKFLOW_VALIDATOR_WORKSPACE_FILES = [
    *AGENT_CONTRACT_FILES,
]
