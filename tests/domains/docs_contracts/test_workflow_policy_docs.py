from __future__ import annotations

import unittest
from pathlib import Path


class WorkflowPolicyDocsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        docs = cls.repo_root / "docs" / "technical"
        cls.workflow_pipeline = (
            docs / "architecture" / "workflow-pipeline.md"
        ).read_text(encoding="utf-8")
        cls.agent_roster = (
            docs / "architecture" / "agent-roster-and-autonomy.md"
        ).read_text(encoding="utf-8")
        cls.context_pack = (
            docs / "architecture" / "context-pack-lifecycle.md"
        ).read_text(encoding="utf-8")
        cls.qmd = (
            docs / "architecture" / "qmd-storage-and-memory.md"
        ).read_text(encoding="utf-8")
        cls.workflow_policy = (
            docs / "platform-modules" / "workflow-policy.md"
        ).read_text(encoding="utf-8")
        cls.queue = (docs / "platform-modules" / "queue.md").read_text(
            encoding="utf-8"
        )
        cls.mcp = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((docs / "mcp").glob("*.md"))
        )
        cls.operations = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((docs / "operations").glob("*.md"))
        )
        cls.contributing = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((docs / "contributing").glob("*.md"))
        )
        cls.all_technical = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(docs.rglob("*.md"))
        )

    def test_workflow_docs_cover_registry_policy_and_closeout_boundaries(self) -> None:
        for phrase in (
            "Lily",
            "Alice",
            "Dalton",
            "Ron",
            "role-agent entrypoint",
            "workflow-policy checks",
            "task id",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.workflow_pipeline)

        for phrase in (
            "registry-owned",
            "Provider-neutral workflow roles",
            "GitHub Copilot is the shipped CLI provider",
            "Broad autonomous execution fails closed",
            "model ids",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.agent_roster)

        for phrase in (
            "runtime legality checks",
            "Guarded checks fail closed",
            "workflow-policy",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.workflow_policy)

    def test_queue_docs_cover_parallel_state_and_repair_surfaces(self) -> None:
        for phrase in (
            "more than one active task",
            "Active markers",
            "activating markers",
            "kill requests",
            "error items",
            "Closeout must specify a task id",
            "Repair commands",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.queue)

    def test_mcp_docs_cover_auth_header_env_and_launch_semantics(self) -> None:
        for phrase in (
            "POST routes require a configured token",
            "bearer authorization",
            "REPO_CONTEXT_MCP_REQUIRE_GET_AUTH",
            "Host and Origin",
            "TASKSAIL_LOCAL_MCP_ENABLED",
            "external_mcp_local_enabled",
            "whole-value environment references",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.mcp)

    def test_context_pack_and_qmd_docs_preserve_unresolved_source_seams(self) -> None:
        self.assertIn("Python parser-owned bootstrap command", self.context_pack)
        self.assertIn("discovery-root", self.context_pack)
        self.assertIn("unresolved source seam", self.qmd)
        self.assertIn("conventions filename", self.qmd)
        self.assertIn("reseed markers", self.qmd)
        self.assertIn("seed-state", self.qmd)

    def test_operations_and_contributing_docs_cover_current_validation_contracts(self) -> None:
        for phrase in (
            "direct local execution",
            "Docker and Podman remain optional",
            "TASKSAIL_CLI_PROVIDER",
            "model catalog",
            "repo-context auth token",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.operations)

        for phrase in (
            "pnpm run check-sizes",
            "pnpm run check-comments",
            "pnpm run check-open-source-readiness",
            "tests/test_manifest.json",
            "docs-check workflow",
            "Python backend services",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.contributing)

    def test_technical_docs_omit_unsupported_legacy_claims(self) -> None:
        forbidden = (
            "the wrapper is the canonical enforcement seam",
            "wrapper-only enforcement replaces the workflow-policy validator",
            "retrospective transcripts are stored as raw chat logs",
            "retrospective memory replaces context-pack-scoped task archives",
            "--bootstrap-answers-file",
            "plan-followup-task",
            "watch-dropbox",
            "agent:status",
            "agent:kill",
            "gpt-5.4",
            "claude-sonnet-4.6",
        )
        for phrase in forbidden:
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, self.all_technical)


if __name__ == "__main__":
    unittest.main()
