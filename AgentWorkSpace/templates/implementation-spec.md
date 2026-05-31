# Implementation Spec
<!-- Scale detail to task complexity: keep small surgical plans concise and concrete; expand complex/risky plans only where extra current-state facts, sequencing, contracts, guards, or validation reduce ambiguity or regression risk. Do not add filler. -->

## Task Metadata

### Core Metadata

- Task ID:
- Task Title:
- Initialized At (UTC):
- Active Branch:
- Intake Source:

### Task Lineage

- Task Kind:
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Intake Requirements
<!-- Platform-generated from handoffs/intake.md during task activation. Do not edit or delete. Read handoffs/intake.md for the full request context; use this section as the canonical requirement spine for CR-*, COMP-*, and VAL-* items. -->

## Problem and Outcome

### Problem Statement
<!-- restate the problem with technical precision; scale detail with complexity -->

### Goals
<!-- (1+ bullet or numbered items required; prose alone fails validation — each a measurable design objective) -->

### Non-Goals
<!-- (1+ bullet or numbered items required; prose alone fails validation — boundaries the architecture must not cross) -->

## Current State and Boundaries

### Parent Task Carry-Forward Context
<!-- (required for "child-task"; leaving this blank when Task Kind is child-task fails validation. Leave blank for "standard".) -->

### Codebase Analysis
<!-- concrete current-state facts from files inspected; include exact file paths and symbol names when known. For simple tasks, one concise bullet is acceptable. -->

### Source Inventory
<!-- canonical source-derived inventory for slice derivation. List every existing route group, endpoint, class, handler, file, or other symbol whose inclusion or exclusion affects the task; use stable local IDs such as SYM-001 when useful. For refactors/extractions, list all relevant current symbols found in source, not only the ones likely to change. Write "Source inspection found no existing source symbols" only when inspection proves there are none. Write "None" only when no source symbol inventory applies to this task. -->

### Dependency Analysis
<!-- (required) must contain a markdown table (| col | col |) or a fenced code block; bullets and prose alone fail validation. Internal and external dependencies. -->

### Change Boundaries
<!-- allowed areas, explicit out-of-scope areas, and preserved behavior when compatibility matters -->

## Implementation Plan

### Architecture Summary
<!-- smallest viable approach and key sequencing decisions; for simple tasks, use a concise direct approach -->

### Touched Systems
<!-- layers or services this change affects -->

### Requirement Handling
<!-- For each generated CR-*, COMP-*, and VAL-* from ## Intake Requirements that is global, cross-cutting, or not owned by one specific slice, reference the exact ID and explain where it is handled. Do not copy full requirement text. Do not edit ## Intake Requirements. -->

### Proposed Structure
<!-- file layout, module decomposition, or class hierarchy; use nested bullets, tables, or code fences when authored -->

### Slice Partition
<!-- canonical active-format slice plan derived from this implementation spec. Prefer one entry per planned slice, starting with slice-N, slice-N.md, or slice-N.xml as the first token of a bullet/heading/list entry or the first table cell. For each planned slice-N, list the owned symbols/files, excluded or preserved symbols/files, dependency/order constraints, requirement IDs, and validation responsibility. Use one slice entry for Simple execution. -->

### Contracts
<!-- exact API, data, section, file-format, IPC, or CLI contracts changed; write "None" when no contract changes exist -->

### Migrations or Data Implications
<!-- schema changes, data migrations; "None" if not applicable -->

## Risk and Impact

### Risks
<!-- technical risks and mitigations; "None" if low risk -->

### Impact Assessment
<!-- blast radius and rollback considerations; "None" if minimal -->

## Validation and Evidence

### Validation Strategy
<!-- (required) must contain executable commands or manual checks mapped to the actual change; carry forward relevant VAL-* items from Intake Requirements. Use a fenced code block (```bash ... ```) or shell-prefixed command lines; narrative prose alone fails validation -->

### Test Coverage
<!-- (recommended; absence triggers a warning, not an error) what tests will be added or updated; write "None" if not applicable -->

## Change Surface

### Files or Areas Likely to Change
<!-- file paths or directories with one-line reasons; include read-only or do-not-touch paths when known -->
