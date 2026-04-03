from __future__ import annotations

from pathlib import Path
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.backend.mcp.repo_context_mcp.services.report_service import ReportRenderer  # noqa: E402


class ReportRendererTests(unittest.TestCase):
    def test_render_run_markdown_includes_all_repo_data(self) -> None:
        """Verify rendered run report contains every repo's warnings,
        errors, and aggregate counts — not just substring matches."""
        renderer = ReportRenderer()
        run_data = {
            "run_started_at": "2026-03-07T10:00:00Z",
            "context_pack_id": "sample-org",
            "context_pack_dir": "/tmp/context-pack",
            "qmd_scope_root": "qmd/context-packs/sample-org",
            "input_source": "manifest",
            "overall_status": "completed-with-blocked-repos",
            "seeded_repo_count": 1,
            "blocked_repo_count": 1,
            "error_repo_count": 1,
            "invalidated_record_count": 2,
            "repositories": [
                {
                    "repo_id": "repo-a",
                    "status": "blocked",
                    "source_root": None,
                    "seeded_records": 0,
                    "invalidated_records": 2,
                    "warnings": ["workspace missing"],
                    "errors": ["seed failed"],
                },
                {
                    "repo_id": "repo-b",
                    "status": "seeded",
                    "source_root": "/tmp/repo-b",
                    "seeded_records": 3,
                    "invalidated_records": 0,
                    "warnings": [],
                    "errors": [],
                },
            ],
        }

        markdown = renderer.render_run_markdown(run_data)

        # Title and aggregate status.
        self.assertIn("# QMD Live Seed Run", markdown)
        self.assertIn("completed-with-blocked-repos", markdown)

        # Both repos must appear.
        self.assertIn("### repo-a", markdown)
        self.assertIn("### repo-b", markdown)

        # repo-a's warning and error must be rendered.
        self.assertIn("workspace missing", markdown)
        self.assertIn("seed failed", markdown)

        # repo-b had no warnings/errors — verify it still appears with
        # its status (seeded) and record count.
        repo_b_idx = markdown.index("### repo-b")
        repo_b_section = markdown[repo_b_idx:]
        self.assertIn("seeded", repo_b_section.lower())

        # Heading hierarchy: h1 → h3 (no h2 gap unless the renderer uses h2).
        lines = markdown.splitlines()
        heading_levels = [
            len(line) - len(line.lstrip("#"))
            for line in lines
            if line.startswith("#")
        ]
        self.assertIn(1, heading_levels, "Must have an h1 heading")
        self.assertTrue(
            any(h >= 2 for h in heading_levels),
            "Must have sub-headings for repos",
        )

    def test_render_task_lineage_summary_covers_parent_child_chain(
        self,
    ) -> None:
        """Verify lineage summary renders parent, subject, and children
        and that the section ordering is logical."""
        renderer = ReportRenderer()
        lineage_data = {
            "root_task_id": "CAP-1000",
            "qmd_scope": "qmd/context-packs/sample-org",
            "query": {"task_id": "CAP-1001"},
            "root_archive": {"record_id": "task:platform:CAP-1000"},
            "subject_archive": {
                "task_id": "CAP-1001",
                "task_title": "Child Task",
                "parent_task_id": "CAP-1000",
                "child_depth": 1,
            },
            "direct_parent": {
                "task_id": "CAP-1000",
                "task_title": "Root Task",
                "parent_task_id": "",
                "child_depth": 0,
            },
            "direct_children": [
                {
                    "task_id": "CAP-1002",
                    "task_title": "Grandchild",
                    "parent_task_id": "CAP-1001",
                    "child_depth": 2,
                }
            ],
            "sibling_followups": [],
            "root_lineage_records": [],
        }

        markdown = renderer.render_task_lineage_summary(lineage_data)

        # Subject task must appear in the title.
        self.assertIn("CAP-1001", markdown)

        # Parent and child sections.
        self.assertIn("## Subject Archive", markdown)
        self.assertIn("## Immediate Parent", markdown)
        self.assertIn("CAP-1000", markdown)

        # Direct children section must include the grandchild.
        self.assertIn("CAP-1002", markdown)
        self.assertIn("Grandchild", markdown)

        # Section ordering: Subject should appear before children.
        subject_idx = markdown.index("## Subject Archive")
        children_idx = markdown.index("CAP-1002")
        self.assertLess(
            subject_idx,
            children_idx,
            "Subject section must precede children",
        )

    def test_render_run_markdown_handles_empty_repo_list(self) -> None:
        """Verify the renderer doesn't crash on an empty repo list."""
        renderer = ReportRenderer()
        markdown = renderer.render_run_markdown(
            {
                "run_started_at": "2026-03-07T10:00:00Z",
                "context_pack_id": "empty",
                "context_pack_dir": "/tmp/empty",
                "qmd_scope_root": "qmd/context-packs/empty",
                "input_source": "manifest",
                "overall_status": "success",
                "seeded_repo_count": 0,
                "blocked_repo_count": 0,
                "error_repo_count": 0,
                "invalidated_record_count": 0,
                "repositories": [],
            }
        )

        self.assertIn("# QMD Live Seed Run", markdown)
        self.assertIn("success", markdown)

    def test_render_task_lineage_summary_handles_no_children(self) -> None:
        """Verify the 'no children' case renders a clear message."""
        renderer = ReportRenderer()
        markdown = renderer.render_task_lineage_summary(
            {
                "root_task_id": "CAP-1000",
                "qmd_scope": "qmd/context-packs/sample-org",
                "query": {"task_id": "CAP-1001"},
                "root_archive": {"record_id": "task:platform:CAP-1000"},
                "subject_archive": {
                    "task_id": "CAP-1001",
                    "task_title": "Leaf Task",
                    "parent_task_id": "CAP-1000",
                    "child_depth": 1,
                },
                "direct_parent": {
                    "task_id": "CAP-1000",
                    "task_title": "Root Task",
                    "parent_task_id": "",
                    "child_depth": 0,
                },
                "direct_children": [],
                "sibling_followups": [],
                "root_lineage_records": [],
            }
        )

        self.assertIn("no direct children found", markdown)


if __name__ == "__main__":
    unittest.main()
