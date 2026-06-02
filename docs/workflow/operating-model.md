# Operating Model

## Core operating rules

- The platform is human-supervised.
- Repo artifacts are the durable workflow state.
- `.github/agents/` is a first-class platform layer for repository-scoped
  CLI-backed workflow roles, and `.github/agents/registry.json` is the canonical
  roster for approved agent IDs, profile paths, and declared model pins.
- Repository-scoped workflow roles live in `.github/agents/` and
  should be invoked through
  `pnpm run agent -- --agent-id <agent-id>` when the operator
  wants the platform's named role profiles.
- For approved named workflow roles, the wrapper is the compliant launch seam;
  direct raw provider CLI invocation is non-compliant unless a repository-
  controlled internal orchestrator explicitly authorizes it.
- Each approved wrapper launch resolves the active CLI provider and starts a
  fresh task-scoped provider subprocess, currently `copilot --agent`, waits for
  it to exit, and then returns control to the operator.
- The production wrapper seam is the TypeScript runtime under
  `src/backend/platform/agent-runner/`. The files in
  the active provider's prompt paths (`.github/copilot/prompts/` for the
  shipped `copilot` provider) are intentionally short phase-entry prompts; the
  durable workflow policy lives in provider-owned instructions
  (`.github/copilot/instructions/` for `copilot`) and runtime guardrails.
- Because the current runtime is task-scoped rather than a long-lived shared
  CLI session, the platform does not add an end-of-task `/compact` step.
- Each approved wrapper launch also applies a registry-backed autonomy profile:
  `repo-executor` for `software-engineer`, and `artifact-author` for the
  remaining named workflow roles.
- `repo-executor` launches suppress routine approval prompts with
  `--allow-all-tools` and `--no-ask-user`, while explicit deny rules still
  block dangerous commands such as `git add`, `git commit`, `git push`, `rm`,
  and privilege escalation.
- `repo-executor` launches are confined to the active context pack and its
  approved working roots. If the active context pack cannot be resolved,
  high-autonomy execution fails closed instead of silently widening scope.
- `artifact-author` launches remain autonomous for repo-local authoring work
  without broad shell auto-approval. When an active context pack is present,
  runtime receipts record that boundary context; otherwise the narrower
  artifact-author profile falls back to repo-root.
- `AgentWorkSpace/dropbox/` is an intake trigger, not a task archive.
- `AgentWorkSpace/pendingitems/` is the sequential queue.
- `AgentWorkSpace/tasks/<taskId>/handoffs/` is the active task workspace.
- QMD is long-term retrieval memory, not the active source of truth.

The `product-manager` and `qa` profiles are pinned to `gpt-5.4`; `planning-agent`,
`software-engineer`, and `software-engineer-verify` are pinned to
`claude-sonnet-4.6`.

Pinned wrapper launches provide active model evidence through
`RUN_ROLE_AGENT_ACTIVE_MODEL`; the active provider maps the selected model into
provider-specific env such as `COPILOT_MODEL` for the shipped `copilot`
provider before process spawn.

Provider selection resolves from an explicit runtime request, then
`TASKSAIL_CLI_PROVIDER`, then `.platform-state/platform.json` `cli_provider`,
then the default `copilot` provider. `copilot` is the only shipped provider.

## Intake and queue flow

Named workflow team: Planning Agent (Lily), Product Manager (Alice), Software Engineer (Dalton), and QA and Closeout (Ron).

Lily is operator-facing pre-task planning only. Automated task execution starts after queue activation and runs the unattended active-task pipeline: Alice → Dalton → Ron.

1. Lily, the Planning Agent, or the operator places a markdown request in `AgentWorkSpace/dropbox/`.
2. The publish path moves the file into `AgentWorkSpace/pendingitems/`.
3. Non-markdown files in `AgentWorkSpace/dropbox/` are ignored and generate a warning once per
   poll loop.
4. The queue activates the oldest pending item when `AgentWorkSpace/tasks/<taskId>/handoffs/` is in a reset
   state.
5. The active pending item initializes the handoff files and seeds
   `AgentWorkSpace/tasks/<taskId>/handoffs/professional-task.md`.
6. Lily may create the intake markdown with
   `pnpm run plan-dropbox-task` without changing queue behavior.

