# QMD Normalized Metadata Schema

_Last updated: March 7, 2026_

## Purpose

This document defines a single normalized metadata schema for QMD records so repository artifacts, persistent notes, and archived tasks can all be indexed and retrieved with the same core keys.

This schema is intentionally platform-agnostic.

It is designed to work across mixed repository estates that may include:

- backend repositories
- frontend repositories
- Python, .NET, or JavaScript/TypeScript services
- shared libraries and infrastructure repos
- repo-local and centralized documentation

If an organization has its own repo inventory, ownership map, or naming conventions, those details should live in a separate context-pack repository or folder rather than being baked into this core platform schema.

## Design Goals

- one core metadata contract for all QMD record types
- predictable filters across backend, frontend, language, repo, service, and task history
- strong provenance and freshness tracking
- no loss of canonical source-path identity
- flexible enough for code, docs, notes, and archived tasks
- clear separation between dry-run bootstrap planning artifacts and live retrievable QMD memory

## Record Types

Every QMD record should declare a `record_type`.

Allowed initial values:

- `repo-artifact`
- `canonical-summary`
- `operational-note`
- `task-learning`
- `task-archive`
- `task-retrospective`
- `global-retrospective-entry`
- `global-retrospective-memory`
- `working-note`
- `stale-archive`

## Control-Plane Inputs That Are Not QMD Records

The following artifacts are control-plane inputs for later indexing work, but they are __not__ retrievable QMD memory on their own:

- `qmd/repo-sources.json`
- generated dry-run seeding plans
- onboarding checklists that only describe what _should_ be indexed

Those files may drive later seeding, but they should not be persisted as live QMD records unless a later workflow deliberately archives them as supporting evidence with explicit provenance.

## Core Required Fields

Every QMD record should include these keys.

| Key | Type | Example | Notes |
|---|---|---|---|
| `schema_version` | string | `qmd-record/v1` | Version the contract explicitly |
| `record_id` | string | `sample-api:src/Sample.Api/Program.cs` | Stable unique identifier |
| `record_type` | enum | `repo-artifact` | See record types above |
| `title` | string | `Sample API startup entrypoint` | Human-readable label |
| `repo_name` | string | `sample-api` | Canonical repo key |
| `repo_owner` | string | `sample-org` | Org or owner |
| `source_path` | string | `src/Sample.Api/Program.cs` | Canonical repo-relative path |
| `system_layer` | enum | `backend` | `backend`, `frontend`, `documents`, `shared` |
| `artifact_type` | enum | `source-code` | See artifact taxonomy below |
| `language` | string | `csharp` | Normalized language key |
| `bounded_context` | string | `api` | Domain or context name |
| `service_name` | string | `Sample.Api` | Service, package, or subsystem |
| `tags` | string[] | `["framework:aspnetcore", "type:api"]` | Secondary retrieval tags |
| `context_pack_id` | string | `platform-core` | Active context-pack scope |
| `qmd_scope` | string | `AgentWorkSpace/qmd/context-packs/sample-org` | QMD storage root used for the record |
| `source_ref` | string | commit SHA or tag | Version marker |
| `created_at` | datetime | ISO 8601 timestamp | When the note or record was first created |
| `indexed_at` | datetime | ISO 8601 timestamp | Indexing timestamp |
| `updated_at` | datetime | ISO 8601 timestamp | Last material content update |
| `freshness_status` | enum | `fresh` | `fresh`, `needs-review`, `stale`, `invalidated` |
| `provenance_type` | enum | `source`, `derived`, `reviewed` | How the record was created |
| `provenance_sources` | string[] | paths or doc refs | What sources were used |
| `review_status` | enum | `unreviewed` | `unreviewed`, `reviewed`, `approved`, `superseded` |

## Strongly Recommended Shared Fields

These should be present whenever known.

| Key | Type | Example |
|---|---|---|
| `owner_team` | string | `platform-api` |
| `framework` | string | `aspnetcore`, `pytest`, `react` |
| `related_repos` | string[] | `["sample-contracts", "sample-logging"]` |
| `related_services` | string[] | `["gateway", "subscriptions"]` |
| `summary` | string | concise retrieval summary |
| `last_reviewed_at` | datetime | ISO 8601 timestamp |
| `confidence` | enum | `high`, `medium`, `low` |

