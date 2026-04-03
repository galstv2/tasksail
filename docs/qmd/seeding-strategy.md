# QMD Seeding Strategy

_Last updated: March 7, 2026_

## Purpose

This document defines how the platform should perform first-run and refresh seeding for QMD, especially when one context pack spans multiple repositories and multiple local checkout roots.

## Core Requirement

The first time a new context pack is activated, the platform should not immediately write large volumes of derived memory into QMD.

Instead it should:

1. resolve the active context pack
2. load a repository-source manifest from that context pack
3. generate a dry-run filing plan for QMD
4. verify repo roots and target partitions repo by repo
5. execute the actual seeding only after the dry run is reviewed and accepted

This keeps first-run retrieval trustworthy and prevents low-signal or mis-filed memory from polluting the active QMD scope.

## Why a Dry Run Is Required

Without a dry run, first-run indexing can fail in hard-to-see ways:

- wrong local checkout root for one repository
- a distributed platform spread across more than one repo but seeded as if it were only one
- documents filed into the wrong system-layer partition
- summaries created before the operator confirms which repos are in scope
- stale or partial local clones producing misleading memory

The dry run is the contract that makes multi-repo onboarding auditable.

## Context-Pack Manifest Convention

Use `qmd/repo-sources.json` inside the active context pack to describe the repository estate that should seed into that context pack's QMD scope.

### Required top-level fields

| Field | Required | Notes |
|---|---|---|
| `context_pack_id` | yes | Stable identifier for retrieval and filing scope |
| `qmd_scope_root` | yes | Expected scoped QMD root for the context pack |
| `repositories` | yes | Non-empty list of repo declarations |

### Required repository fields

Every entry in `repositories` should declare:

| Field | Required | Notes |
|---|---|---|
| `repo_id` | yes | Stable filing key for the repository |
| `repo_name` | yes | Human-readable canonical repo name |
| `local_paths` | yes | One or more workstation path candidates |
| `system_layer` | recommended | Defaults to `shared` if omitted or unknown |
| `languages` | recommended | Empty values should trigger review warnings |
| `bounded_context` | recommended | Important for multi-repo retrieval quality |
| `artifact_roots` | recommended | Limits scan scope to high-signal paths |
| `document_paths` | recommended | Keeps bootstrap doc filing explicit |
| `tags` | optional | Additional retrieval metadata |

### Manifest validation expectations

The dry-run planner should fail fast when:

- `repositories` is missing or empty
- a repo entry has no `repo_id` or `repo_name`
- a repo entry has no `local_paths`

The dry-run planner should warn, rather than fail, when:

- no declared local path currently exists on the workstation
- no languages are declared
- no bounded context is declared
- artifact or document roots are broad enough to require review

Suggested shape:

```json
{
  "context_pack_id": "sample-org",
  "qmd_scope_root": "qmd/context-packs/sample-org",
  "repositories": [
    {
      "repo_id": "billing-api",
      "repo_name": "billing-api",
      "owner": "sample-org",
      "local_paths": [
        "../repos/billing-api",
        "/Volumes/worktrees/sample-org/billing-api"
      ],
      "system_layer": "backend",
      "languages": ["python"],
      "bounded_context": "billing",
      "artifact_roots": ["src", "tests", "docs"],
      "document_paths": ["README.md", "docs"],
      "tags": ["service:billing", "owner:payments-platform"]
    }
  ]
}
```

## First-Run Workflow

Recommended first-run sequence for a new context pack:

1. run `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack`
2. if activation reports a missing dry-run plan, run `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --write-plan`
3. review blocked repos, missing local roots, and proposed QMD target paths
4. confirm that repo classifications and bounded-context assignments are correct
5. only then run the live repo-context or QMD seed flow repo by repo

Recommended bootstrap sequence for a brand-new project or distributed estate with no context pack yet:

1. run `tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack --bootstrap-repo-root /path/to/project-repo`
2. answer the structured bootstrap questionnaire, or provide `--bootstrap-answers-file /path/to/bootstrap-answers.json`
3. let activation write `qmd/bootstrap/bootstrap-answers.json`, generate `qmd/repo-sources.json`, and perform the first live seed automatically
4. refine the generated manifest later if the project expands beyond the initial repo inventory captured during bootstrap

The dry-run plan should be treated as a checklist, not a substitute for the real seed execution.

The lower-level `src/backend/scripts/python/plan-qmd-seeding.py` helper remains available for advanced or surgical troubleshooting, but the default operator path should go through the activation command so readiness status and next-step messaging stay consistent.

## Dry-Run Output Requirements

The dry-run planner should identify, at minimum:

- plan type and plan generation metadata
- active `context_pack_id`
- manifest path and manifest version when available
- resolved QMD scope root
- every repository in scope
- every configured local root per repository
- every existing local root per repository
- missing local roots that block seeding
- proposed scan targets
- proposed QMD filing targets
- warnings that require operator review before live seeding

