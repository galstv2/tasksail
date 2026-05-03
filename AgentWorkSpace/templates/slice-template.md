# Slice Template

## Objective

### Purpose
<!-- state what this slice solves and why, but also carry forward the relevant problem statement, goals, and architecture intent from implementation-spec.md; for simple tasks be concise, for complex/risky work include enough context that Dalton can execute without reopening the full spec -->

## Dependencies and Order

### Depends On
<!-- list prerequisite slice IDs, or "None" if independent; do not omit real dependencies that are needed for file availability, shared types, sequencing, or validation order -->

## Execution Scope

### Scope
<!-- describe exactly what this slice must deliver, mapped from implementation-spec.md; carry forward relevant contracts, boundaries, invariants, and non-goals that apply to this slice; prefix exclusions with "NOT:" so downstream agents know what must remain untouched -->

## Files and Interfaces

### Files
<!-- (required, non-empty; leaving this blank fails validation) list all expected files with one-line change descriptions; prefix new files with "(new)"; include every file the slice is likely to touch from implementation-spec.md change surface, and call out any file that must stay read-only for this slice -->

### Unit Tests
<!-- (required, non-empty; absence fails validation) list test files and what they verify; carry forward the relevant validation/test expectations from implementation-spec.md so the slice preserves happy paths, error cases, regressions, and any explicit contract/status-code checks -->

## Acceptance and Validation

### Acceptance Criteria
<!-- (1+ bullet or numbered items required; prose alone fails validation — write measurable criteria only) carry forward the subset of implementation-spec.md goals, contracts, change boundaries, and risk mitigations that this slice must satisfy; each bullet should be provable by command, grep, or test assertion -->

### Validation Commands
<!--
(required, blocking gate) Content must be a fenced bash block (```bash ... ```)
or shell-prefixed command lines; narrative prose fails validation.
Add a broader command only when this slice changes shared contracts.
-->

## Guards and Coordination

### Guards
<!-- carry forward the slice-specific constraints from implementation-spec.md: preserved invariants, untouched areas, migration cautions, contract rules, risk mitigations, and coordination notes with other slices; write "None" only if there are truly no special guards -->
