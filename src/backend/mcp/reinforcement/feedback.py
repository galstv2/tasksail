"""Feedback interpretation: maps operator input to reinforcement states."""
from __future__ import annotations

from typing import Any

from .models import FeedbackEvent


class FeedbackInterpreter:
    """Stateless interpreter that classifies feedback events."""

    @staticmethod
    def interpret(event: FeedbackEvent) -> dict[str, Any]:
        """Classify a feedback event into an internal reinforcement state.

        Returns a dict with ``state`` and ``action`` keys.
        """
        if event.star_rating == 5:
            return {
                "state": "reward_trigger",
                "action": "settlement_trigger",
                "feedback_id": event.feedback_id,
            }

        if event.feedback_type == "negative":
            result: dict[str, Any] = {
                "state": "corrective",
                "action": "realignment_recommended",
                "feedback_id": event.feedback_id,
            }
            if event.star_rating is not None and event.star_rating <= 2:
                result["urgency"] = "high"
            else:
                result["urgency"] = "normal"
            return result

        if event.feedback_type == "positive":
            return {
                "state": "strong_approval",
                "action": "noted",
                "feedback_id": event.feedback_id,
            }

        return {
            "state": "acceptable",
            "action": "none",
            "feedback_id": event.feedback_id,
        }


FeedpmckEvent = FeedbackEvent
FeedpmckInterpreter = FeedbackInterpreter
