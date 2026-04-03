# QMD Repository Filing System

_Last updated: March 7, 2026_

## Purpose

This document defines how QMD should file the broader distributed repository estate so code and documents can be retrieved by technical layer and language, not only by raw repo path.

## Goal

The filing system should let the platform answer questions like:

- Which repositories are backend versus frontend?
- Which services are written in a given programming language?
- Which documents describe a given backend or frontend system?
- What shared repositories support multiple application layers?

## Core Filing Dimensions

Every repository artifact should be tagged across multiple dimensions.

### 1. System Layer

Use one primary layer and optional secondary layers:

- `backend`
- `frontend`
- `infrastructure`
- `database`
- `documents`
- `shared`

Examples:

- API services, workers, schedulers, data pipelines → `backend`
- web apps, UI packages, design system apps → `frontend`
- IaC, CI/CD, cluster configuration, deployment automation, platform operations modules → `infrastructure`
- schema-heavy repos, migration-focused repos, and DB operational artifacts when primary → `database`
- ADRs, runbooks, operating guides, specs → `documents`
- SDKs, shared contracts, and common libraries that do not fit a stronger primary layer → `shared`

### 2. Programming Language

Every code artifact should carry at least one language tag, for example:

- `csharp`
- `typescript`
- `javascript`
- `python`
- `go`
- `java`
- `kotlin`
- `rust`
- `sql`
- `shell`
- `markdown`

### 3. Repository

Each item must retain its canonical repository identity.

Examples:

- repo name
- repo owner or org
- local path or source URL

### 4. Service or Bounded Context

Where applicable, include:

- service name
- bounded context
- domain area

### 5. Artifact Type

Examples:

- source-code
- test-code
- configuration
- schema
- migration
- build-definition
- runbook
- architecture-doc
- task-archive

## Recommended Partition Model

Use a multi-dimensional filing scheme rather than forcing each item into only one folder.

Suggested primary partitions:

- `estate/backend/{repo}`
- `estate/frontend/{repo}`
- `estate/infrastructure/{repo}`
- `estate/database/{repo}`
- `estate/documents/{repo}`
- `estate/shared/{repo}`
- `estate/languages/{language}/{repo}`

Recommended bounded-context and service overlays:

- `estate/contexts/{bounded-context}/{repo}`
- `estate/services/{service}/{repo}`

Apply these partitions inside a scoped QMD root:

- `AgentWorkSpace/qmd/platform-core/estate/...` for generic platform indexing
- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/estate/...` for context-pack-specific indexing

Suggested secondary tags:

- `service:{name}`
- `context:{bounded-context}`
- `artifact:{type}`
- `framework:{name}`
- `owner:{team}`
- `layer:{backend|frontend|infrastructure|database|documents|shared}`
- `lang:{language}`
- `repo:{name}`

## Context-Pack Repository Index Contract

Each active context pack should expose a top-level repository index, for
example:

- `AgentWorkSpace/qmd/context-packs/{context-pack-id}/indexes/repositories.json`

That derived index should summarize:

- repo identity
- chosen primary layer
- languages
- bounded context
- service name when known
- seed status
- canonical summary paths
- estate paths
- archive index path when task archives exist

This index improves context-pack discoverability without changing canonical repo
filing identity.

## Canonical Filing Identity

Every indexed artifact should preserve one canonical identity tuple:

- `repo_name`
- `source_path`
- `source_ref`

All partitions, tags, and retrieval shortcuts must resolve back to that canonical identity.

This means:

- partitions improve retrieval
- tags improve filtering
- canonical identity preserves trust and provenance

## Canonical Path Rule

The source path remains canonical.

An item may be discoverable through multiple partitions, but it should still resolve back to one authoritative repo/path location.

Example:

- a React web app file may be filed under `estate/frontend/...`
- the same file may also be tagged under `estate/languages/typescript/...`

This is retrieval metadata, not duplication of the file itself.

If the platform is actively working inside one context pack, repo-context retrieval should resolve only against that context pack's QMD filing root by default.

When the same repository is available in more than one context pack, each context pack should maintain its own scoped filing records rather than silently sharing one pooled index.

## Multi-Repo Source Root Rule

Some context packs describe a logical platform that is distributed across several repositories and several possible local checkout roots.

For first-run seeding:

- keep a separate canonical repo identity for each repository
- allow more than one local root candidate in the context-pack manifest
- file records repo by repo rather than flattening the estate into one synthetic root
- review the dry-run QMD seeding plan before live filing begins

For ongoing filing and refresh:

- refresh artifacts repo by repo
- preserve repo-local canonical paths even when services interact across repositories
- use tags and relationship metadata for cross-repo linkage instead of inventing a merged root path

This preserves clean retrieval boundaries while still supporting distributed estates.

## Documents Filing

Documents should be first-class indexed artifacts, not leftovers.

Recommended document categories:

- architecture docs
- onboarding docs
- runbooks
- specs
- ADRs
- task summaries
- QA guidance
- testing strategy docs

Recommended document partition examples:

- `estate/documents/{repo}/architecture/*`
- `estate/documents/{repo}/runbooks/*`
- `estate/documents/{repo}/tasks/*`

## Filing by Layer and Language

Repository-estate retrieval should work across both vertical and horizontal dimensions.

Examples:

- a Python worker in a backend repo should be retrievable by both `estate/backend/{repo}` and `estate/languages/python/{repo}`
- a markdown runbook should be retrievable by both `estate/documents/{repo}` and document-category tags
- a shared schema package used by several services should remain canonical under its own repo while still tagged for each related bounded context

The filing system should prefer additive metadata over duplicating authoritative content.

## Metadata Requirements

Each indexed item should include:

- repo
- path
- system layer
- programming language
- service or bounded context
- artifact type
- owner when known
- commit SHA or version marker
- indexed timestamp
- freshness status

Recommended additional filing fields:

- `context_pack_id`
- `qmd_scope`
- `record_id`
- `source_ref`
- `framework`
- `related_repos`
- `related_services`
- `tags`

## Retrieval Use Cases

The platform should be able to answer queries such as:

- show all backend repositories for a domain
- find frontend TypeScript code related to a backend API
- find all markdown documents for a given service
- find shared libraries used by both backend and frontend repos
- find migration files for backend systems in a specific language
- find all artifacts for a bounded context across several repositories
- find documents and code for the same service without losing canonical repo identity
- find all repositories involved in one context-pack estate without mixing in another context pack

## Retrieval and Indexing Rules

- Default retrieval should stay inside the active context pack's QMD root.
- Retrieval may combine dimensions such as layer + language + service.
- Repository-estate filters should never rewrite canonical source identity.
- If an artifact is ambiguous between `shared` and a more specific layer, prefer `shared` plus stronger secondary tags.
- Estate-level filing should remain additive to direct repo-path retrieval, not a replacement for it.
- Top-level repository indexes should point to canonical repo filings rather than duplicate authoritative content.

## Governance Rules

- Do not duplicate authoritative content unnecessarily.
- Do not mix unrelated generated artifacts into the same high-signal partitions.
- Keep language tags normalized and predictable.
- Keep system-layer classification explicit rather than inferred at query time whenever possible.
- If classification is ambiguous, mark the item as `shared` and add secondary tags.
- Do not mix repository-estate filings from one context pack into another context pack's QMD root.
- Do not collapse multiple repositories into one canonical source path during bootstrap seeding.
- Do not let one file acquire multiple competing canonical identities because it appears in multiple filing partitions.
- Do not create per-task nested repo trees as a substitute for repository-estate filing.

## Future MCP Behavior

As the platform matures, the repo-context MCP service should be able to:

- browse repositories by system layer
- filter by programming language
- combine filters such as backend + Python or documents + service name
- retrieve linked docs and code for the same bounded context
- retrieve artifacts by repo, service, bounded context, or layer without losing the canonical source path
- navigate distributed context-pack estates repo by repo rather than through one collapsed synthetic root
- explain why an artifact matched a given filing partition