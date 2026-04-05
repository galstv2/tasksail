# Onboarding

## Goal

Bring up the platform locally, validate the queue-based intake loop, and finish
one intentionally small starter task before attempting broader workflow changes.

## Prerequisites

- Git
- GitHub CLI (`gh`)
- GitHub Copilot CLI access
- Docker Desktop, or Podman with `podman-compose` installed
- Python 3

Podman operators on macOS and Windows must also have a running `podman machine`
before starting platform services.

## Authentication expectations

- Ensure the local user has GitHub Copilot CLI access.
- Copy `.env.example` to `.env` before first-run startup.
- Keep secrets out of tracked repo files and out of context-pack overlay files.

## Custom agent profiles

- `.github/agents/` is a first-class platform layer for repository-scoped
  Copilot workflow roles.
- `.github/agents/registry.json` is the canonical roster for approved workflow
  agent IDs and profile metadata.
- Use `pnpm run agent -- --agent-id <agent-id>` as the
  compliant repository wrapper for invoking a workflow role profile.
- Treat direct raw named-agent invocation such as `copilot --agent <agent-id>`
  as non-compliant unless a repository-controlled internal orchestrator
  explicitly authorizes it.
- Expect that wrapper to run the TypeScript workflow-policy validator's runtime
  legality check before invocation; `--skip-workflow-check` is reserved for
  controlled internal orchestrators.
- `product-manager`, `software-engineer`, and `qa` are pinned to `gpt-5.4`.
- `planning-agent` is pinned to `gpt-4.1` unless you
  add a different `model:` field to its agent frontmatter.
- When launching pinned agents through the wrapper, set
  `RUN_ROLE_AGENT_ACTIVE_MODEL` or `COPILOT_MODEL` to the required pinned
  model.
- Expect wrapper launches to leave machine-readable guardrail evidence under
  `.platform-state/runtime/guardrails/`, and treat the desktop shell as a
  read-only consumer of that runtime evidence.

## First-run walkthrough

1. Clone the repo.
2. Copy `.env.example` to `.env`.
3. Run `pnpm run setup`.
4. Run `pnpm run validate`.
6. Confirm `.github/agents/registry.json` and the repository agent profiles
  under `.github/agents/` are present before starting role-based work.
7. Start support services with:
   `npx tsx src/backend/platform/container/cli.ts bootstrap`
8. If the task targets an external context pack, select the matching context
   pack path.
9. Activate the context pack with
  `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack`.
10. If the project is completely new and does not have a context pack yet,
  bootstrap and first-seed it with
  `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --bootstrap-repo-root /path/to/project-repo`.
   Expect the platform to pause for a short structured questionnaire unless you
   provide a prepared JSON answers file through `--bootstrap-answers-file`.
  That questionnaire now supports multi-repo estates, so you can declare more
  than one repo during first-run bootstrap when the project spans services,
  frontend code, infrastructure, or database repos.
11. If the activation summary reports a missing dry-run plan, rerun with
  `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --write-plan`
  and review the generated plan before live filing.
12. Start the queue poller with `pnpm run watch-dropbox`.

The active container runtime is controlled by `.platform-state/platform.json`
(`container_runtime`). Use `CONTAINER_RUNTIME=...` only as a temporary session
override.

## Desktop shell startup

The TaskSail desktop shell is an optional host-native operator surface.
It does not replace repo artifacts as the source of truth.

1. Change into `src/frontend/desktop/`.
2. Install dependencies with `npm install`.
3. Validate the desktop package with `npm run validate:desktop`.
4. For local packaging, run the host-appropriate command:
   - macOS: `npm run package:mac`
   - Windows: `npm run package:win`
   - Linux: `npm run package:linux`
5. Launch the shell against the checked-out repo root instead of copying queue
  state into the packaged app.
6. Keep these helper seams available from the repo root:
  - `pnpm run plan-dropbox-task`
  - `pnpm run plan-followup-task`
  - `tsx src/backend/platform/context-pack/cli.ts`
