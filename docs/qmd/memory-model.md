# QMD Memory Model

_Last updated: March 7, 2026_

## Purpose

This document defines how QMD should store persistent engineering memory for the agentic platform as the system matures.

QMD memory is a retrieval and note-taking layer, not the system of record.

## Context-Pack Index Contract

Within an active context pack, QMD memory should expose one explicit top-level
index layer so the scoped memory estate is predictable to operators and runtime
components.

Recommended top-level shape:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/context-pack-index.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/repositories.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/tasks.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/lineage.json`

Retrospective memory adds a parallel shared root outside context-pack scopes:

- `AgentWorkSpace/qmd/global/retrospectives/history/{year}/{task-id}.md`
- `AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md`
- `AgentWorkSpace/qmd/global/retrospectives/indexes/history.json`
- `AgentWorkSpace/qmd/global/retrospectives/indexes/action-items.json`
- `AgentWorkSpace/qmd/global/retrospectives/indexes/themes.json`

These top-level indexes are derived navigation aids only.
They must resolve back to canonical QMD records rather than acting as competing
sources of truth.

## Ground Truth Rule

When these sources disagree, resolve conflicts in this order:

1. current checked-out repository state
2. required workflow artifacts under `AgentWorkSpace/handoffs/` and `AgentWorkSpace/ImplementationSteps/`
3. validated QMD memory entries
4. older summaries or stale derived notes

QMD accelerates recall. It does not override source code, current docs, or required handoff artifacts.

## Default Retrieval and Write Boundary

Unless a task explicitly authorizes broader lookup, QMD reads and writes should stay inside the active context pack.

- Default write target: the active `context_pack_id` and its configured `qmd_scope`
- Default read target: records in the same `context_pack_id` and `qmd_scope`
- Cross-context-pack retrieval: explicit and auditable rather than implicit
- Platform-core work with no active overlay: use the shared core scope only

This prevents one repository estate from polluting retrieval for another.

## Retrieval Ranking Within a Scope

Within a valid context-pack scope, rank sources in this order:

1. current checked-out repo state
2. required active handoff artifacts
3. reviewed or approved canonical summaries with fresh provenance
4. fresh operational notes and reusable task learnings
5. temporary working notes that are still within their review window
6. invalidated or stale records only when explicitly requested for history

Records with `freshness_status=invalidated` should never win default retrieval over fresh repo artifacts or reviewed notes.

## What QMD Should Store

QMD is a good place for persistent, reusable engineering notes such as:

- architecture summaries
- service and repo relationship maps
- ownership maps
- integration contracts and dependency notes
- operational runbooks
- recurring failure modes and troubleshooting notes
- test strategy notes
- implementation learnings from completed tasks
- archived task records
- glossary and domain terminology
- retrieval-friendly summaries of large code areas

When context packs are active, those notes should be stored under the QMD directory for that context pack instead of being mixed into a single shared memory area.

Only live indexing, archival, or deliberate note-writing should create retrievable QMD memory. Planning artifacts alone do not count as live memory.

## Task Memory Management Rule

Task memory should remain task-centric.

This means:

- a completed task is stored once as a canonical task archive record
- a completed task may also store one companion `task-retrospective` record in
  the active context-pack scope so the full retrospective meeting, agent
  contributions, and action items remain retrievable
- repository-estate memory is stored separately under repo and context-pack
  filing areas
- lineage and repo-oriented discovery should use metadata and derived indexes
  rather than duplicated nested repo trees under each task

QMD should not treat each archived task as a miniature repository snapshot.

Avoid patterns such as:

- `archive/tasks/{year}/{task-id}/backend/...`
- `archive/tasks/{year}/{task-id}/frontend/...`
- per-task duplicated repo subtrees or repo snapshots

Those patterns blur the boundary between task memory and repository memory and
create avoidable drift.

Retrospective-specific storage should follow the implemented split:

- context-pack-scoped per-task retrospective archives at
  `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`
  plus `.record.json`
- global shared retrospective history and synthesis at
  `AgentWorkSpace/qmd/global/retrospectives/`

The global retrospective root is shared learning memory, not the default write
target for ordinary context-pack task archives.

## What QMD Should Not Store as Authority

Avoid using QMD as the sole home for:

- current workflow state that belongs in `AgentWorkSpace/handoffs/`
- unverified guesses or speculative explanations
- secrets or credentials
- final truth that conflicts with current repo state
- unresolved decisions without clear labels
- raw chat transcripts treated as durable engineering knowledge

## Approved Memory Buckets

## 1. Canonical Summaries

Use for stable, reviewed summaries of:

- bounded contexts
- services
- major subsystems
- public API surfaces
- database access patterns

Requirements:

- reviewed by a human or verified against source
- linked to source paths or docs
- stamped with commit SHA or version marker

## 2. Operational Notes

Use for:

- runbooks
- rollout notes
- troubleshooting steps
- incident learnings
- environment-specific cautions

Requirements:

- label environment relevance clearly
- include update timestamp
- include owner or owning team when known

## 3. Task Learnings

Use for reusable lessons from completed tasks, such as:

- migration gotchas
- common integration pitfalls
- repeated QA findings
- patterns that reduced implementation errors

Requirements:

- reference the originating task or slice
- mark whether the learning is reusable or task-specific
- avoid duplicating the final summary verbatim if the handoff artifact already covers it better

## 4. Task Archive Records

Use for completed-task filing so the platform can learn from prior work.

Each archive record should answer:

- what task was completed?
- what repo or repos were touched?
- what slices were executed?
- what key decisions were made?
- what tests were run?
- what issues or defects were found and resolved?
- what follow-up work remains?

Minimum fields:

- task ID or external ticket ID
- task title
- completion date
- primary repo
- related repos
- affected service or bounded context
- slice list
- summary of implementation
- links to `AgentWorkSpace/handoffs/final-summary.md`, `AgentWorkSpace/handoffs/tests.md`, and any relevant issue artifacts
- tags for topic, subsystem, and task type
- outcome status
- follow-up backlog references

Canonical task archives should remain in one task-centric location, while repo,
parent, root-lineage, and context-pack discovery should be handled by derived
indexes.

## 5. Temporary Working Notes

Use for short-lived notes during active implementation, such as:

- areas under investigation
- incomplete codebase maps
- candidate file lists
- hypotheses awaiting confirmation

Requirements:

- clearly marked as temporary
- expiration or review date required
- must be promoted, corrected, or deleted later
- should not be returned ahead of reviewed summaries unless the task explicitly asks for active investigation state

## 6. Invalidated or Stale Notes Archive

Use for notes that were once useful but are no longer current.

Requirements:

- keep the reason for invalidation
- keep the date invalidated
- point to the newer source or replacement note when possible

## Promotion and Invalidation Rules

- `working-note` records must be promoted to a durable category, corrected, or deleted by their expiration window.
- `canonical-summary` records should move to `needs-review` when their cited repo state or source documents materially change.
- `task-learning` records should be invalidated or superseded when the originating subsystem changes enough to make the lesson misleading.
- `task-archive` records remain durable history, but their freshness may still degrade if linked operating conventions change.
- Invalidated records should remain retrievable for audit history only, not as default implementation guidance.

## Required Metadata for Every Note

Every stored QMD note should carry:

- title
- repo name
- source path or source document reference
- bounded context or service name
- artifact type
- owner or owning team when known
- source commit SHA, release tag, or equivalent version marker
- created timestamp
- last reviewed timestamp
- freshness status
- confidence or review status

These note-level fields should align with the normalized schema in `docs/qmd/metadata-schema.md` so notes, repo filings, and task archives can be queried consistently.

For Slice 08A, the minimum durable lifecycle fields are:

- `created_at`
- `indexed_at`
- `updated_at`
- `freshness_status`
- `review_status`
- `provenance_type`
- `provenance_sources`

Optional but recommended:

- related repos
- related MCP service
- related task or slice ID
- archive classification for completed-task records
- tags for retrieval partitions
- context pack identifier
- QMD scope root

For derived index records, also recommend:

- index generation timestamp
- canonical record path references
- canonical record ID references
- index scope type such as `context-pack`, `repo`, `root-lineage`, or
  `parent-children`

## Freshness Rules

At minimum, notes should support these states:

- `fresh`
- `needs-review`
- `stale`
- `invalidated`

Suggested review policy:

- hot code paths: review daily or on merge to default branch
- normal application areas: review on merge to main
- architecture summaries: review when source docs or core design changes
- task learnings: review when related subsystems materially change
- archived task records: review when their referenced repos or operating model change materially
- temporary notes: review quickly and expire aggressively

## Provenance Rules

Every note must answer:

- where did this information come from?
- when was it derived?
- what repo or service does it describe?
- what source revision was used?
- who reviewed it, if anyone?

If a note cannot answer those questions, it should not be treated as reliable memory.

## Workflow Boundary Rules

The following must remain in repo artifacts, not only QMD:

- active task definition
- implementation specification for the current task
- active slice assignments
- test execution record for current work
- active error or QA issue routing
- final task summary

QMD may index or summarize those artifacts, but it must not become their only storage location.

The following bootstrap artifacts must also remain outside live memory unless intentionally archived:

- `AgentWorkSpace/qmd/repo-sources.json`
- dry-run seeding plans
- local onboarding checklists describing future seed targets

## Child-Task Carry-Forward Boundary

Parent-task archive retrieval is a special case of scoped QMD usage.

For child tasks:

- use the declared `parent_qmd_scope` as the retrieval boundary
- prefer exact parent archive references over broad similarity search
- return a compact carry-forward summary rather than a raw archive dump
- treat the carry-forward summary as background context only

For non-child tasks:

- do not inject unrelated parent-task archives by default

If a carry-forward summary conflicts with current repo state or active handoff artifacts, current repo state and active handoffs still win.

## Child-Task Lineage Boundary

Lineage metadata improves retrieval, but it does not widen the default memory boundary.

- Immediate-parent retrieval should stay inside the declared `parent_qmd_scope`.
- Root-lineage retrieval should stay inside the active archive record's `qmd_scope` unless an operator explicitly requests a broader search.
- Sibling or descendant follow-ups discovered through shared lineage must still report provenance and freshness per record.
- Reused lineage history must remain auditable back to explicit archive records rather than inferred solely from human-written backlog prose.

## Completed Task Filing System

Every completed task should be filed into QMD as a retrievable archive record.

Recommended partition shape:

- `archive/tasks/{year}/{task-id}`

Recommended scoped roots:

- `AgentWorkSpace/qmd/platform-core/...` for generic platform work
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/...` for target-specific work

