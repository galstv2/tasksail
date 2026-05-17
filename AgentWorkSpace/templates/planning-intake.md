# Task Title

## Task Lineage

<!-- Captured automatically at submission time. Do not edit manually. For Task Kind "child-task", these three fields are mandatory: Parent Task ID, Root Task ID, Follow-Up Reason. -->

- Task Kind:
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Context Pack Binding

<!-- Captured automatically at submission time. Do not edit manually. -->

- Context Pack Dir:
- Context Pack ID:
- Scope Mode:

<!--
Additional fields emitted conditionally by the staging writer:
- Primary Repo ID              — distributed estates only (omitted for monolith and deep-focus)
- Selected Repo IDs            — distributed estates only (omitted for monolith)
- Primary Focus ID             — when a primary focus is set
- Selected Focus IDs           — non-deep-focus modes (omitted in deep-focus)
- Deep Focus Enabled           — deep-focus mode
- Selected Focus Path          — deep-focus mode
- Selected Focus Target Kind   — deep-focus mode
- Selected Focus Targets       — deep-focus mode (JSON array of focus targets)
- Selected Test Target         — deep-focus mode, when a test target is selected
- Selected Support Targets     — deep-focus mode, when support targets are selected
- Deep Focus Primary Repo ID   — deep-focus mode
- Deep Focus Primary Focus ID  — deep-focus mode
-->


<!-- Scale intake detail to task size and risk: keep simple surgical tasks concise and exact; add file paths, symbols, compatibility notes, validation, and routing rationale for medium, complex, risky, or cross-cutting tasks only when those details reduce ambiguity or prevent regressions. Do not add filler. -->

## Request Summary
<!-- (2+ sentences; minimum 20 characters) — say what the task is, why it is being asked for, and what concrete result is wanted. Use the Guide's exact terms when possible. Include any behavior, artifact, or workflow that must stay unchanged. Do not do codebase research here; give the clearest possible statement of the ask. -->

## Desired Outcome
<!-- (1+ sentences) — describe what success looks like when this task is complete. Name the end state clearly, especially any required UX, behavior, policy, or artifact outcome. -->

## Constraints
<!-- (0+ bullets) — list only real boundaries that must be preserved. Use one bullet per constraint. Include out-of-scope items, unchanged behavior, compatibility requirements, ordering limits, or areas that must not be modified. Use "None" if not applicable. -->

## Critical Requirements
<!-- Prefer plain bullets. Use this section for load-bearing operator requirements downstream agents must not weaken, summarize away, or omit. Include exact algorithms, ordering constraints, data preservation rules, scope boundaries, and "must not regress" behavior. Write exact "None" only when there are truly no critical requirements to preserve. -->

## Compatibility Requirements
<!-- Prefer plain bullets. Use this section for existing behavior that must continue to work while this task changes related behavior. Include existing API behavior, direct-call behavior, UI behavior, file formats, or workflows that must remain compatible. Write exact "None" only when there are truly no compatibility requirements to preserve. -->

## Required Validation
<!-- Prefer plain bullets with concrete evidence: an exact command, Manual check:, Structural check:, or Log snapshot:. Include focused commands, broad regression commands, structural scans, log/runtime snapshots, or manual UI checks that Alice, Dalton, and Ron must preserve. Write exact "None" only when there is truly no required validation to preserve. -->

## Acceptance Signals
<!-- (1+ bullet or numbered items required; prose alone fails validation) — list the clearest checks that would show the task is done. Keep them concrete and verifiable. Include both what should change and what must still work if that matters. -->

## Parent Task Carry-Forward Summary
<!-- (required for "child-task"; leaving this blank when Task Kind is child-task fails validation. Leave blank for "standard".) Record only the parent context that still matters: preserved decisions, inherited constraints, unresolved risks, and what changed from the parent task. -->

## Suggested Routing
<!-- (1 word) — write "Simple" or "Complex" (case-insensitive). Writing "Complex" activates validation of Independent Slices and Constraints in parallel-ok.md downstream. -->
- Recommended Execution:
<!-- (1-2 sentences) - Briefly explain why this should stay simple or become complex. Focus on scope shape: one coherent change, tightly coupled sequential work, or clearly separate work streams. -->
- Decision Rationale:

## Source

- Created By: Planning Agent
- Created At (UTC):
