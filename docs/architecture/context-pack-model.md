# Context Pack Model

_Last updated: March 7, 2026_

## Purpose

This document defines how to keep the core agentic platform generic while allowing organization-specific guidance, repo inventories, and workflow overlays to live outside the core platform repo.

## Core Idea

Split the system into two layers:

1. **Core platform repo**
   - generic workflow
   - generic MCP wiring patterns
   - generic QMD schema and filing rules
   - generic prompts and role instructions

2. **Context pack repo or folder**
   - organization-specific repo inventory
   - ownership maps
   - domain terminology
   - instruction overlays
   - repo tags and bounded-context maps
   - target-specific MCP guidance

The core platform should not hardcode one organization's names, repos, or conventions unless they are only examples.

## Recommended Separation

### Core platform repo

Use the current repo for:

- reusable workflow design
- generic handoff templates
- generic implementation-slice model
- generic Docker and MCP patterns
- generic QMD metadata schema

### External context pack

Store target-specific material in a separate repo or adjacent folder, for example:

- `agentic-context-packs/<organization>/`
- `platform-contexts/<organization>/`
- a standalone repo such as `copilot-agentic-contexts`

Example structure:

```text
context-packs/
└─ sample-org/
   ├─ repo-inventory.md
   ├─ ownership-map.md
   ├─ domain-glossary.md
   ├─ repo-tags.json
   ├─ instruction-overlays/
   │  ├─ global.overlay.md
   │  ├─ product-manager.overlay.md
   │  └─ software-engineer.overlay.md
   └─ qmd/
      ├─ service-map.md
      ├─ repo-classification.json
      ├─ repo-sources.json
      └─ bootstrap/
```

## How the Platform Uses a Context Pack

When a task targets a specific organization or repo estate:

1. load the generic platform instructions first
2. load the selected context pack second
3. use the context pack only as an overlay, not as a replacement for core workflow rules
4. index the target repos using the generic QMD schema plus context-pack metadata
5. read and write QMD memory only within the QMD directory assigned to that active context pack unless broader scope is explicitly requested

Before first-run live seeding, the platform should activate the context pack through `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack` and generate a dry-run plan from the context pack's `qmd/repo-sources.json` when needed so multi-repo filing targets can be reviewed before QMD is populated.

For a brand-new project or distributed estate with no context pack yet, the activation seam can now bootstrap the context pack structure, create an initial `qmd/repo-sources.json`, and run the first live seed automatically:

`tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/new-context-pack --bootstrap-repo-root /path/to/project-repo`

Before that bootstrap writes anything, the platform now gates creation through a structured questionnaire. The bootstrap flow collects or requires answers for:

- `context_pack_id`
- project or estate display name
- repository count in scope
- per-repo identity and filing metadata for each repo, including:
   - repository display name
   - repository ID
   - repository owner or org
   - local repo root
   - primary system layer
   - declared languages
   - artifact roots to scan
   - document paths to scan
   - bounded context
   - service name

Interactive operators can answer those prompts live, including repeated per-repo entries for distributed estates. Non-interactive or repeatable setup can pass a JSON file through `--bootstrap-answers-file`, and the normalized answers are recorded under `qmd/bootstrap/bootstrap-answers.json` for auditability.

## Workspace activation and focus behavior

When the platform activates a context pack for active development, it may also
sync the active VS Code workspace so the relevant repo slice becomes directly
editable while the platform repo remains the control plane.

Current behavior:

- workspace changes flow through the managed activation and workspace-sync
   seams rather than ad hoc editor edits
- preview, apply, clear, and reconcile operations replace only
   context-pack-managed folders and preserve operator-owned folders
- workspace sync state is recorded in
   `.platform-state/workspace-context-sync.json`

Focus and scope model:

- distributed estates use `focused` scope and attach only the selected
   repo or selected repo subset
- monolith estates keep the repo attached but still use focused selections to
   narrow retrieval, indexing, and operator attention
- both distributed and monolith estates support multi-select focus

Operational guardrails:

- workspace changes should be previewable before apply
- activation failures and managed-folder drift should remain visible to the
   operator
- restore or reconcile actions should reuse the same approved workspace-sync
   seam rather than introduce a second mutation path

If the desktop shell is used, its persistent context-pack sidebar is an
operator surface for selecting a context pack, focus targets, scope mode, and
drift or reconcile actions. Backend activation and workspace-sync helpers
remain the authority for path validation, ownership, and atomic writes.

## What Belongs in a Context Pack