## Conditional Required Fields

Some fields are mandatory only when specific record types or lifecycle states apply.

| Condition | Additional required fields | Why |
|---|---|---|
| `record_type=canonical-summary` | `summary_scope`, `summary_targets` | Canonical summaries must declare their coverage |
| `record_type=operational-note` | `environment_scope`, `runbook_type` | Operational notes must stay environment-aware |
| `record_type=task-learning` | `origin_task_id`, `learning_scope` | Learnings must remain traceable to source work |
| `record_type=task-archive` | `task_id`, `task_title`, `task_type`, `workflow_status`, `test_status`, `qa_status` | Archive records must be independently retrievable |
| `record_type=task-retrospective` | `task_id`, `task_title`, `workflow_status`, `retrospective_summary`, `action_items` | Retrospective records must preserve closeout learnings independently of task archives |
| `record_type=global-retrospective-entry` | `task_id`, `task_title`, `global_retrospective_root` | Shared history entries must stay traceable to one completed task |
| `record_type=global-retrospective-memory` | `global_retrospective_root`, `synthesized_from_task_ids` | Shared synthesis must remain auditable |
| `record_type=working-note` | `expires_at`, `working_status` | Temporary notes require explicit decay |
| `freshness_status=invalidated` | `invalidated_at`, `invalidated_reason` | Invalidated records must explain why they no longer apply |
| `review_status=reviewed` or `approved` | `last_reviewed_at` | Reviewed records need review evidence |
| `provenance_type=reviewed` | `last_reviewed_at` and reviewer identity in provenance sources or tags | Reviewed provenance must be auditable |

## Record-Type Extensions

Use the shared core keys above first. Add these extensions by `record_type`.

### `repo-artifact`

Additional fields:

- `path_kind` — `src`, `tests`, `docs`, `config`, `infra`, `scripts`
- `is_entrypoint` — boolean
- `is_public_surface` — boolean
- `depends_on` — related packages or services

### `canonical-summary`

Additional fields:

- `summary_scope` — `service`, `repo`, `bounded-context`, `api-surface`, `datastore`, `context-pack`
- `review_status` — `draft`, `reviewed`, `approved`
- `summary_targets` — paths or artifact IDs summarized

Context-pack conventions memo contract:

- Use `summary_scope: context-pack` for a pack-wide conventions memo.
- Store the markdown artifact at
  `AgentWorkSpace/qmd/context-packs/{context_pack_id}/canonical/context-pack/codebase-conventions.md`.
- Store the sidecar record at
  `AgentWorkSpace/qmd/context-packs/{context_pack_id}/canonical/context-pack/codebase-conventions.md.record.json`.
- Keep `record_type: canonical-summary` and `provenance_type: derived`.
- Use `summary_targets` to reference the repo IDs, canonical repo summaries, or
  other pack-scoped artifacts summarized by the memo.
- Treat this artifact as context-pack guidance memory derived from real repo
  inputs, not as a control-plane bootstrap file.

### `operational-note`

Additional fields:

- `environment_scope` — `dev`, `staging`, `prod`, `shared`
- `runbook_type` — `deployment`, `incident`, `debugging`, `maintenance`

### `task-learning`

Additional fields:

- `origin_task_id`
- `learning_scope` — `reusable`, `task-specific`
- `superseded_by` — optional newer record ID

### `task-archive`

Additional fields:

- `task_id`
- `root_task_id` — stable lineage root for follow-up chains; equal to `task_id` for root tasks
- `parent_task_id` — immediate parent task when the archive is a child task
- `parent_qmd_record_id` — exact parent archive record used during child-task shaping when available
- `parent_qmd_scope` — QMD scope used to retrieve that parent archive
- `followup_reason` — concise operator or workflow reason for the child task
- `child_depth` — numeric depth from the lineage root; observability aid only
- `task_title`
- `task_type` — `feature`, `bugfix`, `migration`, `refactor`, `infra`, `docs`
- `slice_ids` — list of slice file names or IDs
- `workflow_status` — `completed`, `completed-with-followup`, `closed-with-known-risk`
- `test_status` — `passed`, `partially-passed`, `failed`, `not-run`
- `qa_status` — `passed`, `issues-found`, `waived`
- `followup_refs` — issue IDs or backlog references

