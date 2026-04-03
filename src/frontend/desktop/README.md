# TaskSail Desktop Shell

This subtree contains the Electron-based operator frontend for the TaskSail capstone.

## Current scope

- Electron main-process entry in `electron/main.ts`
- Electron preload bridge in `electron/preload.ts`
- React renderer UI in `src/renderer/`
- Vite-based development/build flow
- cross-platform packaging configuration through `electron-builder`

## Local development

From this directory:

1. Install dependencies with `npm install`
2. Start the local shell with `npm run dev`
3. Run unit tests with `npm test`
4. Validate the desktop package with `npm run validate:desktop`

## Packaging

- Build macOS artifacts with `npm run package:mac` or `npm run package:mac:zip`
- Build a Windows installer with `npm run package:win`
- Build Linux artifacts with `npm run package:linux`
- Packaging output is written to `release/`
- Example output locations:
  - macOS Apple Silicon: `release/mac-arm64/TaskSail.app`
  - macOS Intel: `release/mac/TaskSail.app`
  - Windows: `release/win-unpacked/`
  - Linux: `release/linux-unpacked/`

Packaging is host-native and platform-specific, but the app still runs against
the checked-out repo root rather than embedding or relocating workflow state
into the bundle.

## Host-native runtime expectations

- Launch from a machine that has the full repo checkout available
- Keep `AgentWorkSpace/dropbox/`, `AgentWorkSpace/pendingitems/`, `AgentWorkSpace/handoffs/`, and `AgentWorkSpace/ImplementationSteps/` under the repo root
- Treat `AgentWorkSpace/handoffs/retrospective-input.md` as a required closeout artifact before
  queue advancement or follow-up creation; the desktop shell observes that repo
  workflow, but does not create or complete the retrospective directly
- Keep helper seams available:
  - `pnpm run plan-dropbox-task`
  - `pnpm run plan-followup-task`
  - `tsx src/backend/platform/context-pack/cli.ts`
- Preserve the repo workflow as the source of record; the desktop shell is an operator surface, not a workflow rewrite

## Context-pack workflow

The desktop shell keeps context-pack selection and bootstrap visible, but the backend-owned helper seams still perform the actual mutations.

- Use the persistent sidebar to select an existing context pack, preview workspace scope, and apply the approved switch.
- If no suitable pack exists yet, start the guided `Create context pack` modal from the sidebar or the planner lock banner.
- Planner chat stays locked until a context pack is active, so selection, preview, apply, and creation are part of the normal pre-task flow.
- Default activation checks still route through `tsx src/backend/platform/context-pack/cli.ts --pack platform-default --mode status-only`.
- Materialized plan flow remains on the same helper with `--write-plan`.
- Structured bootstrap flow stays on the activation helper contract via `--bootstrap-repo-root` and `--bootstrap-answers-file`.

The desktop shell must not reimplement manual overlay setup logic or bypass the approved activation and workspace-sync wrappers.

## Planner-first follow-up flow

- Planner compose remains the only writable intake surface for new work.
- After closeout, completed-task follow-up starts by re-entering the planner from the compact completed-task prompt in the planning workspace.
- The closed parent task remains read-only while the new child task is drafted, previewed, and optionally submitted through the approved follow-up helper.

## Planner transport architecture

- The desktop planner now runs through a broker-owned JSONL Copilot transport in Electron main.
- The canonical stream contract is typed planner events, not PTY terminal scraping or terminal-chrome filtering.
- Session continuity uses Copilot `sessionId` resume semantics instead of PTY-driven stdin bridging.
- Observability exposes only bounded broker metadata such as new-vs-resumed turns, success-vs-failure, queue depth, and whether planner content was observed.

## Slice guardrails

- Renderer access remains file-system blind behind preload and Electron main
- Planner compose remains the only writable task-entry surface
- Retrospective completion stays repo-artifact-driven and fail-closed in the
  shared workflow-policy/runtime helpers rather than moving into desktop-only UI
  state
- Task submission continues to route through approved helper seams only
- Root onboarding and operating-model docs should not be broadened until the runtime flow is stable enough to avoid churn
