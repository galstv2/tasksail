from __future__ import annotations

from pathlib import Path

def write_text(workspace: Path, relative_path: str, content: str) -> None:
    target = workspace / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def write_valid_retrospective(
    workspace: Path,
    *,
    task_id: str,
    title: str,
    meeting_context: str,
    retrospective_summary: str,
    what_went_well: str,
    improvement: str,
    action_item: str,
    planning_note: str,
    product_note: str | None = None,
    engineer_note: str,
    qa_note: str,
    learnings: str,
    anti_patterns: str,
) -> None:
    resolved_product_note = product_note or "The product handoff stayed aligned."
    resolved_engineer_note = engineer_note
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/retrospective-input.md",
        f"""# Retrospective Input

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Meeting Context

{meeting_context}

## Retrospective Summary

{retrospective_summary}

## What Went Well

- {what_went_well}

## What Could Have Gone Better

- {improvement}

## Action Items

- {action_item}

## Lily's Contribution (Planning Specialist)

- {planning_note}

## Alice's Contribution (Product Manager)

- {resolved_product_note}

## Dalton's Contribution (Software Engineer)

- {resolved_engineer_note}

## Ron's Contribution (QA and Closeout)

- {qa_note}

## Reusable Team Learnings

- {learnings}

## Anti-Patterns To Avoid

- {anti_patterns}
""",
    )


def write_brief_retrospective(
    workspace: Path,
    *,
    task_id: str,
    title: str,
    retrospective_summary: str,
) -> None:
    """Write a retrospective with only Retrospective Summary populated."""
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/retrospective-input.md",
        f"""# Retrospective Input

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md

## Task Lineage

- Task Kind: standard
- Parent Task ID:
- Root Task ID:
- Parent QMD Record ID:
- Parent QMD Scope:
- Follow-Up Reason:

## Meeting Context

## Retrospective Summary

{retrospective_summary}

## What Went Well

## What Could Have Gone Better

## Action Items

## Lily's Contribution (Planning Specialist)

## Alice's Contribution (Product Manager)

## Dalton's Contribution (Software Engineer)

## Ron's Contribution (QA and Closeout)

## Reusable Team Learnings

## Anti-Patterns To Avoid
""",
    )