Lineage notes:

- For a root task, `root_task_id` should equal `task_id`.
- For a non-child task with no declared lineage, `parent_task_id`, `parent_qmd_record_id`, `parent_qmd_scope`, and `followup_reason` may be omitted.
- When a child task is archived, `parent_task_id` and `root_task_id` should be explicit even if the same values are derivable elsewhere.
- `followup_refs` remains a forward-looking helper and must not replace explicit lineage fields.

### `task-retrospective`

Additional fields:

- `task_id`
- `task_title`
- `workflow_status`
- `workflow_path`
- `retrospective_summary`
- `what_went_well`
- `what_could_have_gone_better`
- `action_items`
- `agent_contributions`
- `reusable_team_learnings`
- `anti_patterns`

These records are stored with the active context pack and preserve the full
retrospective meeting plus the structured sidecar fields needed for retrieval.

### `global-retrospective-entry`

Additional fields:

- `task_id`
- `task_title`
- `global_retrospective_root`
- `retrospective_summary`
- `action_items`

These records materialize one history entry per completed task in the dedicated
global retrospective root.

### `global-retrospective-memory`

Additional fields:

- `global_retrospective_root`
- `synthesized_from_task_ids`
- `open_action_items`
- `validated_improvements`
- `recurring_strengths`
- `recurring_bottlenecks`
- `anti_patterns`

This record type represents the rolling shared retrospective synthesis written
to `AgentWorkSpace/qmd/global/retrospectives/shared-retrospective-memory.md`.

### `working-note`

Additional fields:

- `expires_at`
- `working_status` — `active`, `needs-review`, `expired`

### `stale-archive`

Additional fields:

- `invalidated_at`
- `invalidated_reason`
- `replacement_record_id`

## Lifecycle Semantics

- `created_at` tracks the first durable creation of the record payload.
- `indexed_at` tracks when the record was last ingested or refreshed by tooling.
- `updated_at` tracks the last material content change, even if indexing happened later.
- `review_status` tracks human validation state independently from freshness.
- `freshness_status` tracks temporal trust, not approval.

This separation lets the platform distinguish a reviewed note that has gone stale from an unreviewed note that was indexed recently.

## Normalized Enumerations

### `system_layer`

- `backend`
- `frontend`
- `documents`
- `shared`

### `artifact_type`

- `source-code`
- `test-code`
- `configuration`
- `schema`
- `migration`
- `build-definition`
- `script`
- `architecture-doc`
- `runbook`
- `task-artifact`
- `task-archive`
- `summary`

### `language`

Initial normalized values for a mixed repository estate:

- `csharp`
- `python`
- `typescript`
- `javascript`
- `sql`
- `shell`
- `yaml`
- `json`
- `markdown`

## Organization Overlay Guidance

Organization-specific details such as:

- repo inventories
- service ownership maps
- bounded-context names
- internal naming conventions
- repo-specific relationships

should live in a separate context-pack repository or folder and extend this schema through data, not by rewriting the core contract.

Examples of overlay-owned content:

- `organizations/<org>/repo-inventory.md`
- `organizations/<org>/ownership-map.md`
- `organizations/<org>/repo-tags.json`
- `organizations/<org>/instruction-overlays/`

Context-pack overlays may populate fields such as `context_pack_id`, ownership tags, repo classifications, and bounded-context labels, but they should not redefine the shared meaning of core schema keys.

## Context-Pack and Bootstrap Boundaries

- Every persisted record must belong to exactly one `context_pack_id` and one `qmd_scope`.
- Default retrieval should stay inside the active record's `context_pack_id` and `qmd_scope` unless a caller explicitly broadens scope.
- Dry-run bootstrap artifacts must not be written as live QMD memory merely because they describe future targets.
- A record should exist only after a deliberate indexing, archival, or review step has materialized it with provenance.
- If the same physical repo is present in multiple context packs, each pack gets its own scoped record set rather than silently sharing one pooled memory copy.

## Canonical Identity Rule

Use `repo_name + source_path + source_ref` as the canonical source identity.

Use `context_pack_id + qmd_scope` to determine the default retrieval boundary for a record set.