Recommended secondary tags:

- service or bounded context
- task type
- language or framework
- risk area
- incident or bugfix marker
- migration marker

Recommended archive sources:

- `AgentWorkSpace/handoffs/professional-task.md`
- `AgentWorkSpace/handoffs/implementation-spec.md` for the standard path
- `AgentWorkSpace/ImplementationSteps/sliceN.md`
- `AgentWorkSpace/handoffs/tests.md`
- `AgentWorkSpace/handoffs/issues.md`
- `AgentWorkSpace/handoffs/final-summary.md`

The archive record should summarize those artifacts, link back to them, and preserve enough metadata for future retrieval without replacing the original files.

If a task belongs to a specific context pack, file it only into that context pack's QMD root. Do not default to retrieving task memory from other context packs unless broader scope is explicitly requested.

## First-Run Bootstrap Boundary

For a newly onboarded context pack, treat dry-run seeding output as planning metadata, not as already-available memory.

That means:

- `AgentWorkSpace/qmd/repo-sources.json` defines what should be seeded
- the dry-run seed plan defines where records should go
- only completed live filing creates retrievable QMD memory
- no automatic `working-note`, `canonical-summary`, or `repo-artifact` record should exist solely because a dry-run plan was generated
- if bootstrap evidence is stored later, it should be archived as supporting history with explicit provenance rather than masquerading as current repo memory

