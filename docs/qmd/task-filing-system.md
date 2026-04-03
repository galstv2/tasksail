# QMD Task Filing System

_Last updated: March 7, 2026_

## Purpose

This document defines how the platform should file completed tasks into QMD so prior work can be retrieved later for implementation guidance, troubleshooting, and pattern reuse.

## Goal

The filing system should let the platform answer questions like:

- Have we solved a similar task before?
- Which repo or service was changed last time?
- What slices were used?
- What tests were required?
- What defects or QA findings came up repeatedly?
- What follow-up items were left behind?

## Filing Trigger

Create a QMD task archive record when:

- the Documentation role completes `AgentWorkSpace/handoffs/final-summary.md`
- the workflow team completes `AgentWorkSpace/handoffs/retrospective-input.md`
- SDET results are recorded in `AgentWorkSpace/handoffs/tests.md`
- any open `AgentWorkSpace/handoffs/errors.md` or `AgentWorkSpace/handoffs/issues.md` entries for the task are either resolved or explicitly carried forward

## Source Artifacts

Each filed task record should be derived from these artifacts when available:

- `AgentWorkSpace/handoffs/professional-task.md`
- `AgentWorkSpace/handoffs/implementation-spec.md` for the standard path
- `AgentWorkSpace/ImplementationSteps/sliceN.md`
- `AgentWorkSpace/handoffs/parallel-ok.md`
- `AgentWorkSpace/handoffs/tests.md`
- `AgentWorkSpace/handoffs/errors.md`
- `AgentWorkSpace/handoffs/issues.md`
- `AgentWorkSpace/handoffs/final-summary.md`
- `AgentWorkSpace/handoffs/retrospective-input.md`

Archive records should preserve which upstream path was used so future retrieval can distinguish Architect-reviewed tasks from intentionally fast-pathed tasks.

The retrospective artifact is a required closeout companion, not an optional
note. Closeout, archival, queue advancement, and follow-up creation should all
fail closed when the retrospective is missing or incomplete.

## Required Filing Metadata

Every archived task should include:

- task ID
- root task ID when the task belongs to a follow-up lineage
- parent task ID when the task is a child task
- task title
- completion timestamp
- workflow status
- primary repo
- related repos
- affected services or bounded contexts
- owner roles involved
- slice IDs or slice file names
- tags
- source commit SHA or branch reference when available
- archive provenance timestamp

Recommended normalized metadata fields aligned to the QMD schema:

- `record_type=task-archive`
- `task_id`
- `root_task_id`
- `parent_task_id`
- `parent_qmd_record_id`
- `parent_qmd_scope`
- `followup_reason`
- `child_depth`
- `task_title`
- `task_type`
- `workflow_status`
- `test_status`
- `qa_status`
- `context_pack_id`
- `qmd_scope`
- `repo_name`
- `related_repos`
- `service_name`
- `bounded_context`
- `slice_ids`
- `followup_refs`
- `source_ref`
- `created_at`
- `indexed_at`
- `updated_at`
- `freshness_status`
- `review_status`
- `provenance_sources`

## Required Content Sections

Each archive record should contain:

1. task summary
2. business goal
3. implementation summary
4. touched repos, services, and files
5. slices executed and whether they ran in parallel
6. key decisions
7. tests run and outcomes
8. errors or QA issues encountered
9. final disposition
10. follow-up backlog

For follow-up-aware archives, add these lineage sections when applicable:

1. parent task relationship
2. carry-forward constraints or inherited decisions

For child-task closeout, the final summary should also distinguish:

1. inherited parent context that remained relevant
2. the child-task outcome delta that changed relative to the parent

## Required Lineage Rules

- A follow-up task should be archived as its own `task-archive`, not as an in-place mutation of the parent archive.
- Every child task should retain a direct pointer to its immediate parent task ID.
- When a task belongs to a longer chain, preserve a stable `root_task_id` so retrieval can reconstruct the lineage.
- Preserve `parent_qmd_record_id` and `parent_qmd_scope` so retrieval can prove which exact parent archive was used.
- Use `child_depth` only as an observability aid; parent and root IDs remain the authoritative lineage links.
- `followup_refs` should point forward to known child tasks when they exist.
- Lineage links are retrieval metadata and must not erase the parent archive's original completion state.

## Multi-Follow-Up Traceability Rules