QMD partitions, tags, and summaries may create many retrieval paths, but they must all resolve back to one authoritative source location.

## Example Minimal Records

### Backend repo artifact

```json
{
  "schema_version": "qmd-record/v1",
  "record_id": "sample-api:src/Sample.Api/Program.cs",
  "record_type": "repo-artifact",
  "title": "Sample API startup entrypoint",
  "repo_name": "sample-api",
  "repo_owner": "sample-org",
  "source_path": "src/Sample.Api/Program.cs",
  "system_layer": "backend",
  "artifact_type": "source-code",
  "language": "csharp",
  "bounded_context": "api",
  "service_name": "Sample.Api",
  "tags": ["framework:aspnetcore", "path:src"],
  "context_pack_id": "platform-core",
  "qmd_scope": "AgentWorkSpace/qmd/platform-core",
  "source_ref": "<commit-sha>",
  "created_at": "2026-03-07T00:00:00Z",
  "indexed_at": "2026-03-06T00:00:00Z",
  "updated_at": "2026-03-07T00:00:00Z",
  "freshness_status": "fresh",
  "provenance_type": "source",
  "provenance_sources": ["src/Sample.Api/Program.cs"],
  "review_status": "unreviewed"
}
```

### Completed task archive

```json
{
  "schema_version": "qmd-record/v1",
  "record_id": "task:sample-api:CAP-1234",
  "record_type": "task-archive",
  "title": "Add request-id propagation middleware",
  "repo_name": "sample-api",
  "repo_owner": "sample-org",
  "source_path": "AgentWorkSpace/handoffs/final-summary.md",
  "system_layer": "backend",
  "artifact_type": "task-archive",
  "language": "markdown",
  "bounded_context": "api",
  "service_name": "Sample.Api",
  "tags": ["type:feature", "risk:integration"],
  "context_pack_id": "sample-org",
  "qmd_scope": "AgentWorkSpace/qmd/context-packs/sample-org",
  "source_ref": "<commit-sha>",
  "created_at": "2026-03-07T00:00:00Z",
  "indexed_at": "2026-03-06T00:00:00Z",
  "updated_at": "2026-03-07T00:00:00Z",
  "freshness_status": "fresh",
  "provenance_type": "derived",
  "review_status": "reviewed",
  "provenance_sources": [
    "AgentWorkSpace/handoffs/professional-task.md",
    "AgentWorkSpace/handoffs/implementation-spec.md",
    "AgentWorkSpace/handoffs/tests.md",
    "AgentWorkSpace/handoffs/final-summary.md"
  ],
  "task_id": "CAP-1234",
  "root_task_id": "CAP-1234",
  "parent_task_id": "",
  "parent_qmd_record_id": "",
  "parent_qmd_scope": "",
  "followup_reason": "",
  "child_depth": 0,
  "task_title": "Add request-id propagation middleware",
  "task_type": "feature",
  "slice_ids": ["slice1.md", "slice2.md"],
  "workflow_status": "completed",
  "test_status": "passed",
  "qa_status": "passed",
  "last_reviewed_at": "2026-03-07T00:00:00Z",
  "followup_refs": []
}
```

Use `AgentWorkSpace/handoffs/implementation-spec.md` in `provenance_sources` for Alice's planning record, alongside slice files and any parallel artifacts that describe the chosen execution split.

For child tasks, populate `parent_task_id`, `root_task_id`, `parent_qmd_record_id`, `parent_qmd_scope`, `followup_reason`, and `child_depth` rather than leaving lineage implicit in prose.

## Governance Rules

- required core keys must exist on every record
- extensions must not redefine core keys
- unknown values should be normalized later, not invented silently
- when repo classification is ambiguous, prefer `shared` plus stronger tags
- when remote changes are missing locally, mark confidence and freshness accordingly
- planned bootstrap artifacts must stay outside the live record set until an explicit write path creates durable records

## Future MCP Responsibilities

The repo-context MCP service should eventually:

- validate records against this schema
- enrich records from repo manifests and file paths
- support filtering by any core field
- support combined filters such as `system_layer=backend` and `language=python`
- support default retrieval scoping by `context_pack_id` and `qmd_scope`
- explain which metadata fields caused a record to match