1. Use the context-pack sidebar to select an existing pack or open the guided
   `Create context pack` modal when no pack exists yet.
2. Preview or apply the selected pack before expecting planner chat to unlock.
3. Treat the desktop shell as read-only during active workflow execution; use
   planner compose for intake and completed-task planner re-entry for follow-up
   work after closeout.

## Starter-task walkthrough

Use a tiny starter task for the first validation pass.

1. Create a branch.
2. Start `pnpm run watch-dropbox` if it is not already running.
3. Create a toy task with:
   `pnpm run plan-dropbox-task -- --title "Starter Task" --summary "Validate queue intake and handoff seeding."`
4. Confirm the markdown request appears briefly in `AgentWorkSpace/dropbox/`.
5. Confirm the poller moves it into `AgentWorkSpace/pendingitems/`.
6. Confirm the oldest queued item seeds `AgentWorkSpace/handoffs/professional-task.md`.
7. Work the task through the required role flow.
8. After Documentation closeout, confirm:
   - `AgentWorkSpace/handoffs/final-summary.md` has been completed
   - `AgentWorkSpace/handoffs/retrospective-input.md` has been completed with a concise
     retrospective meeting record that targets 1 minute and hard caps at 2
     minutes
   - long-term memory has been filed into QMD when an active context pack is
     configured
   - when a context pack is active, the full retrospective meeting has been
     archived at
     `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`
     with a `.record.json` sidecar and the shared global memory under
     `AgentWorkSpace/qmd/global/retrospectives/` has been refreshed
9. Run `pnpm run complete-pending-item`.
10. Run `pnpm run new-task -- --reset`.
11. Run `pnpm run local-checks`.

## Queue semantics

- `AgentWorkSpace/dropbox/` is only the intake trigger.
- Only `.md` files are accepted into the queue.
- Non-markdown files stay in `AgentWorkSpace/dropbox/` and produce a warning once per poll
  loop.
- `AgentWorkSpace/pendingitems/` is the ordered queue.
- The queue is sequential and oldest-ready wins.
- `AgentWorkSpace/handoffs/` is the active working area.
- Finished items are deleted from `AgentWorkSpace/pendingitems/` only after closeout.

## Artifact lifecycle and cleanup

- `AgentWorkSpace/handoffs/` contains the active task's working files.
- QMD is the long-term archive for completed task memory and repo filings.
- After closeout, clear or reset `AgentWorkSpace/handoffs/` before the next queued task starts.

## Workflow-policy expectations

- Treat repo artifacts as the only durable input to workflow-policy checks.
- Keep `AgentWorkSpace/handoffs/`, `AgentWorkSpace/ImplementationSteps/`, queue files, and when relevant
  context-pack bootstrap artifacts up to date so future policy validation can
  reason from observable state.
- Expect the TypeScript workflow-policy validator at
  `src/backend/platform/workflow-policy/cli.ts` to guard
  activation/bootstrap, pre-slice readiness, closeout, archival, queue
  advancement, and CI checks.
- Treat `lint` mode as advisory visibility and expect guarded transition modes
  plus CI validation to fail closed when required workflow artifacts are
  incomplete or inconsistent.
- Treat `AgentWorkSpace/handoffs/retrospective-input.md` as a required closeout artifact, not
  an optional note, because closeout, archival, queue advancement, and
  follow-up creation now block when the retrospective is missing or incomplete.
- Use `pnpm run local-checks` as the normal operator entrypoint for the
  shared local policy gate before opening a pull request.
- Use `make test-smoke`, `make test-domain DOMAIN=workflow`, or
  `make test-targeted CHANGED=src/backend/platform/workflow-policy/validator.ts`
  during active implementation when you want fast manifest-backed feedback.
- Use `make test-contracts` when the change touches docs, prompt contracts, or
  CI contract surfaces.
