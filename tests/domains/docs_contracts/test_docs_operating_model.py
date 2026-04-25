from __future__ import annotations

import unittest
from pathlib import Path


class DocsOperatingModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.readme = (cls.repo_root / "README.md").read_text(encoding="utf-8")
        cls.docs_index = (
            cls.repo_root / "docs" / "README.md"
        ).read_text(encoding="utf-8")
        cls.onboarding = (
            cls.repo_root / "docs" / "getting-started" / "onboarding.md"
        ).read_text(encoding="utf-8")
        cls.operating_model = (
            cls.repo_root / "docs" / "workflow" / "operating-model.md"
        ).read_text(encoding="utf-8")
        cls.platform_spec = (
            cls.repo_root / "docs" / "architecture" / "platform-spec.md"
        ).read_text(encoding="utf-8")

    # (doc_attr, phrase) tuples — every phrase must appear in the named doc.
    _REQUIRED_PLATFORM_CONCEPTS: list[tuple[str, str]] = [
        # README sections and commands
        ("readme", "## What this repo is"),
        ("readme", "## Prerequisites"),
        ("readme", "## Installation"),
        ("readme", "## Local auth expectations"),
        ("readme", "## How to start services"),
        ("readme", "## How to validate local setup"),
        ("readme", "## How to start the queue and seed a starter task"),
        ("readme", "## Workflow and handoff rules"),
        ("readme", "## QA routing rule"),
        ("readme", "## Troubleshooting"),
        ("readme", "## Security expectations"),
        ("readme", "## MCP endpoint config"),
        ("readme", "## External context packs"),
        (
            "readme",
            "tsx src/backend/platform/context-pack/cli.ts --context-pack-dir "
            "/path/to/context-pack",
        ),
        ("readme", "--bootstrap-answers-file"),
        ("readme", "pnpm run agent -- --agent-id <agent-id>"),
        # README agent invocation seam
        ("readme", ".github/agents/"),
        ("readme", ".github/agents/registry.json"),
        ("readme", "repository-managed entrypoint for approved workflow roles"),
        ("readme", "compliant repository-managed entrypoint"),
        ("readme", "reserved for controlled internal orchestrators"),
        ("readme", "raw named-agent invocation such as `copilot --agent <agent-id>`"),
        ("readme", ".platform-state/runtime/guardrails/"),
        # README task-scoped wrapper lifecycle
        ("readme", "fresh task-scoped `copilot --agent` subprocess"),
        ("readme", "does not add a task-end `/compact` hook"),
        # README autonomy profiles
        ("readme", "registry-backed autonomy profile"),
        ("readme", "`repo-executor`"),
        ("readme", "`artifact-author`"),
        (
            "readme",
            "dangerous commands such as `git add`, `git commit`, `git push`, `rm`",
        ),
        (
            "readme",
            "If no active context pack is present, broad\n"
            "  autonomous execution is denied",
        ),
        # README retrospective guardrails
        ("readme", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md"),
        ("readme", "target 1 minute and hard cap 2 minutes"),
        (
            "readme",
            "qmd/context-packs/{context-pack-id}/archive/retrospectives/"
            "{repo}/{year}/{task-id}/retrospective.md",
        ),
        ("readme", "qmd/global/retrospectives/history/{year}/{task-id}.md"),
        ("readme", "qmd/global/retrospectives/shared-retrospective-memory.md"),
        # README validation lanes
        ("readme", "make test-smoke"),
        ("readme", "make test-domain DOMAIN=..."),
        ("readme", "make test-contracts"),
        ("readme", "make local-checks"),
        ("readme", "changed-path domain lane for pull requests"),
        ("readme", "Python suite"),
        ("readme", "Docs Check"),
        # Onboarding starter-task walkthrough
        ("onboarding", "## Starter-task walkthrough"),
        ("onboarding", "pnpm run validate"),
        ("onboarding", "pnpm run watch-dropbox"),
        ("onboarding", "pnpm run plan-dropbox-task"),
        (
            "onboarding",
            "tsx src/backend/platform/context-pack/cli.ts --context-pack-dir "
            "/path/to/context-pack",
        ),
        ("onboarding", "--bootstrap-answers-file"),
        ("onboarding", "QMD"),
        ("onboarding", "pnpm run plan-followup-task"),
        ("onboarding", "parent_task_id"),
        ("onboarding", "root_task_id"),
        ("onboarding", "scoped carry-forward context only"),
        ("onboarding", "pnpm run agent -- --agent-id <agent-id>"),
        # Onboarding validation lanes
        ("onboarding", "make test-smoke"),
        ("onboarding", "make test-domain DOMAIN=workflow"),
        ("onboarding", "make test-contracts"),
        ("onboarding", "make local-checks"),
        ("onboarding", "docs-and-contract lane"),
        ("onboarding", "desktop shell"),
        ("onboarding", "Python suite"),
        # Operating model role flow
        ("operating_model", "Product Manager completes `AgentWorkSpace/tasks/<taskId>/handoffs/professional-task.md`"),
        ("operating_model", "AgentWorkSpace/tasks/<taskId>/handoffs/implementation-spec.md"),
        ("operating_model", "AgentWorkSpace/tasks/<taskId>/ImplementationSteps/sliceN.md"),
        ("operating_model", "QA → Software Engineer → QA"),
        ("operating_model", ".github/agents/"),
        ("operating_model", "pnpm run agent -- --agent-id <agent-id>"),
        ("operating_model", "product-manager"),
        ("operating_model", "software-engineer"),
        ("operating_model", "gpt-5.4"),
        ("operating_model", "tsx src/backend/platform/context-pack/cli.ts"),
        ("operating_model", "--bootstrap-repo-root"),
        ("operating_model", "Follow-up work after closeout becomes a new child task"),
        ("operating_model", "`parent_task_id`"),
        ("operating_model", "`root_task_id`"),
        # Operating model agent wrapper
        ("operating_model", ".github/agents/registry.json"),
        (
            "operating_model",
            "delegates runtime role legality checks to the workflow-policy validator",
        ),
        ("operating_model", "approved\n  launch seam"),
        ("operating_model", "machine-readable\n  runtime evidence"),
        ("operating_model", "wrapper is the compliant launch seam"),
        ("operating_model", ".platform-state/runtime/guardrails/"),
        # Operating model autonomy + retrospective
        ("operating_model", "registry-backed autonomy profile"),
        ("operating_model", "`repo-executor`"),
        ("operating_model", "`artifact-author`"),
        ("operating_model", "high-autonomy execution fails closed"),
        (
            "operating_model",
            "workflow team completes `AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md`",
        ),
        ("operating_model", "target 1 minute"),
        ("operating_model", "hard cap 2 minutes"),
        ("operating_model", "archive/retrospectives/{repo}/{year}/{task-id}/retrospective.md"),
        ("operating_model", "qmd/global/retrospectives/"),
        # Operating model wrapper lifecycle
        ("operating_model", "fresh task-scoped `copilot --agent`"),
        ("operating_model", "does not add an end-of-task `/compact` step"),
        # Operating model validation lanes
        ("operating_model", "make test-smoke"),
        ("operating_model", "make test-domain DOMAIN=<name>"),
        ("operating_model", "make test-contracts"),
        ("operating_model", "make local-checks"),
        ("operating_model", "changed-path domain lane for"),
        ("operating_model", "docs-and-contract lane"),
        ("operating_model", "desktop shell\n  contract checks"),
        ("operating_model", "Python suite"),
        # Platform spec source-of-truth
        ("platform_spec", "`AgentWorkSpace/dropbox/` is a trigger only."),
        ("platform_spec", "`AgentWorkSpace/pendingitems/` is the active queue."),
        ("platform_spec", "`AgentWorkSpace/tasks/<taskId>/handoffs/` is the active task workspace."),
        ("platform_spec", "QMD is the long-term agent memory archive."),
        ("platform_spec", "Parent-task QMD memory is scoped reference context"),
        ("platform_spec", "Follow-up work enters as a new child task"),
        ("platform_spec", "`parent_task_id`"),
        ("platform_spec", "`root_task_id`"),
        # Platform spec agent layer
        ("platform_spec", "workflow agent registry and profiles in `.github/agents/`"),
        ("platform_spec", ".github/agents/registry.json"),
        ("platform_spec", "pnpm run agent -- --agent-id <agent-id>"),
        # Platform spec retrospective
        ("platform_spec", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md` is a required closeout artifact"),
        ("platform_spec", "qmd/global/retrospectives"),
        ("platform_spec", "shared-retrospective-memory.md"),
        ("platform_spec", "/retrospective"),
        ("platform_spec", "/shared-retrospective-memory"),
        # Platform spec wrapper lifecycle
        ("platform_spec", "fresh task-scoped `copilot --agent`\nsubprocess"),
        ("platform_spec", "does not add an end-of-task\n`/compact` step"),
        # External MCP — operating model
        ("operating_model", "config/mcp-registry-external.default.json"),
        ("operating_model", ".platform-state/mcp-registry-external.json"),
        ("operating_model", "COPILOT_HOME"),
        ("operating_model", "visibility"),
        # External MCP — platform spec
        ("platform_spec", "config/mcp-registry-external.default.json"),
        ("platform_spec", ".platform-state/mcp-registry-external.json"),
        ("platform_spec", "per-launch"),
        ("platform_spec", "copilot-home"),
        ("platform_spec", "fail-closed"),
        ("platform_spec", "visibility"),
    ]

    def test_docs_contain_required_platform_concepts(self) -> None:
        for attr, phrase in self._REQUIRED_PLATFORM_CONCEPTS:
            with self.subTest(doc=attr, phrase=phrase[:60]):
                self.assertIn(phrase, getattr(self, attr))

    _STALE_REFERENCES: list[tuple[str, str]] = [
        ("docs_index", "## Plans"),
        ("docs_index", "ParallelAgentPlan/README.md"),
        ("docs_index", "AgentHardeningPlan/README.md"),
    ]

    def test_docs_omit_stale_references(self) -> None:
        for attr, phrase in self._STALE_REFERENCES:
            with self.subTest(doc=attr, phrase=phrase):
                self.assertNotIn(phrase, getattr(self, attr))

    def test_external_mcp_docs_do_not_overclaim(self) -> None:
        """External MCP docs must not claim .github/copilot is an MCP
        registration surface or promise guaranteed tool usage."""
        for doc_attr in ("operating_model", "platform_spec"):
            doc = getattr(self, doc_attr)
            with self.subTest(doc=doc_attr, check="no copilot registration claim"):
                self.assertNotIn(
                    ".github/copilot/ is used for MCP registration",
                    doc,
                )
            with self.subTest(doc=doc_attr, check="no guaranteed usage claim"):
                self.assertNotIn(
                    "guarantees tool usage",
                    doc,
                )


if __name__ == "__main__":
    unittest.main()