## Required workflow

1. Product Manager completes `AgentWorkSpace/tasks/<taskId>/handoffs/professional-task.md`,
   `AgentWorkSpace/tasks/<taskId>/handoffs/implementation-spec.md`, and the authoritative
   `AgentWorkSpace/tasks/<taskId>/ImplementationSteps/sliceN.md` handoff set. Alice owns this
   step.
   - each slice must introduce one coherent implementation seam
   - slices must be sequenced toward the target architecture
   - each slice must be independently actionable and testable
   - no slice may leave the repo in a broken or intermediate-only state
   - current behavior and workflow-policy boundaries must be preserved unless
     the slice explicitly authorizes a change
   - each slice must name expected files, done criteria, test requirements, and
     validation commands
   - `AgentWorkSpace/tasks/<taskId>/handoffs/parallel-ok.md` signals task complexity — PM
     writes "Complex" to trigger parallel Dalton execution or "Simple" for singleton
     mode, only when slice independence is real rather than assumed
2. Dalton, the Software Engineer, implements the assigned slice or slices.
3. Ron, QA and Closeout, reviews the task, records issues in
   `AgentWorkSpace/tasks/<taskId>/handoffs/issues.md` if needed, and owns closeout on `pass`
   or `advisory`.
4. The workflow team completes `AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md` as a concise
   retrospective before archival and queue advancement.
   - target 1 minute
   - hard cap 2 minutes
   - cover the summary, action items, and one contribution section per named
     workflow role
5. Ron closes the task in `AgentWorkSpace/tasks/<taskId>/handoffs/final-summary.md`.

## Slice-authoring rules

- `AgentWorkSpace/tasks/<taskId>/ImplementationSteps/` slices are execution-ready instructions, not rough
  brainstorming notes.
- A single slice should be implementable on its own while keeping the repo
  lintable, buildable, and testable.
- Slices should avoid partial abstractions that require later slices merely to
  restore correctness.
- Every slice should include targeted validation expectations for the touched
  behavior.
- Fleet (Complex) execution is allowed only when slices do not share
  correctness, ordering, or file-level dependencies.

## QA remediation loop

Every QA-triggered code change must follow:

QA → Software Engineer → QA

Named loop: Ron → Dalton → Ron

## Artifact state and authority

- `AgentWorkSpace/tasks/<taskId>/handoffs/` contains the current task's working truth.
- `AgentWorkSpace/tasks/<taskId>/ImplementationSteps/` contains the approved execution slices.
- QMD contains archived completed-task memory and repo knowledge.
- Parent-task QMD memory may inform child-task shaping, but it must not
  override current repo state or fresh `AgentWorkSpace/tasks/<taskId>/handoffs/` artifacts.

## Child-task follow-up model

Follow-up work after closeout becomes a new child task rather than reopening the
original completed task.

Required lineage fields include:

- `parent_task_id`
- `parent_qmd_record_id`
- `parent_qmd_scope`
- `root_task_id`
- `followup_reason`

Child-task rules:

- resolve the parent archive from the declared lineage
- use parent-task QMD memory as scoped carry-forward reference context only
- create a new intake through `AgentWorkSpace/dropbox/` and `AgentWorkSpace/pendingitems/`
- preserve direct-parent and root lineage at closeout
- keep completed child tasks valid future parents for later follow-ups

## Closeout and archival

- QA closes the task in `AgentWorkSpace/tasks/<taskId>/handoffs/final-summary.md`.
- The workflow team must complete `AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md` before
  closeout can archive or advance the queue.
- When a context pack is active, the completed task is archived into the
  scoped QMD task archive.
- The full retrospective meeting is archived into the active context pack at
  `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`
  with a companion `.record.json` sidecar.
- The platform also updates the dedicated global retrospective root at
  `AgentWorkSpace/qmd/global/retrospectives/`, including per-task history entries, shared
  synthesis, and retrospective indexes.
- After closeout, remove the active queue item with
  `pnpm run complete-pending-item`.
- Reset `AgentWorkSpace/tasks/<taskId>/handoffs/` with `pnpm run new-task -- --reset` before the next pending
  item activates.

## Context-pack operating rules