- Multiple child tasks may point to the same `parent_task_id` without collapsing into one synthetic record.
- Sibling follow-ups are discovered by matching the same `parent_task_id` within the same `qmd_scope`.
- Descendant follow-ups are discovered by matching the same `root_task_id` within the same `qmd_scope`.
- `followup_refs` may list known direct children, but retrieval should still trust explicit lineage fields over a backlog-only list.
- A child task that later becomes a parent should preserve both its own direct `parent_task_id` and the shared `root_task_id`.
- When a child task closes out, its archive should retain any remaining follow-up backlog references so later descendants can start from durable lineage rather than implicit memory.
- Filing a child archive may enrich the direct parent archive's `followup_refs`, but it must not rewrite the parent's completion outcome or erase its original provenance.

## Recommended Partitioning

Primary partition:

- `archive/tasks/{year}/{task-id}`

Scoped roots:

- `AgentWorkSpace/qmd/platform-core/archive/tasks/{year}/{task-id}` for generic platform tasks
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/tasks/{year}/{task-id}` for target-specific tasks

Companion retrospective paths:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md.record.json`
- `AgentWorkSpace/qmd/global/retrospectives/history/{year}/{task-id}.md`
- `AgentWorkSpace/qmd/global/retrospectives/history/{year}/{task-id}.md.record.json`
- `AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md`
- `AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md.record.json`

The context-pack retrospective archive preserves the full meeting and agent
contributions for one task. The dedicated global retrospective root preserves
shared learning across completed tasks and remains distinct from ordinary
task-archive storage.

Recommended lineage-aware partition conventions:

- keep the canonical archive path task-centric rather than nesting children under parents
- use metadata, not path nesting alone, to express parent/child relationships
- preserve one canonical archive location even when the task is retrievable through lineage views
- do not embed nested repository folder trees or per-task repo snapshots beneath the canonical task archive path

## Derived Task and Lineage Index Contract

Canonical task archives should be complemented by derived indexes that improve
discovery without changing canonical task location.

Recommended derived index paths:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/tasks.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/lineage.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/indexes/by-repo/{repo}/tasks.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/indexes/by-root-task/{root-task-id}/lineage.json`
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/archive/indexes/by-parent-task/{parent-task-id}/children.json`

Use these derived indexes to support repo, context-pack, and lineage retrieval.
Do not treat them as new canonical task locations.

Secondary retrieval tags:

- `service:<name>`
- `context:<bounded-context>`
- `type:feature|bugfix|migration|refactor|infra|docs`
- `risk:security|data|integration|performance`
- `lang:<language>`
- `framework:<framework>`
- `context-pack:<context-pack-id|platform-core>`
- `workflow-path:standard|small-task-fast-path`
- `lineage:root|child`
- `parent-task:<task-id>` when applicable
- `root-task:<task-id>` when applicable
- `followup:true` when the task is not the root task

## Primary Retrieval Keys

The task filing model should support predictable lookup by:

- `task_id`
- `root_task_id`
- `parent_task_id`
- `parent_qmd_record_id`
- `parent_qmd_scope`
- `repo_name`
- `service_name`
- `bounded_context`
- `task_type`
- `workflow_status`
- `qa_status`
- `test_status`
- `context_pack_id`

Retrospective retrieval should additionally support:

- task-level retrospective lookup inside the active `qmd_scope`
- shared retrospective memory lookup from the dedicated global root
- derived history, action-item, and theme indexes under
  `AgentWorkSpace/qmd/global/retrospectives/indexes/`

## Retrieval Use Cases

The platform should be able to retrieve archived tasks by:

- repo
- service
- bounded context
- workflow path
- task type
- defect pattern
- test pattern
- related incident
- keyword in implementation summary or follow-up backlog
- root task lineage or parent task lineage

Example follow-up retrieval questions:

- show all child tasks for a completed parent task
- show the latest follow-up in a task lineage
- distinguish the immediate parent of a child task from the broader root lineage history
- show sibling follow-ups for the same parent without leaking into other context packs
- find prior small-task fast-path follow-ups for a service
- find all follow-ups that carried forward unresolved QA or backlog notes

Top-level context-pack indexes should also support questions such as:

- show all archived tasks in the active context pack
- show all lineage roots in the active context pack
- find the latest archived task touching a given repo inside the active scope

## Parent Archive Retrieval for Child Tasks

When a new child task is declared, parent-task archive lookup should stay scoped and explicit.

Preferred resolution order:

1. exact `parent_qmd_record_id` inside the declared `parent_qmd_scope`
2. fallback lookup by `parent_task_id` inside the same declared scope
3. fail clearly if the lookup is missing or ambiguous

The retrieval path should not silently search across unrelated context packs or unrelated QMD scopes.

## Root-Lineage Retrieval Contract

