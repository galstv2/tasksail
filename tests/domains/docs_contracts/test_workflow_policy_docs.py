from __future__ import annotations

import unittest
from pathlib import Path


class WorkflowPolicyDocsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.legacy_workflow_steps_dir = (
            cls.repo_root
            / "docs"
            / "ImplementationSteps"
            / "WorkflowPolicyEnforcementSteps"
        )
        cls.readme = (cls.repo_root / "README.md").read_text(
            encoding="utf-8",
        )
        cls.onboarding = (
            cls.repo_root / "docs" / "getting-started" / "onboarding.md"
        ).read_text(encoding="utf-8")
        cls.operating_model = (
            cls.repo_root / "docs" / "workflow" / "operating-model.md"
        ).read_text(encoding="utf-8")
        cls.platform_spec = (
            cls.repo_root / "docs" / "architecture" / "platform-spec.md"
        ).read_text(encoding="utf-8")
        cls.context_pack_model = (
            cls.repo_root / "docs" / "architecture" / "context-pack-model.md"
        ).read_text(encoding="utf-8")
        cls.qmd_memory_model = (
            cls.repo_root / "docs" / "qmd" / "memory-model.md"
        ).read_text(encoding="utf-8")
        cls.qmd_metadata_schema = (
            cls.repo_root / "docs" / "qmd" / "metadata-schema.md"
        ).read_text(encoding="utf-8")
        cls.qmd_task_filing_system = (
            cls.repo_root / "docs" / "qmd" / "task-filing-system.md"
        ).read_text(encoding="utf-8")

    # (doc_attr, phrase) tuples — every phrase must appear in the named doc.
    _POSITIVE_ASSERTIONS: list[tuple[str, str]] = [
        # Workflow policy runtime references across core docs
        ("readme", "src/backend/platform/workflow-policy/cli.ts"),
        ("readme", "fail closed"),
        ("readme", "pnpm run local-checks"),
        ("readme", ".platform-state/runtime/guardrails/"),
        ("onboarding", "src/backend/platform/workflow-policy/cli.ts"),
        ("onboarding", "fail closed"),
        ("onboarding", "pnpm run local-checks"),
        ("onboarding", ".platform-state/runtime/guardrails/"),
        ("platform_spec", "canonical enforcement seam"),
        ("platform_spec", "CI validation run fail closed"),
        ("platform_spec", ".platform-state/runtime/guardrails/"),
        ("operating_model", "canonical enforcement seam"),
        ("operating_model", ".platform-state/runtime/guardrails/"),
        # Agents as first-class platform layer
        ("readme", ".github/agents/"),
        ("readme", ".github/agents/registry.json"),
        ("onboarding", ".github/agents/"),
        ("onboarding", ".github/agents/registry.json"),
        ("operating_model", ".github/agents/"),
        ("operating_model", ".github/agents/registry.json"),
        ("platform_spec", ".github/agents/"),
        ("platform_spec", ".github/agents/registry.json"),
        # QMD retrospective paths
        (
            "context_pack_model",
            "qmd/context-packs/{context-pack-id}/archive/"
            "retrospectives/{repo}/{year}/{task-id}/retrospective.md",
        ),
        ("context_pack_model", "qmd/global/retrospectives"),
        ("qmd_memory_model", "qmd/global/retrospectives/shared-retrospective-memory.md"),
        ("qmd_task_filing_system", "qmd/global/retrospectives/history/{year}/{task-id}/retrospective.md"),
        ("qmd_task_filing_system", "retrospective.md.record.json"),
        # Retrospective as required closeout gate
        ("readme", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md"),
        ("onboarding", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md"),
        ("operating_model", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md"),
        ("platform_spec", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md"),
        ("qmd_task_filing_system", "AgentWorkSpace/tasks/<taskId>/handoffs/retrospective-input.md"),
        ("readme", "fail closed"),
        ("onboarding", "fail closed"),
        ("operating_model", "closeout can archive or advance the queue"),
        ("platform_spec", "same fail-closed retrospective gate"),
        # Context-pack conventions contract
        ("qmd_metadata_schema", "summary_scope: context-pack"),
        ("qmd_metadata_schema", "codebase-conventions.md"),
        ("qmd_metadata_schema", "codebase-conventions.md.record.json"),
        ("qmd_metadata_schema", "context-pack guidance memory"),
        (
            "context_pack_model",
            "qmd/context-packs/{context-pack-id}/canonical/"
            "context-pack/codebase-conventions.md",
        ),
        ("context_pack_model", "not a bootstrap questionnaire answer"),
        ("context_pack_model", "deferred state"),
    ]

    def test_docs_contain_required_workflow_policy_concepts(self) -> None:
        for attr, phrase in self._POSITIVE_ASSERTIONS:
            with self.subTest(doc=attr, phrase=phrase[:60]):
                self.assertIn(phrase, getattr(self, attr))

    _NEGATIVE_ASSERTIONS: list[tuple[str, list[str]]] = [
        # Removed workflow-policy steps tree must stay absent
        (
            "docs/ImplementationSteps/WorkflowPolicyEnforcementSteps",
            ["readme", "onboarding", "operating_model", "platform_spec"],
        ),
        (
            "WorkflowPolicyEnforcementSteps/README.md",
            ["readme", "onboarding", "operating_model", "platform_spec"],
        ),
        (
            "slice-06-regression-hardening-and-rollout-tightening.md",
            ["readme", "onboarding", "operating_model", "platform_spec"],
        ),
        # Unsupported enforcement claims
        (
            "the wrapper is the canonical enforcement seam",
            ["readme", "onboarding", "operating_model", "platform_spec"],
        ),
        (
            "wrapper-only enforcement replaces the workflow-policy validator",
            ["readme", "onboarding", "operating_model", "platform_spec"],
        ),
        (
            "direct `copilot --agent <agent-id>` remains an intentional bypass path",
            ["readme", "onboarding", "operating_model", "platform_spec"],
        ),
        # Stale future-tense references
        (
            "planned canonical enforcement seam",
            ["onboarding", "operating_model", "platform_spec"],
        ),
        (
            "During the current documentation-first phase",
            ["onboarding", "operating_model", "platform_spec"],
        ),
        (
            "Once the validator runtime lands",
            ["onboarding", "operating_model", "platform_spec"],
        ),
        (
            "Until the validator runtime lands",
            ["onboarding", "operating_model", "platform_spec"],
        ),
        (
            "future workflow-policy checks fail",
            ["onboarding", "operating_model", "platform_spec"],
        ),
        (
            "should eventually treat the bootstrap answers",
            ["onboarding", "operating_model", "platform_spec"],
        ),
        # Unsupported retrospective behavior claims
        (
            "retrospective transcripts are stored as raw chat logs",
            [
                "readme", "onboarding", "operating_model", "platform_spec",
                "context_pack_model", "qmd_memory_model",
                "qmd_metadata_schema", "qmd_task_filing_system",
            ],
        ),
        (
            "retrospective memory replaces context-pack-scoped task archives",
            [
                "readme", "onboarding", "operating_model", "platform_spec",
                "context_pack_model", "qmd_memory_model",
                "qmd_metadata_schema", "qmd_task_filing_system",
            ],
        ),
        (
            "retrospective retrieval outranks active repo or handoff state",
            [
                "readme", "onboarding", "operating_model", "platform_spec",
                "context_pack_model", "qmd_memory_model",
                "qmd_metadata_schema", "qmd_task_filing_system",
            ],
        ),
    ]

    def test_removed_workflow_steps_dir_stays_absent(self) -> None:
        self.assertFalse(self.legacy_workflow_steps_dir.exists())

    def test_docs_omit_stale_or_unsupported_claims(self) -> None:
        for phrase, doc_attrs in self._NEGATIVE_ASSERTIONS:
            for attr in doc_attrs:
                with self.subTest(doc=attr, phrase=phrase[:60]):
                    self.assertNotIn(phrase, getattr(self, attr))

    def test_docs_describe_retrospective_sidecar_schema(self) -> None:
        expected_phrases = [
            "task-retrospective",
            "global-retrospective-entry",
            "global-retrospective-memory",
            "agent_contributions",
            "synthesized_from_task_ids",
        ]
        for phrase in expected_phrases:
            self.assertIn(phrase, self.qmd_metadata_schema)


if __name__ == "__main__":
    unittest.main()
