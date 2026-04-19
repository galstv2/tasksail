"""Named repository file groups for shared test workspaces."""

AGENT_INSTRUCTION_FILES = [
    ".github/copilot/instructions/planning-agent.instructions.md",
    ".github/copilot/instructions/product-manager.instructions.md",
    ".github/copilot/instructions/software-engineer.instructions.md",
    ".github/copilot/instructions/qa.instructions.md",
]

AGENT_PROFILE_FILES = [
    ".github/agents/planning-agent.md",
    ".github/agents/product-manager.md",
    ".github/agents/software-engineer.md",
    ".github/agents/qa.md",
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
