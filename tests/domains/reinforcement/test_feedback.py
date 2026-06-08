"""Tests for FeedbackInterpreter."""
from __future__ import annotations

from .registry_skip import skip_if_agent_registry_missing

skip_if_agent_registry_missing()

from src.backend.mcp.reinforcement.feedback import FeedbackInterpreter
from src.backend.mcp.reinforcement.models import FeedbackEvent


def _event(
    feedback_type: str = "none",
    star_rating: int | None = None,
) -> FeedbackEvent:
    return FeedbackEvent(
        feedback_id="FB-1", task_id="T-1",
        feedback_type=feedback_type, star_rating=star_rating,
        comment="", created_at="2026-01-01T00:00:00Z",
    )


class TestInterpret:
    def test_interpret_feedback_types(self) -> None:
        cases = [
            (
                "five_star_reward_trigger",
                _event("positive", 5),
                {"state": "reward_trigger", "action": "settlement_trigger"},
            ),
            (
                "negative_with_rating",
                _event("negative", 1),
                {"state": "corrective", "urgency": "high"},
            ),
            (
                "negative_no_rating",
                _event("negative"),
                {"state": "corrective", "urgency": "normal"},
            ),
            (
                "positive_strong_approval",
                _event("positive", 4),
                {"state": "strong_approval"},
            ),
            (
                "none_acceptable",
                _event("none"),
                {"state": "acceptable"},
            ),
        ]
        for label, event, expected_fields in cases:
            result = FeedbackInterpreter.interpret(event)
            for key, value in expected_fields.items():
                assert result[key] == value, (
                    f"{label}: expected {key}={value}, got {result[key]}"
                )