- Keep `make local-checks` as the final full local confidence gate before
  merge.
- Expect the `CI` workflow to run the smoke lane, a pull-request changed-path
  domain lane, and the full Python suite, while `Docs Check` runs markdown,
  docs validators, the docs-and-contract lane, targeted desktop shell
  contract tests for planning, observation, context-pack, and follow-up
  surfaces, plus a desktop build.

## Child-task follow-up walkthrough

Follow-up work after closeout becomes a new child task.

1. Finish the parent task normally through Documentation closeout.
2. Confirm the completed task has a task archive in the correct QMD scope when
   a context pack is active.
3. Re-enter the planner from the completed-task prompt in the planning
  workspace, or use `pnpm run plan-followup-task` directly when
  operating outside the desktop shell.
4. Preserve lineage fields such as `parent_task_id`, `parent_qmd_record_id`,
   `parent_qmd_scope`, and `root_task_id`.
5. Treat the parent-task QMD memory as scoped carry-forward context only.
6. Do not reopen the original task.
7. Close the child task with lineage preserved so future follow-ups remain
   traceable.

## Context-pack boundaries

- Load the core platform instructions first and any selected external context
  pack second.
- Use `tsx src/backend/platform/context-pack/cli.ts` as the default operator path instead
  of manually stitching together overlay and dry-run commands.
- Keep target-specific repo inventory, ownership, and glossary data outside the
  core platform repo.
- When a context pack is active, use only that context pack's QMD root for
  default retrieval and filing.
- Per-task retrospective archives stay inside that active context-pack scope at
  `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`,
  while the shared cross-task retrospective memory lives separately at
  `AgentWorkSpace/qmd/global/retrospectives/` outside all context-pack roots.
- Do not mix completed-task memory across unrelated context packs unless a repo
  artifact explicitly asks for cross-context analysis.

## MCP and security notes

- Host-side tooling uses `localhost` MCP endpoints; containerized clients use
  Compose service DNS names.

## Useful commands

- `pnpm run new-task -- --title "Your Task"`
- `pnpm run new-task -- --reset`
- `pnpm run plan-dropbox-task -- --title "Your Task" --summary "What should happen"`
- `pnpm run plan-followup-task -- --help`
- `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack`
- `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --bootstrap-repo-root /path/to/project-repo`
- `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --bootstrap-repo-root /path/to/project-repo --bootstrap-answers-file /path/to/bootstrap-answers.json`
- `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --write-plan`
- `pnpm run agent -- --agent-id <agent-id> --dry-run`
- `pnpm run watch-dropbox`
- `pnpm run queue-status`
- `pnpm run complete-pending-item`
- `pnpm run local-checks`
- `make test-smoke`
- `make test-domain DOMAIN=workflow`
- `make test-contracts`
- `make local-checks`
- `cd src/frontend/desktop && npm run validate:desktop`
- `cd src/frontend/desktop && npm run package:mac` / `npm run package:win` / `npm run package:linux`

## Troubleshooting

- If a file stays in `AgentWorkSpace/dropbox/`, confirm the poller is running.
- If a file reaches `AgentWorkSpace/pendingitems/` but does not seed
  `AgentWorkSpace/handoffs/professional-task.md`, confirm the current `AgentWorkSpace/handoffs/` workspace has
  been cleared or reset.
- If closeout is done but the queue does not advance, first verify
  `AgentWorkSpace/handoffs/final-summary.md` has content, then run
  `pnpm run complete-pending-item`, then reset `AgentWorkSpace/handoffs/` with
  `pnpm run new-task -- --reset`.
- If child-task carry-forward context looks wrong, confirm the selected
  `parent_qmd_scope` and active context-pack overlay are correct.
- If activation output reports a missing dry-run plan, rerun the activation
  command with `--write-plan` and review the generated plan before live filing.
- If workflow-policy checks fail, fix the cited repo artifact first rather than
  trying to rely on chat history or undocumented operator intent.
