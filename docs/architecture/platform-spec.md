# Platform Spec

## Local architecture

The platform is a repo-local workflow control plane with six main layers:

1. repo instructions and prompts in `.github/copilot/`
2. workflow agent registry and profiles in `.github/agents/`
3. workflow state in `AgentWorkSpace/tasks/<taskId>/handoffs/` and `AgentWorkSpace/tasks/<taskId>/ImplementationSteps/`
4. support services in `docker/`
5. queue-based intake in `AgentWorkSpace/dropbox/` and `AgentWorkSpace/pendingitems/`

The operator works from the host workstation. Support services may run in
Docker, but operator-facing desktop surfaces are expected to remain host-native
rather than becoming additional service containers.

`.github/agents/registry.json` is the canonical roster for approved workflow
agent IDs, profile files, and declared model requirements. The compliant
operator seam for those repository-scoped roles is
`pnpm run agent -- --agent-id <agent-id>`, while direct raw
named-agent invocation is non-compliant unless a repository-controlled internal
orchestrator explicitly authorizes it.

The wrapper delegates runtime role-legality checks to the TypeScript
workflow-policy validator at `src/backend/platform/workflow-policy/cli.ts`
before invocation, and `--skip-workflow-check` is reserved for controlled
internal orchestrators.

Each approved wrapper launch is a fresh task-scoped `copilot --agent`
subprocess. The wrapper records start and terminal receipts around that
subprocess, waits for it to exit, and then returns control to the operator.
Because the runtime model is currently process-scoped per task rather than a
long-lived shared session, the platform does not add an end-of-task
`/compact` step.

## Queue model

- Lily, the Planning Agent, or operators add markdown requests to `AgentWorkSpace/dropbox/`.
- The poller moves those files into `AgentWorkSpace/pendingitems/`.
- Non-markdown files are ignored in place and logged as warnings once per poll loop.
- `AgentWorkSpace/pendingitems/` is processed sequentially.
- The active pending item initializes the `AgentWorkSpace/tasks/<taskId>/handoffs/` workspace and seeds `AgentWorkSpace/tasks/<taskId>/handoffs/professional-task.md`.
- Finished items are deleted from `AgentWorkSpace/pendingitems/` only after closeout is complete.
- `pnpm run plan-dropbox-task` can create queue-ready markdown intake without bypassing the queue.
- `pnpm run plan-followup-task` creates new child-task intake after closeout
  without reopening the original task.

## Source-of-truth boundaries

- `AgentWorkSpace/dropbox/` is a trigger only.
- `AgentWorkSpace/pendingitems/` is the active queue.
- `AgentWorkSpace/tasks/<taskId>/handoffs/` is the active task workspace.
- `AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md` is a required closeout artifact before
  archival, queue advancement, and follow-up creation.
- QMD is the long-term agent memory archive.
- Per-task retrospective archives live in the active context-pack QMD scope,
  while shared cross-task retrospective memory lives under the dedicated global
  root `AgentWorkSpace/qmd/global/retrospectives` outside all context-pack roots.
- Parent-task QMD memory is scoped reference context for child tasks only; it
  does not override current repo state or fresh handoff artifacts.

## Workflow-policy enforcement architecture

- The TypeScript workflow-policy validator under
  `src/backend/platform/workflow-policy/` is the canonical enforcement seam for
  lifecycle legality across queue, handoff, closeout, archival, CI, and
  context-pack bootstrap transitions.
- The validator contract is repo-artifact-driven: it validates observable
  files rather than hidden agent memory or inferred intent.
- Machine-readable results should include mode, phase, violation count,
  violation details, and remediation guidance so local scripts and CI can share
  one policy engine.
- Launch-time guardrail evidence should also preserve the approved launch seam,
  requested role, expected role, required model, active model, and bypass
  status under `.platform-state/runtime/guardrails/` so runtime inspection and
  desktop observability can consume one additive contract.
- Current rollout behavior keeps `lint` advisory while guarded transitions for
  pre-slice readiness, closeout, archival, queue advancement,
  activation/bootstrap legality, and CI validation run fail closed.
- When activation bootstraps a new context pack,
  `AgentWorkSpace/qmd/bootstrap/bootstrap-answers.json` and `AgentWorkSpace/qmd/repo-sources.json` become the
  creation contract that future policy checks must validate before manifest
  creation drift can spread.

## Task initialization

- `pnpm run new-task` initializes manual-task handoffs from canonical templates.
- `pnpm run new-task -- --reset` clears active handoffs back to template shape after closeout.
- Queue activation must wait until the handoff workspace is reset before claiming the next pending item.
- Queue-created tasks are expected to flow through Alice's planning and
  slice-authoring step before Dalton picks up execution.

## Desktop observability boundary

- The desktop shell is a read-only operator surface over repo truth.
- Guardrail receipts, parallel bypass attestations, and workflow-policy runtime
  evidence stay in repo-owned runtime artifacts rather than in desktop-managed
  state.
- Desktop rendering may summarize guardrail health, but it must not invent,
  suppress, or mutate policy decisions.

## Workflow path selection