Recommended top-level dry-run summary fields:

- `repository_count`
- `ready_count`
- `blocked_count`
- `warning_count`
- `next_steps`
- `proposed_index_outputs`

Recommended per-repo dry-run fields:

- repo identity
- owner
- system layer
- bounded context
- languages
- tags
- existing roots
- missing roots
- scan targets
- QMD targets
- readiness status
- warnings

## Recommended QMD Filing Targets for Bootstrap

For each repository, the initial plan should include targets such as:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/context-pack-index.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/repositories.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/tasks.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/lineage.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/canonical/repos/{repo}/repo-summary.md`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/canonical/contexts/{bounded-context}/repo-{repo}.md`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/operational/bootstrap/{repo}/initial-index.md`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/estate/{layer}/{repo}/`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/estate/languages/{language}/{repo}/`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/estate/documents/{repo}/`

When canonical task archives already exist in the active scope, compatible
derived task and lineage indexes may also be refreshed, such as:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/indexes/by-repo/{repo}/tasks.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/indexes/by-root-task/{root-task-id}/lineage.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/indexes/by-parent-task/{parent-task-id}/children.json`

The exact files may evolve, but the filing boundaries should remain stable and retrieval-friendly.

## Multi-Repo Guidance

When a platform spans several repositories:

- seed each repository independently
- keep one canonical repo identity per filing record
- use bounded-context and service tags to connect related repos
- do not collapse multiple repos into one synthetic source path
- allow more than one local checkout path so workstations with different layouts can still use the same context pack

## Surgical Seeding Expectations

The live seed flow should operate surgically:

- start with architecture docs, onboarding docs, runbooks, and top-level service maps
- add curated canonical summaries for high-value subsystems
- add targeted code-area summaries only after structural metadata is established

## Live Executor Contract

Slice 08D adds the live execution entrypoint via the platform seeding service.

The live executor should:

1. resolve the active context pack
2. prefer an approved dry-run plan when one exists
3. fall back to the manifest only when explicitly allowed
4. seed repositories one by one instead of doing one opaque bulk write
5. persist scoped QMD records plus a run report for each execution
6. refresh top-level context-pack and repository indexes after canonical seed output is written

Recommended command:

- `tsx src/backend/platform/container/cli.ts seed -- --context-pack-dir /path/to/context-pack`

Recommended plan mode defaults:

- `prefer-plan` for normal operator use
- `require-plan` for stricter guarded environments
- `manifest-only` for local development or fixture-based testing

## Refresh and Invalidation Expectations

Live refresh runs should preserve durable history while preventing misleading stale memory.

At minimum, the live executor should:

- refresh repo summaries and bootstrap notes on every successful repo seed
- preserve `created_at` for records that still represent the same canonical source path
- update `indexed_at` and `updated_at` on refreshed records
- invalidate prior artifact records when a previously seeded source is no longer observed in the latest refresh
- write partial-failure results clearly when one repo is blocked or errors while others continue safely
- refresh top-level context-pack and repository indexes after successful canonical writes
- refresh compatible top-level task and lineage indexes when canonical task archives already exist and the refresh is safe to compute incrementally

## Live Run Reports

Every live seed execution should emit a run report under the scoped QMD root, for example:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/operational/bootstrap/seed-runs/seed-run-<timestamp>.json`

That report should record:

- whether input came from the approved dry-run plan or directly from the manifest
- seeded, blocked, and error repo counts
- invalidated record counts
- per-repo warnings, errors, and output paths
- index output paths or index refresh summary when applicable

This report is operational evidence of the live run, distinct from the dry-run plan that approved it.
- avoid flooding QMD with vendored, generated, or low-signal files
- preserve provenance, source repo, source path, and review timestamps for every persisted record

## Refresh Policy

After initial bootstrap, use incremental refresh rather than full reseed whenever possible.

Recommended policy:

- refresh architecture and onboarding docs when they change materially
- refresh hot code-path summaries on merge to main
- refresh operational notes when incidents or deployment behavior changes
- invalidate stale summaries when source repos move or split

## Validation Rules

If an active context pack is configured, local validation should warn when `qmd/repo-sources.json` is missing.

This ensures the platform does not claim to support first-run multi-repo QMD seeding without a declared inventory of repository sources.

Local validation should also warn when:

- the configured dry-run plan file does not exist yet for a newly onboarded context pack
- the active context pack path exists but the manifest path points nowhere
- the manifest exists but produces blocked repositories in the dry-run output

## Setup and Onboarding Contract

At minimum, operator-facing setup flows should do all of the following for a new context pack:

1. sync context-pack MCP overlays
2. confirm `qmd/repo-sources.json` exists
3. generate a dry-run plan with `src/backend/scripts/python/plan-qmd-seeding.py`
4. review blocked repositories and warnings
5. only then treat the context pack as ready for live QMD seeding

The dry-run plan remains preflight metadata only; it is not evidence that live QMD coverage already exists.
