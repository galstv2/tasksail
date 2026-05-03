"""Regression tests for task archive markdown rendering."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
_SCRIPTS_PYTHON = _REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.archive.task_summary import build_task_archive_markdown  # noqa: E402

REFERENCE_BULLETS = [
    "Extracted `/items` behavior into `services/Acme.Api/Handlers/InventoryHandler.cs`.",
    "Extracted `/users` behavior into `services/Acme.Api/Handlers/CustomersHandler.cs`.",
    "Extracted `/orders` list/create/get/confirm/cancel behavior and `Seed(Order order)` into `services/Acme.Api/Handlers/OrdersHandler.cs`.",
    "Reduced `services/Acme.Api/Routes.cs` to route registration for health, inventory, customer, and order endpoints.",
    "Updated `services/Acme.Api/App.cs` to create one handler instance per resource and preserve the order seeding seam used by tests.",
]


def _base_payload(**overrides) -> dict:
    payload = {
        "task_title": "Sample task",
        "task_id": "TEST-1",
        "workflow_path": "standard",
        "difficulty_level": "Medium",
        "qa_status": "passed",
        "test_status": "passed",
        "context_pack_id": "ctx",
        "indexed_at": "2026-05-03T00:00:00Z",
        "business_goal": "Goal text.",
        "completed_work_summary": "fallback prose",
        "key_decisions": ["decision A"],
        "known_limitations": ["None."],
        "test_result_summary": "All tests passed.",
        "rollout_notes": "None.",
        "followup_refs": ["None."],
        "touched_files": ["file A"],
        "advisory_finding": "",
    }
    payload.update(overrides)
    return payload


class CompletedWorkRenderingTests(unittest.TestCase):
    def test_completed_work_renders_as_list_when_items_present(self) -> None:
        payload = _base_payload(completed_work_items=["A", "B", "C"])
        output = build_task_archive_markdown(payload)
        self.assertIn("## Completed Work\n\n- A\n- B\n- C", output)

    def test_completed_work_falls_back_to_summary_when_items_absent(self) -> None:
        payload = _base_payload(completed_work_summary="prose")
        payload.pop("completed_work_items", None)
        output = build_task_archive_markdown(payload)
        self.assertIn("## Completed Work\n\nprose", output)

    def test_completed_work_regression_reference_task(self) -> None:
        expected_block = "\n".join([
            "## Completed Work",
            "",
            "- Extracted `/items` behavior into `services/Acme.Api/Handlers/InventoryHandler.cs`.",
            "- Extracted `/users` behavior into `services/Acme.Api/Handlers/CustomersHandler.cs`.",
            "- Extracted `/orders` list/create/get/confirm/cancel behavior and `Seed(Order order)` into `services/Acme.Api/Handlers/OrdersHandler.cs`.",
            "- Reduced `services/Acme.Api/Routes.cs` to route registration for health, inventory, customer, and order endpoints.",
            "- Updated `services/Acme.Api/App.cs` to create one handler instance per resource and preserve the order seeding seam used by tests.",
            "",
        ])
        payload = _base_payload(
            task_title="platform / services/Acme.Api/Routes.cs (file)",
            task_id="20260503t062140z_platform-services-acme-api-routes-cs-file",
            completed_work_items=REFERENCE_BULLETS,
            completed_work_summary="Extracted /items behavior into ...endp...",
        )
        output = build_task_archive_markdown(payload)
        self.assertIn(expected_block, output)
        self.assertNotIn("endp...", output)
        self.assertNotIn("; Extracted", output)


class AdvisoryFindingPlacementTests(unittest.TestCase):
    def test_advisory_finding_appears_last(self) -> None:
        payload = _base_payload(
            completed_work_items=["X"],
            advisory_finding="Reviewer note: foo.",
        )
        output = build_task_archive_markdown(payload)
        advisory_pos = output.index("## QA Advisory Finding")
        for other_heading in (
            "## Business Goal",
            "## Completed Work",
            "## Key Design Decisions",
            "## Known Limitations",
            "## Test Result Summary",
            "## Rollout or Operational Notes",
            "## Follow-Up Backlog",
        ):
            self.assertIn(other_heading, output, f"missing heading: {other_heading}")
            self.assertLess(
                output.index(other_heading),
                advisory_pos,
                f"{other_heading} must precede QA Advisory Finding",
            )

    def test_advisory_finding_omitted_when_empty(self) -> None:
        payload = _base_payload(completed_work_items=["X"], advisory_finding="")
        output = build_task_archive_markdown(payload)
        self.assertNotIn("## QA Advisory Finding", output)


class HeadingNamesTests(unittest.TestCase):
    def test_post_patch_renderer_emits_template_heading_names(self) -> None:
        payload = _base_payload(completed_work_items=["X"])
        output = build_task_archive_markdown(payload)
        for expected in (
            "## Key Design Decisions",
            "## Test Result Summary",
            "## Rollout or Operational Notes",
            "## Follow-Up Backlog",
        ):
            self.assertIn(expected, output)
        for legacy in (
            "## Key Decisions",
            "## Test Results",
            "## Rollout Notes",
            "## Follow-Up Items",
        ):
            self.assertNotIn(legacy, output)


if __name__ == "__main__":
    unittest.main()