Agents should not assume that a repo is already represented in QMD merely because it appears in the dry-run plan.

## Recommended Retrieval Order

When answering a task:

1. inspect current repo state
2. read required handoff artifacts
3. consult QMD structural and canonical summaries
4. consult QMD operational notes and task learnings
5. read raw source only where needed for precision

## Repository Estate Filing Model

In addition to note types and task archives, QMD should maintain a filing system for the overall distributed repository estate.

At minimum, every indexed repository artifact should be classifiable along these dimensions:

- system layer: `backend`, `frontend`, `documents`, or `shared`
- programming language
- repository
- service or bounded context
- artifact type

This filing model is intended to support queries such as:

- show backend repos related to a capability
- find frontend code in TypeScript
- find all Python services in a bounded context
- find documents related to a backend service

The physical source path remains canonical. Filing dimensions are retrieval metadata, not duplicate sources of truth.

When a context pack is active, repo-context retrieval should first stay inside that context pack's QMD root. Cross-context-pack retrieval should be explicit rather than implicit.

## Minimum Live-Memory Gate

Before a record is treated as live QMD memory, it should have all of the following:

- a valid schema-conformant metadata payload
- explicit `context_pack_id` and `qmd_scope`
- one or more provenance sources
- lifecycle timestamps
- a freshness state

If any of those are missing, the platform should treat the content as incomplete and avoid returning it as trusted memory.

## Safety and Governance Notes

- Never store secrets in QMD.
- Never allow stale notes to silently outrank current code.
- Prefer concise, high-signal notes over exhaustive prose.
- Archive or invalidate low-confidence notes quickly.
- Treat QMD like an engineering notebook with citations, not a magical memory bucket.

## Example Future Partitions

Possible partition groups:

- `canonical/architecture/*`
- `canonical/services/*`
- `estate/backend/*`
- `estate/frontend/*`
- `estate/documents/*`
- `estate/languages/*`
- `operational/runbooks/*`
- `operational/incidents/*`
- `learnings/tasks/*`
- `working/temporary/*`
- `archive/invalidated/*`

## Implementation Guidance

As the platform matures, the Slice 08 live-seeding executor work should ensure the repo-context MCP service can:

- read and retrieve QMD notes by partition and metadata
- resolve the active context pack and restrict default QMD retrieval to that context pack's directory
- show provenance and freshness on retrieval
- deprioritize stale or invalidated notes
- explain why a note was returned
- fall back to current repo state when conflicts exist
