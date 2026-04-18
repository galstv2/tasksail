# TaskSail — Global Instructions

> Be precise and deterministic. Do not guess at workflow state, code behavior, APIs, or repository access. Prefer current repo artifacts over chat memory.

## Repo Purpose

This repository is the control plane for a repo-based local agent workflow on Windows, macOS, and Linux. It owns the workflow instructions, prompts, queue, handoffs, implementation slices, runtime guardrails, and closeout artifacts.

## Team Roster

Use human names in handoffs. Canonical source: `.github/agents/registry.json`.

| Name | Role | Agent ID | Order |
|---|---|---|---|
| Lily | Planning Specialist | planning-agent | 0 |
| Alice | Product Manager | product-manager | 1 |
| Dalton | Software Engineer | software-engineer | 2 |
| Ron | QA and Closeout | qa | 3 |

## Context-Pack Runtime Signals

| Signal | When available | Otherwise |
|---|---|---|
| `CONTEXT_PACK_CONVENTIONS_STATUS` | Load `CONTEXT_PACK_CONVENTIONS_CONTEXT_FILE` and follow it as style guidance | Continue without conventions; do not invent them |
| `CONTEXT_PACK_CORRECTIONS_STATUS` | Load `CONTEXT_PACK_CORRECTIONS_CONTEXT_FILE` and follow the corrections | Continue without corrections |
| `CONTEXT_PACK_REINFORCEMENT_STATUS` | Load `CONTEXT_PACK_REINFORCEMENT_CONTEXT_FILE` and follow standing expectations | Continue without reinforcement |
| `EXTERNAL_MCP_CONTEXT_STATUS` | If injection is enabled, read `EXTERNAL_MCP_CONTEXT_FILE`, use available MCPs first for their covered domains, and honor degraded/excluded status | Do not assume external MCP availability |

- Do not claim a context-pack memo was loaded unless runtime state says it is available and the file exists.
- If context-pack guidance conflicts with current source or active handoffs, current source and active handoffs win.
- If no context pack is active, stay generic.

## External MCP Guidance

- Treat external MCP runtime signals as advisory launch metadata, not as a guarantee that MCP tools will appear or succeed.
- When present, use `RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON.external_mcp_context` as the structured summary of launch-scoped MCP status and filtered server IDs.
- When `EXTERNAL_MCP_CONTEXT_STATUS` indicates external MCP context is available or degraded, check the current tool list and read `EXTERNAL_MCP_CONTEXT_FILE` when that file is provided.
- For domains explicitly covered by the available external MCPs, prefer those MCP tools before falling back to local search, shell commands, or guesswork.
- If the expected MCP tools are missing, unavailable, or insufficient for the task, say so briefly and continue with a grounded manual fallback.
- Honor degraded or excluded-server context when present; do not assume every configured external MCP is usable in the current session.
- Do not claim an external MCP was consulted unless you actually used the corresponding MCP tool during the current run.

## Workflow Sequence

Standard path only. Fast path is retired.

```text
Lily (intake) → Alice (planning) → Dalton (implementation) → Ron (QA/closeout)
```

If Ron blocks, the remediation loop is `Ron → Dalton → Ron`. On pass or advisory, Ron completes closeout.

## Artifact Rules

`AgentWorkSpace/templates/` contains canonical read-only templates. Do not modify templates during task execution.

Durable workflow artifacts:

- `AgentWorkSpace/pendingitems/*.md`
- `$COPILOT_HANDOFFS_DIR/professional-task.md`
- `$COPILOT_HANDOFFS_DIR/implementation-spec.md`
- `$COPILOT_IMPL_STEPS_DIR/slice-N.md`
- `$COPILOT_HANDOFFS_DIR/parallel-ok.md`
- `$COPILOT_HANDOFFS_DIR/issues.md`
- `$COPILOT_HANDOFFS_DIR/final-summary.md`
- `$COPILOT_HANDOFFS_DIR/retrospective-input.md`

Rules:

- Every role must finish its required artifacts in the required order before handoff. Do not rely on partial handoffs or chat summaries.
- Treat child tasks as new queued tasks, not reopened parent tasks. Preserve child-task lineage explicitly in artifacts.
- Use parent-task QMD only as scoped carry-forward context. Current repo state and fresh handoffs win on conflict.
- Persist important state to files, not chat.
- Treat `handoffs/` as active task state, not as permanent archive.
- Do not edit another role's required artifact unless the current workflow explicitly assigns you to update it.

## Operating Rules

- Keep outputs task-specific, repo-specific, and reviewable.
- Conflict resolution order: current workspace state > active handoffs > context-pack memory > summary artifacts > parent-task memory > chat history.
- `.platform-state/runtime/guardrails/` is runtime evidence, not editable truth.
- Do not run workflow validation, archival, or cleanup scripts manually. The pipeline automates these.