- `AgentWorkSpace/tasks/<taskId>/handoffs/implementation-spec.md` records Alice's planning,
  architecture, and execution split decisions.
- `AgentWorkSpace/tasks/<taskId>/ImplementationSteps/sliceN.md` is the authoritative execution
  handoff for Dalton.
- `parallel-ok.md` signals task complexity — "Complex" triggers fleet Dalton
  mode, "Simple" triggers singleton mode.
- QA remains required after implementation.

## Child-task follow-up model

- Completed tasks remain closed.
- Follow-up work enters as a new child task rather than reopening the original
  queue item.
- Follow-up creation must respect the same fail-closed retrospective gate as
  closeout and archival.
- Child tasks preserve lineage fields such as `parent_task_id`,
  `parent_qmd_record_id`, `parent_qmd_scope`, and `root_task_id`.
- Completed child tasks preserve lineage at closeout so later follow-ups can
  continue the chain.

## Retrospective memory model

- Every completed task must produce a concise retrospective in
  `AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md`.
- The meeting should be quick and concise: target 1 minute and hard cap 2
  minutes.
- The active context pack stores the full meeting record and structured sidecar
  at
  `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`
  plus `.record.json`.
- The dedicated global retrospective root remains separate from all context-pack
  scopes and defaults to `AgentWorkSpace/qmd/global/retrospectives`.
- That global root stores per-task history entries, the rolling shared
  synthesis in `shared-retrospective-memory.md`, and derived retrospective
  indexes.
- Repo Context MCP exposes retrospective retrieval separately from task-archive
  retrieval through `/retrospective` and `/shared-retrospective-memory`.

## MCP categories

- `github` for repository and collaboration system access
- `repo-context` for local codebase indexing and retrieval

## MCP endpoint model

**Internal platform MCP:**
- Host-side tooling uses `localhost` endpoints such as `REPO_CONTEXT_MCP_URL`.
- Containerized callers use Compose service DNS names such as
  `repo-context-mcp`.
- Managed through `config/mcp-registry.default.json` and the internal
  `mcp-registry/` platform module.

**External third-party MCP:**
- Operator-configured in `config/mcp-registry-external.default.json` (tracked
  seed) and `.platform-state/mcp-registry-external.json` (runtime copy).
- Injected into agent launches via per-launch `COPILOT_HOME` directories
  under `.platform-state/runtime/copilot-home/<agent-id>-<epoch-ms>-<pid>/`.
- Each launch directory contains `mcp-config.json` (with resolved headers)
  and `mcp-capability-summary.md` (agent context overlay).
- Header env variable references (`${ENV_VAR}`) are resolved at
  materialization time. Missing variables exclude the server (fail-closed per
  server, not per launch).
- Per-launch isolation prevents races between concurrent Dalton launches.
  Stale directories are cleaned up via process-aware PID checks at launch
  start.
- Phase-1 UI validation uses MCP `initialize` handshake only. Any
  `tools/list` call is best-effort diagnostics, not required for save
  enablement.
- MCP injection provides launch-time visibility to approved external MCPs as
  available MCP tools. The platform does not guarantee tool usage by the
  agent.
- `.github/copilot/` is not used as an MCP registration surface.
## Context-pack activation

- `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack` is the canonical operator entrypoint for context-pack activation.
- The activation command validates pack structure, persists active context-pack state, and reports dry-run readiness.
- The activation command can also bootstrap a new context pack and seed it on first run through `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --bootstrap-repo-root /path/to/project-repo`, including distributed multi-repo estates declared through the structured bootstrap questionnaire.
- That bootstrap path is gated by a structured questionnaire so the platform captures the minimum creation contract before it writes the manifest or seeds QMD.

## Context-pack boundaries

- The core platform repo stays generic and reusable.
- The core platform repo keeps `.github/agents/` as a required platform layer;
  external context packs refine target-estate behavior but do not replace the
  repository-scoped workflow agent roster.
- Target-specific overlays belong in external context packs.
- QMD memory must be partitioned into platform-core and context-pack-specific roots.
- Active work should resolve QMD retrieval against the selected context pack root by default.
- Context-pack guidance refines target-estate settings, but it does not replace
  the platform's core workflow rules.

## QMD first-run seeding

- A new context pack should declare its repository estate in `AgentWorkSpace/qmd/repo-sources.json`.
- The first run for that context pack should activate it through `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack` and generate a dry-run QMD seeding plan before any live filing occurs.
- For a brand-new project or distributed estate without an existing context pack, activation may bootstrap the initial manifest and run the first live seed automatically when `--bootstrap-repo-root` is supplied.
- The bootstrap questionnaire should capture at least the context-pack ID, the project or estate display name, the repository count in scope, and per-repo inventory fields such as repo ID, repo name, owner/org, local root, system layer, languages, artifact roots, document paths, bounded context, and service name.
- The dry run must support platforms distributed across multiple repositories and multiple local checkout locations.
- Live seeding should proceed repo by repo after the dry run confirms the correct QMD targets.
- Workflow-policy enforcement treats the bootstrap answers and generated repo
  inventory as the fail-closed legality contract for bootstrap-created context
  packs.