- organization name and repo inventory
- repo classification tags
- service and bounded-context maps
- internal dependency relationships
- domain-specific terminology
- target-specific coding conventions
- role instruction overlays as needed, including Planning Agent (Lily),
  Product Manager (Alice), SWE (Dalton), and QA and Closeout (Ron)
- target-specific MCP access guidance

## What Should Stay Out of the Core Repo

- organization-specific repo names in normative guidance
- one company's ownership map
- target-specific glossary terms as core assumptions
- hardcoded org URLs in generic platform docs
- target-specific credential assumptions

## QMD Interaction Model

The core platform owns:

- normalized QMD schema
- filing dimensions
- archive rules
- provenance and freshness requirements

The context pack contributes:

- repo classification data
- bounded-context labels
- service aliases
- owner-team mappings
- additional tags for retrieval
- repository source roots for first-run dry-run QMD seeding

## Context-Pack QMD Scoping

Each context pack should have its own QMD root, for example:

- `AgentWorkSpace/qmd/context-packs/sample-org/`
- `AgentWorkSpace/qmd/context-packs/sample-org-2/`

Use `AgentWorkSpace/qmd/platform-core/` for generic platform memory that is not specific to one target estate.

When the platform is actively working on a specific context pack:

1. resolve the active `context_pack_id`
2. use only that context pack's QMD root for default reads and writes
3. keep archived tasks, per-task retrospective archives, canonical summaries,
    repo filings, and operational notes inside that scope
4. avoid pulling memory from another context pack unless the operator explicitly asks for cross-context comparison

This prevents unrelated target-estate memory from contaminating retrieval.

Retrospective boundary rules:

- per-task retrospective archives stay inside the active context-pack scope at
   `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`
   with a `.record.json` sidecar that preserves the full meeting and agent
   contributions
- shared cross-task retrospective memory is intentionally not stored under any
   context-pack root; it lives in the dedicated global root
   `AgentWorkSpace/qmd/global/retrospectives`
- operators should treat that global retrospective root as shared learning
   memory rather than as a replacement for context-pack-scoped task archives

Context-pack conventions memory rules:

- when the platform derives a pack-wide conventions memo from real repository
   inputs, it should store that guidance at
   `AgentWorkSpace/qmd/context-packs/{context-pack-id}/canonical/context-pack/codebase-conventions.md`
   with a `.record.json` sidecar beside it
- that memo is context-pack-scoped canonical guidance memory for later coding
   work, not a bootstrap questionnaire answer or other control-plane input
- a brand-new or not-yet-seeded pack may remain in a deferred state with no
   conventions artifact yet; the platform should not create an empty placeholder
   memo before real code has been analyzed

## First-Run QMD Dry Run

For a newly onboarded context pack, add `qmd/repo-sources.json` to declare:

- repo identities
- possible local checkout roots
- system-layer classifications
- bounded-context mappings
- initial artifact and document roots to scan

At minimum, the manifest should provide:

- `context_pack_id`
- `qmd_scope_root`
- one or more repository entries with `repo_id`, `repo_name`, and `local_paths`

The platform can then generate a first-run dry-run plan through the canonical activation seam with `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --write-plan`.

If the operator is onboarding a completely new project or distributed multi-repo estate, the same activation seam can bootstrap the initial context-pack structure and seed it on first run with `--bootstrap-repo-root`. That path is intentionally additive; operators can refine the generated manifest later as the repo estate expands.

The generated plan should be written to the path configured by `CONTEXT_PACK_QMD_DRY_RUN_PLAN_FILE`, which defaults to `qmd/bootstrap/seed-plan.json` inside the context pack.

That plan is where the operator confirms that:

- every repo in the distributed platform is actually represented
- the local workstation can resolve the expected repo roots
- the proposed QMD paths match the intended retrieval partitions
- any blocked repositories or classification warnings are understood before live seeding

Only after that review should the live QMD seed execution proceed.

## MCP Guidance

The context pack may include target-specific MCP guidance such as:

- target organization names and repository estates
- GitHub visibility requirements for that organization
- repo-context roots or multi-repo index boundaries
- DB environment selection rules or readonly access expectations
- approved documentation domains or web allowlists for targeted internet research
- org-managed registry overrides if the target estate requires them

The context pack should not change the platform's core distinction between:

- host-side tooling using `localhost` MCP endpoints
- containerized consumers using Docker service DNS names

## Benefits

- the platform remains reusable
- a new organization can be onboarded by adding a new context pack
- target-specific content can evolve independently
- less risk of contaminating generic instructions with one repo estate's assumptions

## Practical Recommendation

For your current use case, keep this repo generic and create a separate context-pack structure for the target repository estate. Then point the platform to that structure whenever the active task is for that target.
