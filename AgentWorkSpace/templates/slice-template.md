# Slice Template
<!-- Scale detail to task complexity: keep small surgical slices concise and exact; expand complex/risky slices with enough current-state facts, sequencing, guards, and validation detail that the executing agent can execute without guessing. Do not add filler. -->

## Objective

### Purpose
<!-- concrete outcome for this slice and why it exists in the overall plan; reference relevant CR-*, COMP-*, or VAL-* IDs only when they directly affect this slice. For small tasks, one or two concise sentences are enough; expand context only when complex or risky. -->

### Inputs to Read
<!-- list exact files, tests, helpers, existing patterns, or generated handoff sections the executing agent should read before editing; write "None" only if this slice genuinely needs no pre-read beyond the files it edits -->

## Dependencies and Order

### Depends On
<!-- list prerequisite slice IDs, generated files, types, helpers, sequencing constraints, or "None" when independent -->

## Execution Scope

### Scope
<!-- required changes, preserved behavior, and relevant requirement IDs from Intake Requirements. For small tasks, use a few exact bullets; for large tasks, include sequencing, data flow, failure behavior, and integration boundaries in enough detail to prevent guessing. -->

### Current Symbols
<!-- source-derived inventory of every existing route group, endpoint, class, handler, file, or other symbol whose inclusion or exclusion affects this slice; for refactors/extractions, list all relevant current symbols found in source, not only the ones being changed; write "Source inspection found no existing source symbols" only when source inspection proves there are none; write "None" only when no source symbol inventory applies -->

### Included Symbols
<!-- exact Current Symbols entries this slice may change, move, extract, or otherwise implement; write "None" only when this slice changes no existing source symbols -->

### Excluded Symbols
<!-- exact Current Symbols entries intentionally left unchanged or out of scope, with a short reason when useful; write "None" only when every current symbol is intentionally included or no source symbol inventory applies -->

### Requirement Coverage
<!-- List only the CR-*, COMP-*, and VAL-* IDs this slice implements, preserves, or validates. Write "None" only when no generated requirement applies directly to this slice. Do not paste every ID by default. -->

### Allowed Changes
<!-- exact files, directories, modules, tests, or docs this slice may edit; include ownership boundaries when multiple slices exist -->

### Out of Scope
<!-- exact files, behavior, features, cleanup, refactors, or validation changes this slice must not perform; prefix hard exclusions with "NOT:" -->

## Files and Interfaces

### Files
<!-- (required, non-empty; leaving this blank fails validation) list each file with expected edit type, new/existing/read-only status, and interface or contract notes when relevant. For small tasks, name exact expected files if known; for larger tasks, directories are allowed only with a concrete ownership boundary and example files or symbols. -->

### Unit Tests
<!-- (required, non-empty; absence fails validation) list test files and what behavior they prove. For small tasks, one focused test or an explicit reason for no test may be enough; for larger or riskier tasks, include focused regression coverage and broader validation when shared contracts or workflows are touched. -->

## Acceptance and Validation

### Acceptance Criteria
<!-- (1+ bullet or numbered items required; prose alone fails validation — write measurable criteria only) carry forward the subset of implementation-spec.md goals, contracts, change boundaries, and risk mitigations that this slice must satisfy; each bullet should be provable by command, grep, or test assertion -->

### Validation Commands
<!--
(required, blocking gate) Content must be a fenced bash block (```bash ... ```)
or shell-prefixed command lines; narrative prose fails validation.
Add a broader command only when this slice changes shared contracts.
-->

### Stale Assumption Handling
<!-- if a named file/symbol/test moved, the executing agent should find the nearest current equivalent and preserve the required behavior; if an acceptance criterion conflicts with allowed changes, stop expanding scope and leave a clear blocker in closeout -->

## Guards and Coordination

### Guards
<!-- preserved invariants, compatibility requirements, concurrency/order/locking constraints, coordination notes with other slices, and directly relevant requirement IDs; write "None" only when there are genuinely no special guards beyond required scope and validation -->

### Closeout Requirements
<!-- list what the executing agent must report: files changed, tests run, validation not run, remaining risks, and any deferred external action; keep this concise -->
