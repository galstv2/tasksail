"""Pure validation functions for reinforcement payloads."""
from __future__ import annotations

from .models import DIFFICULTY_REWARDS, TaskLedgerEntry

VALID_FEEDPMCK_TYPES = {"none", "positive", "negative"}
VALID_FEEDBACK_TYPES = VALID_FEEDPMCK_TYPES


def validate_task_completion(payload: dict[str, object]) -> list[str]:
    """Return a list of validation error strings (empty = valid)."""
    errors: list[str] = []
    task_id = payload.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        errors.append("task_id is required and must be a non-empty string")
    difficulty = payload.get("difficulty")
    if not isinstance(difficulty, str) or difficulty not in DIFFICULTY_REWARDS:
        errors.append(
            f"difficulty must be one of: {', '.join(sorted(DIFFICULTY_REWARDS))}; "
            f"got {difficulty!r}"
        )
    quality = payload.get("quality_outcome", "success")
    if quality not in ("success", "error"):
        errors.append(
            f"quality_outcome must be 'success' or 'error'; got {quality!r}"
        )
    return errors


def validate_no_double_reward(
    task_id: str,
    ledger: list[TaskLedgerEntry],
) -> str | None:
    """Return an error message if *task_id* already exists in the ledger."""
    for entry in ledger:
        if entry.task_id == task_id:
            return f"Task '{task_id}' is already recorded in the ledger"
    return None


def validate_feedback(payload: dict[str, object]) -> list[str]:
    """Validate a feedback submission payload."""
    errors: list[str] = []
    task_id = payload.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        errors.append("task_id is required and must be a non-empty string")
    fb_type = payload.get("feedback_type")
    if fb_type is None:
        fb_type = payload.get("feedpmck_type")
    if fb_type not in VALID_FEEDBACK_TYPES:
        errors.append(
            f"feedback_type must be one of: {', '.join(sorted(VALID_FEEDBACK_TYPES))}; "
            f"got {fb_type!r}"
        )
    star = payload.get("star_rating")
    if star is not None:
        if not isinstance(star, int) or not (1 <= star <= 5):
            errors.append("star_rating must be an integer between 1 and 5")
    return errors


def validate_feedpmck(payload: dict[str, object]) -> list[str]:
    return validate_feedback(payload)


def validate_settlement_eligibility(
    unrewarded_entries: list[TaskLedgerEntry],
) -> str | None:
    """Return an error message if settlement cannot proceed."""
    if not unrewarded_entries:
        return "No unrewarded tasks available for settlement"
    return None
