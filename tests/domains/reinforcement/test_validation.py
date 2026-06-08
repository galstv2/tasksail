"""Tests for reinforcement validation functions."""
from __future__ import annotations

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

from src.backend.mcp.reinforcement.validation import (
    validate_feedback,
    validate_settlement_eligibility,
    validate_task_completion,
)

from .conftest import make_entry


class TestValidation:
    def test_validate_task_completion(self) -> None:
        cases = [
            ("valid", {"task_id": "T-1", "difficulty": "easy"}, []),
            ("missing_task_id", {"difficulty": "easy"}, ["task_id"]),
            ("invalid_difficulty", {"task_id": "T-1", "difficulty": "extreme"}, ["difficulty"]),
            (
                "invalid_quality",
                {"task_id": "T-1", "difficulty": "easy", "quality_outcome": "unknown"},
                ["quality_outcome"],
            ),
        ]
        for label, payload, expected_keywords in cases:
            errors = validate_task_completion(payload)
            if not expected_keywords:
                assert errors == [], f"{label}: expected no errors, got {errors}"
            else:
                for kw in expected_keywords:
                    assert any(kw in e for e in errors), (
                        f"{label}: expected keyword '{kw}' in errors {errors}"
                    )

    def test_validate_feedback(self) -> None:
        cases = [
            (
                "valid",
                {"task_id": "T-1", "feedback_type": "positive", "star_rating": 5},
                [],
            ),
            (
                "invalid_type",
                {"task_id": "T-1", "feedback_type": "bad"},
                ["feedback_type"],
            ),
            (
                "star_out_of_range",
                {"task_id": "T-1", "feedback_type": "positive", "star_rating": 6},
                ["star_rating"],
            ),
        ]
        for label, payload, expected_keywords in cases:
            errors = validate_feedback(payload)
            if not expected_keywords:
                assert errors == [], f"{label}: expected no errors, got {errors}"
            else:
                for kw in expected_keywords:
                    assert any(kw in e for e in errors), (
                        f"{label}: expected keyword '{kw}' in errors {errors}"
                    )

    def test_settlement_eligibility(self) -> None:
        # Eligible
        assert validate_settlement_eligibility([make_entry()]) is None

        # Empty list
        err = validate_settlement_eligibility([])
        assert err is not None
        assert "No unrewarded" in err