- Load the generic platform workflow before any selected context-pack overlay.
- Use `tsx src/backend/platform/context-pack/cli.ts` as the standard operator entrypoint
  for context-pack setup.
- Keep organization-specific repo inventory, glossary, and ownership guidance in
  external context packs.
- Store and retrieve long-term task memory from the active context pack's QMD
  scope by default.
- Only perform cross-context-pack retrieval when a task artifact explicitly
  requires it.

## Workflow-policy enforcement contract

- The canonical enforcement seam is the TypeScript workflow-policy validator
  under `src/backend/platform/workflow-policy/`, exposed for CLI usage via
  `src/backend/platform/workflow-policy/cli.ts`.
- `tsx src/backend/platform/agent-runner/cli.ts` resolves approved role
  profiles from the canonical `.github/agents/registry.json` roster and
  delegates runtime role legality checks to the workflow-policy validator, but
  lifecycle legality is still enforced by that shared validator rather than by
  hidden session state.
- The guardrail contract should remain explicit and artifact-driven: approved
  launch seam, requested role, expected role, required model, validator mode,
  and any guardrail violations should be representable as machine-readable
  runtime evidence under `.platform-state/runtime/`.
- Guardrail launch receipts should live under
  `.platform-state/runtime/guardrails/`, and desktop observability should
  consume them as read-only evidence rather than as a writable policy surface.
- Policy decisions must be derived from repo artifacts such as `AgentWorkSpace/tasks/<taskId>/handoffs/`,
  `AgentWorkSpace/tasks/<taskId>/ImplementationSteps/`, `AgentWorkSpace/pendingitems/`,
  `AgentWorkSpace/qmd/repo-sources.json`, and when bootstrap created the pack,
  `AgentWorkSpace/qmd/bootstrap/bootstrap-answers.json`.
- Policy checks should guard the transitions that mutate durable workflow state:
  activation/bootstrap, pre-slice readiness, closeout, archival, and queue
  advancement.
- Rollout remains phased, but the tightened default is now: advisory `lint`
  visibility for diagnosis, fail-closed guarded transitions for activation,
  slicing, closeout, archival, and queue movement, plus CI-enforced repository
  checks.
- Operators should keep repo artifacts complete enough for deterministic
  validation because the validator now enforces the workflow-policy contract at
  the guarded transitions and in CI.

## MCP operating rules

### Internal platform MCP

- Use registered MCP categories instead of ad hoc external access.
- If an external context pack is active, activate it through the high-level
  activation command before relying on target-estate-specific MCP settings.

### External third-party MCP

- External MCP servers are operator-configured in
  `config/mcp-registry-external.default.json` (tracked seed) and
  `.platform-state/mcp-registry-external.json` (runtime, operator-mutable).
- The platform injects approved external MCP servers into agent launches via the
  active provider's MCP config arguments. Each shipped `copilot` provider launch
  gets an isolated directory under `.platform-state/runtime/copilot-home/` to
  prevent races between concurrent launches.
- Header values referencing environment variables (`${ENV_VAR}`) are resolved
  at materialization time. Missing variables exclude the affected server with
  an actionable warning — the launch continues without that server.
- MCP injection provides launch-time visibility to approved external MCPs as
  available MCP tools. The platform does not guarantee the agent will
  actually use them.
- The internal and external registries are intentionally separate. Do not
  modify the internal `config/mcp-registry.default.json` for third-party
  servers.
- `.github/copilot/` is not used for MCP registration. External MCP
  configuration is handled entirely through the registry files and active
  provider MCP config injection; provider-specific home variables such as
  `COPILOT_HOME` are not exported by the helper.

## Day-to-day operator sequence

1. Start or verify support services.
2. Start the queue poller when working queued tasks.
3. Optionally validate or package the host-native desktop shell from
   `src/frontend/desktop/` when using the TaskSail operator surface.
4. Create or accept a planner-shaped intake.
5. Review artifact progress role by role.
6. Enforce the QA remediation loop when required.
7. Close the task with Documentation.
8. Remove the finished queue item and reset `AgentWorkSpace/tasks/<taskId>/handoffs/`.
9. Run `pnpm run local-checks` before shipping changes.

## Desktop shell operating rules

- The desktop shell runs host-native against the repo root; it does not bundle
  or relocate repo workflow state.