def write_parallel_workflow_handoffs(workspace: Path) -> None:
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/professional-task.md",
        "# Professional Task\n\n"
        "## Task Metadata\n\n"
        "- Task ID: CAP-123\n"
        "- Task Title: Parallel Dalton launch\n"
        "- Initialized At (UTC): 2026-03-07T00:00:00Z\n"
        "- Active Branch: main\n"
        "- Intake Source: AgentWorkSpace/pendingitems/example.md\n\n"
        "## Task Lineage\n\n"
        "- Task Kind: standard\n"
        "- Parent Task ID:\n"
        "- Root Task ID:\n"
        "- Parent QMD Record ID:\n"
        "- Parent QMD Scope:\n"
        "- Follow-Up Reason:\n\n"
        "## Raw Request\n\n"
        "Implement safe parallel Dalton fan-out.\n\n"
        "## Parent Task Carry-Forward Context\n\n"
        "## Problem Statement\n\n"
        "Launchers must fail closed.\n\n"
        "## Business Goal\n\n"
        "Keep parallel orchestration deterministic.\n\n"
        "## Scope\n\n"
        "Add a parallel launcher.\n\n"
        "## Non-Goals\n\n"
        "1. No changes outside the parallel launcher.\n\n"
        "## Constraints\n\n"
        "## Acceptance Criteria\n\n"
        "1. Parallel launcher exits non-zero on any validation failure.\n\n"
        "## Risks\n\n"
        "## Open Questions\n",
    )
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/implementation-spec.md",
        "# Implementation Spec\n\n"
        "## Task Metadata\n\n"
        "- Task ID: CAP-123\n"
        "- Task Title: Parallel Dalton launch\n"
        "- Initialized At (UTC): 2026-03-07T00:00:00Z\n"
        "- Active Branch: main\n"
        "- Intake Source: AgentWorkSpace/pendingitems/example.md\n\n"
        "## Task Lineage\n\n"
        "- Task Kind: standard\n"
        "- Parent Task ID:\n"
        "- Root Task ID:\n"
        "- Parent QMD Record ID:\n"
        "- Parent QMD Scope:\n"
        "- Follow-Up Reason:\n\n"
        "## Problem and Outcome\n\n"
        "### Problem Statement\n\n"
        "The platform lacks safe parallel Dalton fan-out.\n\n"
        "### Goals\n\n"
        "1. Implement parallel launcher with fail-closed semantics.\n\n"
        "### Non-Goals\n\n"
        "1. No changes to single-agent launch path.\n\n"
        "## Current State and Boundaries\n\n"
        "### Parent Task Carry-Forward Context\n\n"
        "### Codebase Analysis\n\n"
        "pipeline/sequencer.ts is the fleet orchestration entry point.\n\n"
        "### Dependency Analysis\n\n"
        "| Module | Depends On |\n"
        "|---|---|\n"
        "| pipeline/sequencer.ts | workflow-policy/index.ts |\n\n"
        "### Change Boundaries\n\n"
        "Only the parallel launcher and its tests.\n\n"
        "## Implementation Plan\n\n"
        "### Architecture Summary\n\n"
        "Fan out one validated launcher call per ready Dalton assignment.\n\n"
        "### Touched Systems\n\n"
        "src/backend/platform/agent-runner/\n\n"
        "### Proposed Structure\n\n"
        "Fleet execution is orchestrated from the TypeScript pipeline/sequencer path.\n\n"
        "### Contracts\n\n"
        "Deterministic JSON status output.\n\n"
        "### Migrations or Data Implications\n\n"
        "None.\n\n"
        "## Risk and Impact\n\n"
        "### Risks\n\n"
        "- Fail closed before partial launch success is reported.\n\n"
        "### Impact Assessment\n\n"
        "Low risk, additive change.\n\n"
        "## Validation and Evidence\n\n"
        "### Validation Strategy\n\n"
        "```bash\npython3 -m unittest tests.test_run_parallel_daltons -v\n```\n\n"
        "### Test Coverage\n\n"
        "tests/test_run_parallel_daltons.py\n\n"
        "## Change Surface\n\n"
        "### Files or Areas Likely to Change\n\n"
        "- src/backend/platform/agent-runner/parallelRunner.ts\n"
        "- tests/test_run_parallel_daltons.py\n",
    )
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/issues.md",
        "# QA Issues\n\n"
        "## Task Metadata\n\n"
        "- Task ID: CAP-123\n"
        "- Task Title: Parallel Dalton launch\n"
        "- Initialized At (UTC): 2026-03-07T00:00:00Z\n"
        "- Active Branch: main\n"
        "- Intake Source: AgentWorkSpace/pendingitems/example.md\n\n"
        "## Finding\n\n"
        "## Severity\n\n"
        "## Finding Type\n\n"
        "## Expectation Violated\n\n"
        "## Required Fix\n\n"
        "## Remediation Owner Agent ID\n\n"
        "software-engineer\n\n"
        "## Revalidation Agent ID\n\n"
        "qa\n\n"
        "## Return-To Agent ID\n\n"
        "qa\n\n"
        "## Retest Instructions\n",
    )
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/parallel-ok.md",
        "# Parallel OK\n\n"
        "Use this file only when slice independence is real.\n\n"
        "## Task Metadata\n\n"
        "- Task ID: CAP-123\n"
        "- Task Title: Parallel Dalton launch\n"
        "- Initialized At (UTC): 2026-03-07T00:00:00Z\n"
        "- Active Branch: main\n"
        "- Intake Source: AgentWorkSpace/pendingitems/example.md\n\n"
        "## Decision\n\n"
        "Complex SWE execution is approved because the slices do not "
        "overlap.\n\n"
        "## Independent Slices\n\n"
        "- One slice owns launcher fan-out.\n"
        "- One slice owns per-instance launch validation.\n\n"
        "## Constraints\n\n"
        "- No overlapping boundaries, contracts, or file ownership.\n"
        "- No hidden dependency on another slice landing first.\n\n"
        "## Coordination Notes\n\n"
        "- Keep file ownership exclusive.\n"
        "- Resequence immediately if overlap is discovered.\n",
    )
