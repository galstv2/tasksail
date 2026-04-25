"""Fairness framing and Global Realignment Document management."""
from __future__ import annotations

from typing import Any

from src.backend.scripts.python.lib.time import current_utc_timestamp

from .models import GlobalRealignmentDocument, RealignmentSession
from .persistence import ReinforcementStore


class VersionConflictError(Exception):
    """Raised when expected_version does not match the current document version."""

    def __init__(self, expected: int, actual: int) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"Version conflict: expected {expected}, but document is at version {actual}."
        )


DEFAULT_FAIRNESS_FRAMING = [
    "Role weighting reflects system design, not status.",
    "Fairness means consistent rule application, not equal reward amounts.",
    "All roles contribute differently but remain necessary.",
    "Reward differences are based on role function, not worth.",
]


class FairnessManager:
    """Manages the Global Realignment Document and fairness framing."""

    def __init__(self, store: ReinforcementStore) -> None:
        self._store = store

    def load_global_document(self) -> GlobalRealignmentDocument:
        """Load the global document, returning defaults if absent."""
        doc = self._store.load_global_realignment_document()
        if doc.version == 0 and not doc.fairness_framing:
            doc.fairness_framing = list(DEFAULT_FAIRNESS_FRAMING)
        return doc

    def update_global_document(
        self,
        updates: dict[str, Any],
    ) -> GlobalRealignmentDocument:
        """Apply field-level updates and increment the version.

        If ``expected_version`` is present in *updates*, the current
        document version must match before the write is applied.
        Raises ``VersionConflictError`` on mismatch.
        """
        expected_version = updates.get("expected_version")
        doc = self._store.load_global_realignment_document()

        if expected_version is not None and doc.version != expected_version:
            raise VersionConflictError(expected_version, doc.version)

        for list_field in (
            "standing_expectations",
            "lessons_learned",
            "behavioral_guidance",
            "fairness_framing",
        ):
            if list_field in updates:
                setattr(doc, list_field, list(updates[list_field]))

        doc.version += 1
        doc.updated_at = current_utc_timestamp()
        self._store.save_global_realignment_document(doc)
        return doc

    def inject_fairness_framing(self) -> list[str]:
        """Return the current fairness framing lines for agent injection."""
        doc = self.load_global_document()
        return list(doc.fairness_framing) if doc.fairness_framing else list(DEFAULT_FAIRNESS_FRAMING)

    def apply_lessons_from_session(
        self,
        session: RealignmentSession,
    ) -> GlobalRealignmentDocument:
        """Promote corrective actions from a session into the global doc."""
        doc = self._store.load_global_realignment_document()
        if session.corrective_actions:
            for action in session.corrective_actions:
                if action not in doc.lessons_learned:
                    doc.lessons_learned.append(action)
        if session.root_cause:
            guidance = f"Avoid: {session.root_cause}"
            if guidance not in doc.behavioral_guidance:
                doc.behavioral_guidance.append(guidance)
        if not doc.fairness_framing:
            doc.fairness_framing = list(DEFAULT_FAIRNESS_FRAMING)
        doc.version += 1
        doc.updated_at = current_utc_timestamp()
        self._store.save_global_realignment_document(doc)
        return doc
