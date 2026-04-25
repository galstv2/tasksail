"""Correction memo builder unit tests."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
SCRIPTS_PYTHON = REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PYTHON))

from lib.archive.correction_memo import (
    CorrectionMemoBuilder,
    _build_diff,
    _extract_shared_items,
)
from lib.archive.retrospective import is_actionable


def _make_cycle_summary(
    task_count: int = 10,
    bottlenecks: list[tuple[str, list[str]]] | None = None,
    action_items: list[tuple[str, list[str]]] | None = None,
    anti_patterns: list[tuple[str, list[str]]] | None = None,
    improvements: list[tuple[str, list[str]]] | None = None,
    per_role: dict | None = None,
) -> dict:
    return {
        "task_count": task_count,
        "records_found": task_count,
        "task_ids": [f"TASK-{i}" for i in range(1, task_count + 1)],
        "difficulty_distribution": {"Easy": 3, "Medium": 5, "Hard": 2},
        "remediation_cycles": 0,
        "ranked_strengths": [],
        "ranked_bottlenecks": bottlenecks or [],
        "ranked_action_items": action_items or [],
        "ranked_anti_patterns": anti_patterns or [],
        "ranked_improvements": improvements or [],
        "per_role_ranked": per_role or {},
    }


# --- Original tests ---


def test_build_correction_memo_produces_all_sections() -> None:
    summary = _make_cycle_summary(
        bottlenecks=[("Slow reviews delayed the entire pipeline for multiple tasks", ["T-1", "T-2"])],
        action_items=[("Speed up the review process by adding automated pre-checks to the pipeline", ["T-1"])],
    )
    builder = CorrectionMemoBuilder()
    markdown, payload = builder.build_correction_memo(
        summary, None, "test-pack", 1
    )
    assert "# Behavior Correction Memo — Cycle 1" in markdown
    assert "## Cycle Metadata" in markdown
    assert "## Cycle Outcome Summary" in markdown
    assert "## Process Corrections" in markdown
    assert "## Agent-Specific Corrections" in markdown
    assert "## Technical Corrections" in markdown
    assert "## Recurring Anti-Patterns (Escalated)" in markdown
    assert "## Validated Improvements (Reinforced)" in markdown
    assert payload["record_type"] == "behavior-correction-memo"
    assert payload["cycle_count"] == 1


def test_escalated_anti_patterns_from_shared_memory() -> None:
    shared_md = "\n".join([
        "# Shared Retrospective Memory",
        "",
        "## Anti-Patterns To Avoid",
        "",
        "- Skipping tests in the CI pipeline caused repeated regressions (seen in 3 tasks: T-1, T-2, T-3)",
        "- Hardcoded values in configuration files make deployments fragile and error-prone (seen in 1 task: T-4)",
        "",
    ])

    summary = _make_cycle_summary(
        anti_patterns=[
            ("Skipping tests in the CI pipeline caused repeated regressions", ["T-5", "T-6"]),
            ("New pattern that has not appeared before in any previous cycle", ["T-7"]),
        ],
    )
    builder = CorrectionMemoBuilder()
    markdown, payload = builder.build_correction_memo(
        summary, shared_md, "test-pack", 2
    )
    assert "Skipping tests in the CI pipeline caused repeated regressions" in markdown
    assert "Skipping tests in the CI pipeline caused repeated regressions" in payload["escalated_anti_patterns"]
    assert "New pattern that has not appeared before in any previous cycle" not in payload["escalated_anti_patterns"]


def test_reinforced_improvements_from_shared_memory() -> None:
    shared_md = "\n".join([
        "# Shared Retrospective Memory",
        "",
        "## Validated Improvements",
        "",
        "- Better code reviews with structured checklists improved merge quality significantly (seen in 2 tasks: T-1, T-2)",
        "",
    ])

    summary = _make_cycle_summary(
        improvements=[("Better code reviews with structured checklists improved merge quality significantly", ["T-5"])],
    )
    builder = CorrectionMemoBuilder()
    markdown, payload = builder.build_correction_memo(
        summary, shared_md, "test-pack", 1
    )
    assert "Better code reviews with structured checklists improved merge quality significantly" in payload["reinforced_improvements"]


def test_per_agent_corrections_rendered() -> None:
    summary = _make_cycle_summary(
        per_role={"Software Engineer": [("Fix lint warnings before opening pull requests to avoid blocking CI", ["T-1", "T-2"])]},
    )
    builder = CorrectionMemoBuilder()
    markdown, _ = builder.build_correction_memo(
        summary, None, "test-pack", 1
    )
    assert "### Dalton (Software Engineer)" in markdown
    assert "Fix lint" in markdown


def test_no_shared_memory_produces_empty_escalations() -> None:
    summary = _make_cycle_summary(
        anti_patterns=[("Something bad happened during the integration testing phase of the pipeline", ["T-1"])],
    )
    builder = CorrectionMemoBuilder()
    _, payload = builder.build_correction_memo(
        summary, None, "test-pack", 1
    )
    assert payload["escalated_anti_patterns"] == []


def test_extract_shared_items_handles_missing_section() -> None:
    md = "# No sections here\n\nJust text.\n"
    result = _extract_shared_items(md, "Missing Section")
    assert result == set()


def test_extract_shared_items_strips_task_counts() -> None:
    md = "\n".join([
        "## Anti-Patterns To Avoid",
        "",
        "- Bad pattern that keeps showing up across multiple tasks (seen in 5 tasks: T-1, T-2, T-3, T-4, T-5)",
        "",
    ])
    result = _extract_shared_items(md, "Anti-Patterns To Avoid")
    assert "Bad pattern that keeps showing up across multiple tasks" in result


# --- Phase 1: Actionability filter tests ---


def test_actionable_rejects_short_text() -> None:
    assert not is_actionable("Too short")
    assert not is_actionable("Only five words here today")
    assert not is_actionable("one two three four five six seven eight nine")


def test_actionable_accepts_sufficient_text() -> None:
    assert is_actionable("one two three four five six seven eight nine ten")
    assert is_actionable(
        "This is a properly detailed retrospective item "
        "that describes the problem and its impact clearly"
    )


# --- Phase 2: Shared memory expiry tests ---


def test_extract_shared_items_filters_by_active_task_ids() -> None:
    md = "\n".join([
        "## Anti-Patterns To Avoid",
        "",
        "- Old stale pattern from ancient tasks that no longer matter (seen in 2 tasks: T-1, T-2)",
        "- Recent pattern that still affects the current cycle of work (seen in 2 tasks: T-9, T-10)",
        "",
    ])
    active = {"T-9", "T-10", "T-11"}
    result = _extract_shared_items(md, "Anti-Patterns To Avoid", active_task_ids=active)
    assert "Recent pattern that still affects the current cycle of work" in result
    assert "Old stale pattern from ancient tasks that no longer matter" not in result


def test_extract_shared_items_includes_overlapping_task_ids() -> None:
    md = "\n".join([
        "## Anti-Patterns To Avoid",
        "",
        "- Partially overlapping pattern spanning old and new cycles together (seen in 3 tasks: T-1, T-5, T-10)",
        "",
    ])
    active = {"T-10", "T-11"}
    result = _extract_shared_items(md, "Anti-Patterns To Avoid", active_task_ids=active)
    assert "Partially overlapping pattern spanning old and new cycles together" in result


def test_extract_shared_items_no_filter_when_none() -> None:
    md = "\n".join([
        "## Anti-Patterns To Avoid",
        "",
        "- Ancient pattern from the very first cycle of the project (seen in 1 task: T-1)",
        "",
    ])
    result = _extract_shared_items(md, "Anti-Patterns To Avoid", active_task_ids=None)
    assert "Ancient pattern from the very first cycle of the project" in result


# --- Phase 3: Correction memo diffing tests ---


def test_diff_identifies_new_items() -> None:
    previous = "\n".join([
        "## Technical Corrections",
        "",
        "- Old issue that existed in the previous cycle memo only (seen in 2 tasks: T-1, T-2)",
        "",
    ])
    current_anti = [("Brand new issue that was not in the previous cycle", ["T-11"])]
    result = _build_diff(previous, current_anti, [])
    assert result is not None
    assert "Brand new issue that was not in the previous cycle" in result["new"]
    assert any("[NEW]" in line for line in result["lines"])


def test_diff_identifies_persisting_items() -> None:
    previous = "\n".join([
        "## Technical Corrections",
        "",
        "- Persistent issue that keeps showing up across multiple cycles (seen in 2 tasks: T-1, T-2)",
        "",
    ])
    current_anti = [("Persistent issue that keeps showing up across multiple cycles", ["T-11", "T-12"])]
    result = _build_diff(previous, current_anti, [])
    assert result is not None
    assert "Persistent issue that keeps showing up across multiple cycles" in result["persisting"]
    assert any("[PERSISTING]" in line for line in result["lines"])


def test_diff_identifies_resolved_items() -> None:
    previous = "\n".join([
        "## Technical Corrections",
        "",
        "- Fixed issue that no longer appears in the current cycle corrections (seen in 2 tasks: T-1, T-2)",
        "",
    ])
    result = _build_diff(previous, [], [])
    assert result is not None
    assert "Fixed issue that no longer appears in the current cycle corrections" in result["resolved"]
    assert any("[RESOLVED]" in line for line in result["lines"])


def test_diff_skipped_when_no_previous() -> None:
    result = _build_diff(None, [("Something", ["T-1"])], [])
    assert result is None


def test_diff_section_appears_in_memo() -> None:
    previous_md = "\n".join([
        "## Technical Corrections",
        "",
        "- Old technical issue that was identified during the previous cycle (seen in 2 tasks: T-1, T-2)",
        "",
        "## Recurring Anti-Patterns (Escalated)",
        "",
        "- None escalated from shared memory.",
        "",
    ])
    summary = _make_cycle_summary(
        anti_patterns=[
            ("Brand new anti-pattern that was not seen in the previous cycle", ["T-11"]),
            ("Old technical issue that was identified during the previous cycle", ["T-11", "T-12"]),
        ],
    )
    builder = CorrectionMemoBuilder()
    markdown, payload = builder.build_correction_memo(
        summary, None, "test-pack", 2,
        previous_memo_markdown=previous_md,
    )
    assert "## Cycle-over-Cycle Status" in markdown
    assert "[NEW]" in markdown
    assert "[PERSISTING]" in markdown
    assert "[RESOLVED]" not in markdown
    assert "cycle_diff" in payload
    assert "Brand new anti-pattern that was not seen in the previous cycle" in payload["cycle_diff"]["new_items"]
    assert "Old technical issue that was identified during the previous cycle" in payload["cycle_diff"]["persisting_items"]
