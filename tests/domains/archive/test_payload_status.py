"""Regression tests for structured Test Status / QA Status fields."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
_SCRIPTS_PYTHON = _REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.archive.payload import build_archive_payload  # noqa: E402


def _write_handoffs(
    handoffs_dir: Path,
    *,
    test_status_section: str | None = None,
    qa_status_section: str | None = None,
    test_result_summary: str = "All tests passed.",
    issues_review_outcome: str = "pass",
    branch_handoffs: list[dict] | None = None,
) -> None:
    """Write a minimal but parseable set of handoff artifacts."""
    handoffs_dir.mkdir(parents=True, exist_ok=True)
    (handoffs_dir / "professional-task.md").write_text(
        "# Professional Task\n\n"
        "## Task Metadata\n\n- Task ID: TEST-1\n- Task Title: Sample\n\n"
        "## Business Goal\n\nValidate the archive payload reader.\n",
        encoding="utf-8",
    )
    (handoffs_dir / "implementation-spec.md").write_text(
        "# Implementation Spec\n\n## Touched Systems\n\n- alpha\n",
        encoding="utf-8",
    )
    (handoffs_dir / "tests.md").write_text(
        "# Tests\n\n## Coverage Notes\n\n- ok\n", encoding="utf-8",
    )
    (handoffs_dir / "issues.md").write_text(
        f"# QA Issues\n\n## Task Metadata\n\n- Task ID: TEST-1\n\n"
        f"## Review Outcome\n\n{issues_review_outcome}\n",
        encoding="utf-8",
    )
    extra_status = ""
    if test_status_section is not None:
        extra_status += f"\n## Test Status\n\n{test_status_section}\n"
    if qa_status_section is not None:
        extra_status += f"\n## QA Status\n\n{qa_status_section}\n"
    (handoffs_dir / "final-summary.md").write_text(
        "# Final Summary\n\n## Task Metadata\n\n"
        "- Task ID: TEST-1\n- Task Title: Sample\n\n"
        "## Completed Work\n\n- Did the thing.\n\n"
        f"## Test Result Summary\n\n{test_result_summary}\n"
        f"{extra_status}\n"
        "## Difficulty Assessment\n\n- Difficulty Level: Medium\n",
        encoding="utf-8",
    )
    if branch_handoffs is not None:
        import json
        (handoffs_dir / "branch-handoffs.json").write_text(
            json.dumps(branch_handoffs, indent=2) + "\n",
            encoding="utf-8",
        )


class StructuredStatusTests(unittest.TestCase):
    TASK_ID = "TEST-1"

    def _run(self, **handoff_kwargs) -> dict:
        with TemporaryDirectory() as tmp:
            repo_root = Path(tmp) / "repo"
            handoffs_dir = (
                repo_root / "AgentWorkSpace" / "tasks" / self.TASK_ID / "handoffs"
            )
            _write_handoffs(handoffs_dir, **handoff_kwargs)
            context_pack_dir = repo_root / "contextpacks" / "fixture-pack"
            context_pack_dir.mkdir(parents=True, exist_ok=True)
            # Production's workspace_paths.handoffs_dir reads TASKSAIL_TASK_ID
            # to choose per-task vs. legacy singleton layout. Pin it so the
            # archiver reads from the same per-task path the fixture writes,
            # matching the rest of the archive test suite.
            with patch.dict("os.environ", {"TASKSAIL_TASK_ID": self.TASK_ID}):
                payload, _record_path, _parent = build_archive_payload(
                    repo_root=repo_root,
                    context_pack_dir=context_pack_dir,
                    qmd_scope="qmd/context-packs/fixture-pack",
                )
            return payload

    def test_test_status_structured_passed_overrides_classifier(self) -> None:
        payload = self._run(
            test_status_section="passed",
            qa_status_section="passed",
            test_result_summary="Two failures earlier; ultimately passed.",
        )
        self.assertEqual(payload["test_status"], "passed")

    def test_test_status_structured_failed_overrides_passing_prose(self) -> None:
        payload = self._run(
            test_status_section="failed",
            test_result_summary="Tests passed eventually.",
        )
        self.assertEqual(payload["test_status"], "failed")

    def test_test_status_empty_falls_back_and_warns(self) -> None:
        with self.assertLogs("lib.archive.payload", level="WARNING") as captured:
            payload = self._run(
                test_status_section="",
                qa_status_section="passed",
                test_result_summary="all passed",
            )
        self.assertEqual(payload["test_status"], "passed")
        self.assertTrue(any(
            record.getMessage() == "archive.structured_status.empty"
            and getattr(record, "task_id", None) == "TEST-1"
            and getattr(record, "field_name", None) == "Test Status"
            for record in captured.records
        ))

    def test_test_status_unknown_value_falls_back_and_warns(self) -> None:
        with self.assertLogs("lib.archive.payload", level="WARNING") as captured:
            payload = self._run(
                test_status_section="green",
                qa_status_section="passed",
                test_result_summary="all passed",
            )
        self.assertEqual(payload["test_status"], "passed")
        self.assertTrue(any(
            record.getMessage() == "archive.structured_status.unrecognized"
            and getattr(record, "task_id", None) == "TEST-1"
            and getattr(record, "raw_value", None) == "green"
            for record in captured.records
        ))

    def test_qa_status_structured_passed_overrides_stale_issues(self) -> None:
        payload = self._run(
            qa_status_section="passed",
            issues_review_outcome="advisory",
        )
        self.assertEqual(payload["qa_status"], "passed")

    def test_qa_status_empty_falls_back_to_issues_scan(self) -> None:
        with self.assertLogs("lib.archive.payload", level="WARNING") as captured:
            payload = self._run(
                qa_status_section="",
                issues_review_outcome="advisory",
            )
        self.assertEqual(payload["qa_status"], "issues-found")
        self.assertTrue(any(
            record.getMessage() == "archive.structured_status.empty"
            and getattr(record, "field_name", None) == "QA Status"
            for record in captured.records
        ))

    def test_qa_status_structured_invalid_falls_back(self) -> None:
        with self.assertLogs("lib.archive.payload", level="WARNING") as captured:
            payload = self._run(qa_status_section="yes")
        self.assertIn(payload["qa_status"], {"passed", "issues-found"})
        self.assertTrue(any(
            record.getMessage() == "archive.structured_status.unrecognized"
            and getattr(record, "raw_value", None) == "yes"
            for record in captured.records
        ))

    def test_branch_handoffs_are_added_to_payload_and_provenance(self) -> None:
        handoffs = [
            {
                "repo_root": "/repos/platform",
                "repo_label": "platform",
                "branch": "task/TEST-1",
                "base_commit_sha": "base123",
                "head_commit_sha": "head456",
                "commits_ahead": 1,
                "status": "ready-for-operator-review",
            }
        ]
        payload = self._run(branch_handoffs=handoffs)
        self.assertEqual(payload["branch_handoffs"], handoffs)
        self.assertIn(
            f"AgentWorkSpace/tasks/{self.TASK_ID}/handoffs/branch-handoffs.json",
            payload["provenance_sources"],
        )


if __name__ == "__main__":
    unittest.main()