- During active or blocked work, the desktop shell is an observability surface,
  not an unrestricted terminal.
- Guardrail verdicts, internal-bypass attestations, and denied-launch evidence
  remain repo-owned runtime artifacts; the desktop shell may render them but
  must not author or mutate them.
- The persistent context-pack sidebar is the desktop entrypoint for selecting,
  previewing, applying, or creating a context pack.
- Planner compose remains the only writable intake surface for new work, and
  planner chat stays locked until a context pack is active.
- After closeout, follow-up work must create a new child task rather than
  reopening the completed task, using the completed-task re-entry prompt to
  return to planner compose.
- Context-pack setup in the desktop shell must stay on the stable activation
  seam `tsx src/backend/platform/context-pack/cli.ts`, including `--write-plan`,
  `--bootstrap-repo-root`, and `--bootstrap-answers-file` when needed.
- Desktop preview/apply actions may stage and inspect workspace changes, but
  backend-owned helpers still own activation, bootstrap, and workspace-sync
  mutations.
- Local desktop packaging runs through the host-appropriate command:
  `cd src/frontend/desktop && npm run package:mac`,
  `npm run package:win`, or `npm run package:linux`, and writes artifacts under
  `src/frontend/desktop/release/`.

## CI and policy gates

- During active implementation, prefer `pnpm run test:smoke`,
  `pnpm run test:domain -- --domain <name>`, or
  `pnpm run test:targeted -- --changed <path>` for fast manifest-backed validation.
  On Unix/macOS/Linux, `make test-smoke`, `make test-domain DOMAIN=<name>`, and
  `make test-targeted CHANGED=<path>` are available as convenience aliases; `make`
  is not available by default on native Windows — use the `pnpm run ...` forms.
- Use `pnpm run test:contracts` (or `make test-contracts` on Unix/macOS/Linux)
  for docs, operating-model, prompt-contract, and CI contract edits.
- Keep tests.md quality aligned with
  `src/backend/platform/workflow-policy/rules/sweExecution.ts` so QA receives
  substantive testing evidence from Dalton.
- Run `pnpm run local-checks` (or `make local-checks` on Unix/macOS/Linux)
  before opening a pull request.
- Expect pull requests to pass the `CI`, `Docs Check`, and `CodeQL` workflows
  under `.github/workflows/`.
- The `CI` workflow separates a smoke lane, a changed-path domain lane for
  pull requests, and the full Python suite so fast failures and full
  confidence remain distinct.
- The `Docs Check` workflow owns markdown quality, docs validators, handoff
  template validation, the docs-and-contract lane, and targeted desktop shell
  contract checks across planning, observation, context-pack, and follow-up
  surfaces.
- Keep handoff template changes aligned with
  `src/backend/platform/workflow-policy/rules/template.ts` and the generators in
  `src/backend/platform/queue/`.
- Keep dropbox intake content aligned with
  `src/backend/platform/workflow-policy/rules/intake.ts` and the intake template in
  `tsx src/backend/platform/queue/cli.ts create-dropbox-task`.
- Expect workflow-policy enforcement to converge on the same repo-artifact
  contract locally and in CI rather than relying on prompt-only compliance.

## First-run context-pack bootstrap

- When onboarding a new context pack, run
  `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack`
  first.
- If the target project is brand new and no context pack exists yet, bootstrap
  one with
  `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --bootstrap-repo-root /path/to/project-repo`
  and answer the structured bootstrap questionnaire, or provide
  `--bootstrap-answers-file /path/to/bootstrap-answers.json` for repeatable
  non-interactive setup. That questionnaire now supports multi-repo estates,
  not just a single service repo.
- If the activation summary reports a missing dry-run plan, rerun with
  `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --write-plan`
  and review the generated plan before live indexing.
- Keep the context pack's `AgentWorkSpace/qmd/repo-sources.json` current so multi-repo estates
  can be filed repo by repo into the correct QMD partitions.
- Treat the dry-run plan as a mandatory preflight for high-signal, low-noise QMD
  retrieval.
- Bootstrap-created packs now also record normalized questionnaire answers under
  `AgentWorkSpace/qmd/bootstrap/bootstrap-answers.json` before manifest creation and first-run
  seeding.
