"""Artifact writers for synthetic E2E pipeline tests."""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

from tests.support.handoff_factory import write_text


def _task_metadata(task_id: str, title: str) -> str:
    return (
        f"## Task Metadata\n\n"
        f"- Task ID: {task_id}\n"
        f"- Task Title: {title}\n"
        f"- Initialized At (UTC): 2026-03-07T00:00:00Z\n"
        f"- Active Branch: main\n"
        f"- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md"
    )


_TASK_LINEAGE = (
    "## Task Lineage\n\n"
    "- Task Kind: standard\n"
    "- Parent Task ID:\n"
    "- Root Task ID:\n"
    "- Parent QMD Record ID:\n"
    "- Parent QMD Scope:\n"
    "- Follow-Up Reason:"
)


def write_product_manager_artifacts(
    workspace: Path,
    *,
    task_id: str,
    title: str,
) -> None:
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/implementation-spec.md",
        dedent(f"""\
        # Implementation Spec

        {_task_metadata(task_id, title)}

        {_TASK_LINEAGE}

        ## Problem and Outcome

        ### Problem Statement

        The repository needs a deterministic subprocess test for the active standard-only workflow.

        ### Goals

        1. Validate the standard workflow artifacts from intake to archive.

        ### Non-Goals

        1. No live Copilot execution.
        2. No retired roles or fast-path artifacts.

        ## Current State and Boundaries

        ### Parent Task Carry-Forward Context

        ### Codebase Analysis

        workflow-policy/cli.ts is the canonical TypeScript guardrail entry point for
        workflow artifacts.

        ### Dependency Analysis

        | Module | Depends On |
        |---|---|
        | test_mvp_green_light.py | workflow-policy/cli.ts |

        ### Change Boundaries

        Test code only.

        ## Implementation Plan

        ### Architecture Summary

        Single subprocess integration test exercising Product Manager, Software Engineer, and QA outputs.

        ### Touched Systems

        tests/

        ### Proposed Structure

        Keep the synthetic subprocess test and helper writers aligned to the current standard-only workflow.

        ### Contracts

        Validation must stay deterministic and use only active workflow artifacts.

        ### Migrations or Data Implications

        None.

        ## Risk and Impact

        ### Risks

        Low.

        ### Impact Assessment

        Low.

        ## Validation and Evidence

        ### Validation Strategy

        ```bash
        RUN_SLOW_TESTS=1 python3 -m pytest tests/domains/e2e/test_mvp_green_light.py -v
        ```

        ### Test Coverage

        tests/domains/e2e/test_mvp_green_light.py

        ## Change Surface

        ### Files or Areas Likely to Change

        - tests/domains/e2e/test_mvp_green_light.py
        - tests/support/e2e_artifacts.py
        """),
    )
    write_text(
        workspace,
        "AgentWorkSpace/ImplementationSteps/slice-01-green-light-validation.md",
        """# Slice 01 - Green-Light Validation

## Objective

### Purpose

Validate the active standard-only workflow with a deterministic subprocess E2E test.

## Dependencies and Order

### Depends On

None.

## Execution Scope

### Scope

- Keep the synthetic test aligned to Product Manager, Software Engineer, and QA.
- Exercise queue closeout and archive behavior.
NOT: live Copilot execution or retired-role coverage.

## Files and Interfaces

### Files

- tests/domains/e2e/test_mvp_green_light.py
- tests/support/e2e_artifacts.py

### Unit Tests

- tests/domains/e2e/test_mvp_green_light.py

## Acceptance and Validation

### Acceptance Criteria

1. The synthetic test writes only current workflow artifacts.
2. Pre-closeout validation passes.
3. Queue closeout archives the task successfully.

### Validation Commands

```bash
RUN_SLOW_TESTS=1 python3 -m pytest tests/domains/e2e/test_mvp_green_light.py -v
```

## Guards and Coordination

### Guards

- No real agent CLI invocation.
- No fast-path or retired-role artifacts.
""",
    )


def write_software_engineer_outputs(
    workspace: Path,
    *,
    task_id: str,
    title: str,
) -> None:
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/tests.md",
        f"""# Tests

## Task Metadata

- Task ID: {task_id}
- Task Title: {title}
- Initialized At (UTC): 2026-03-07T00:00:00Z
- Active Branch: main
- Intake Source: AgentWorkSpace/pendingitems/{task_id.lower()}.md
- Testing Infrastructure: available

## Test Inventory

- `tests/domains/e2e/test_mvp_green_light.py` - subprocess validation of the standard-only workflow; pass

## Commands

```bash
RUN_SLOW_TESTS=1 python3 -m pytest tests/domains/e2e/test_mvp_green_light.py -v
```

## Coverage Notes

Synthetic validation covers Product Manager, Software Engineer, and QA artifacts plus queue closeout.
""",
    )


def write_qa_closeout(
    workspace: Path,
    *,
    task_id: str,
    title: str,
    difficulty: str = "Medium",
) -> None:
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/issues.md",
        f"""# QA Issues

{_task_metadata(task_id, title)}

## Review Outcome

pass

## Finding

## Severity

## Finding Type

## Expectation Violated

## Required Fix

## Remediation Owner Agent ID

## Revalidation Agent ID

## Return-To Agent ID

## Retest Instructions
""",
    )
    write_text(
        workspace,
        "AgentWorkSpace/handoffs/final-summary.md",
        f"""# Final Summary

{_task_metadata(task_id, title)}

{_TASK_LINEAGE}

## Inherited Parent Context

## Child-Task Outcome Delta

## Closeout Owner Agent ID

qa

## Completed Work

- Validated the synthetic standard-only workflow from intake through closeout.
- Confirmed archive and reinforcement settlement executed during queue completion.

## Key Design Decisions

- Keep the synthetic test aligned to Product Manager, Software Engineer, and QA only.
- Preserve queue closeout and archive execution through real scripts.

## Known Limitations

- No live Copilot execution.

## Test Result Summary

The subprocess green-light test completed with a clean QA pass and valid handoff artifacts.

## Rollout or Operational Notes

None.

## Follow-Up Backlog

None.

## Difficulty Assessment

- Difficulty Level: {difficulty}
""",
    )