Lineage retrieval should support two different views without mixing them up:

1. immediate-parent lookup for a specific child task
2. broader root-lineage lookup for the full follow-up tree

Immediate-parent lookup should answer questions such as:

- which archive directly preceded this child task
- which sibling follow-ups share the same parent
- which exact parent archive reference was used

Root-lineage lookup should answer questions such as:

- what follow-up chain belongs to this lineage root
- which child tasks are direct children versus deeper descendants
- what remaining backlog or risks recur across the lineage tree

Both views must stay inside the declared `qmd_scope` unless a caller deliberately broadens scope.

The broader root-lineage and context-pack lineage views should be materialized
through derived indexes rather than by relocating or nesting canonical task
archives.

## Carry-Forward Summary Contract

The parent archive lookup path should produce a compact carry-forward summary rather than dumping the raw archive.

At minimum, that summary should include:

- parent task ID and title
- root task ID
- parent archive record reference
- parent QMD scope
- business goal
- implementation summary
- touched repos and services
- slices executed when available
- key decisions
- inherited constraints
- known limitations
- follow-up backlog references

This summary is shaped for planner and handoff use. It is not a substitute for current repo state or newly created handoff artifacts.

## Child-Task Closeout Contract

At closeout time, child-task artifacts should preserve lineage explicitly enough that the completed child can later act as a parent.

That means:

- `AgentWorkSpace/handoffs/final-summary.md` should restate the child task's lineage fields
- the final summary should separate inherited parent context from newly completed child-task work
- the archived child task should keep any remaining `followup_refs`
- the child archive should be a complete standalone `task-archive`, not just a patch against the parent archive

## Repository and Canonical Identity Rules

- A task archive may reference many repositories, but it should still declare one `primary repo` for predictable partitioning.
- Additional repository impact should remain in `related_repos` and content sections rather than changing the canonical archive path.
- Archive tags may create alternate retrieval paths, but they must always resolve back to one authoritative task archive record.
- If the same task touches multiple repos inside one context pack, do not duplicate the archive into multiple canonical archive paths.
- Do not represent multi-repo task impact by copying repository folder structures into the task archive itself.

## Multi-Repo Filing Rules

For distributed platforms that span several repositories:

- keep one canonical task archive per completed task
- record the full touched-repo set in metadata and content
- allow retrieval by any touched repo through tags or indexes
- preserve the active `context_pack_id` boundary so multi-repo work is still scoped to the right estate
- do not flatten several repositories into a synthetic fake repo identity just to simplify filing

## Example Archive Shape

Suggested logical structure:

- metadata
- lineage
- source artifact links
- touched repos and services
- implementation summary
- validation summary
- issue summary
- carry-forward follow-up summary
- freshness and review state

## Ground Truth Rule

Task archive records are reusable memory, not authoritative state.

If an archived task disagrees with:

- current code
- current docs
- current handoff artifacts

then current repo state and current artifacts win.

Archived-task retrieval should default to the active context pack's QMD root. Records from other context packs should only be consulted when the operator explicitly broadens the search scope.

## Freshness and Provenance for Lineage

- Lineage metadata must inherit the same provenance discipline as the rest of the archive.
- `parent_qmd_record_id` and `parent_qmd_scope` should point to the exact parent archive actually used at child-task shaping time.
- If a parent archive is later invalidated or superseded, the child archive keeps its original lineage fields, but retrieval should surface current freshness and review status for every record it returns.
- Root-lineage retrieval should show the archived lineage as history, not as proof that every descendant remains fresh.

## Example Record Shape

Suggested high-level structure:

- metadata
- source artifact links
- implementation summary
- validation summary
- issue summary
- follow-up summary
- freshness status

## Governance

- Do not file secrets.
- Do not file unresolved speculation as fact.
- Mark low-confidence summaries clearly.
- Invalidate or refresh archive records when the underlying system changes materially.
- Preserve links back to the original task artifacts.

## Future MCP Behavior

As the platform matures, the repo-context MCP service should be able to:

- write a task archive record after successful closeout
- retrieve similar archived tasks by metadata and tags
- retrieve parent and child task archives by lineage metadata
- retrieve a single parent archive inside a declared scope and produce a compact carry-forward summary for child-task shaping
- retrieve lineage trees that distinguish immediate parent, siblings, direct children, and broader root history
- restrict default archive retrieval to the QMD root for the active context pack
- rank prior tasks by recency, repo relevance, and service overlap
- rank follow-up archives by lineage proximity as well as recency
- show provenance and freshness with every retrieved record
