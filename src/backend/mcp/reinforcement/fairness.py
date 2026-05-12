"""Fairness framing and Global Realignment Document management."""
from __future__ import annotations

import re
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

FORBIDDEN_PROMOTION_PATTERNS = (
    re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b"),
    re.compile(r"(?:^|\s)(?:\.{0,2}/|[A-Za-z]:[\\/]|[A-Za-z0-9_.-]+[\\/])"),
    re.compile(r"\b[\w.-]+\.(?:ts|tsx|js|jsx|py|go|java|rs|md|json|ya?ml|toml)\b"),
    re.compile(r"\bline\s+\d+\b", re.IGNORECASE),
    re.compile(r":\d+(?::\d+)?\b"),
    re.compile(r"\b(?:traceback|stack trace)\b", re.IGNORECASE),
    re.compile(r"^\s*at\s+\S+", re.IGNORECASE),
    re.compile(r"`[^`]+`|=>|[{;}]\s*$"),
)


def _normalize_guidance(value: str) -> str:
    return " ".join(value.strip().split())


def _dedupe_key(value: str) -> str:
    return _normalize_guidance(value).casefold()


def _is_reusable_guidance(value: str) -> bool:
    text = _normalize_guidance(value)
    if not text:
        return False
    return not any(pattern.search(text) for pattern in FORBIDDEN_PROMOTION_PATTERNS)


def _sanitize_guidance(value: str) -> str | None:
    text = _normalize_guidance(value)
    if not _is_reusable_guidance(text):
        return None
    return text


def _append_unique_guidance(entries: list[str], value: str) -> None:
    sanitized = _sanitize_guidance(value)
    if sanitized is None:
        return
    existing = {_dedupe_key(entry) for entry in entries}
    if _dedupe_key(sanitized) not in existing:
        entries.append(sanitized)


def _compact_guidance(entries: list[str], max_entries: int) -> list[str]:
    kept_reversed: list[str] = []
    seen: set[str] = set()
    for entry in reversed(entries):
        sanitized = _sanitize_guidance(entry)
        if sanitized is None:
            continue
        key = _dedupe_key(sanitized)
        if key in seen:
            continue
        seen.add(key)
        kept_reversed.append(sanitized)
        if len(kept_reversed) >= max_entries:
            break
    return list(reversed(kept_reversed))


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
                _append_unique_guidance(doc.lessons_learned, action)
        if session.root_cause:
            guidance = f"Avoid: {session.root_cause}"
            _append_unique_guidance(doc.behavioral_guidance, guidance)
        if not doc.fairness_framing:
            doc.fairness_framing = list(DEFAULT_FAIRNESS_FRAMING)
        doc.version += 1
        doc.updated_at = current_utc_timestamp()
        self._store.save_global_realignment_document(doc)
        return doc

    def compact_global_document(
        self,
        max_entries: int = 25,
    ) -> GlobalRealignmentDocument:
        """Compact budgeted GRD lists without incrementing the version."""
        doc = self._store.load_global_realignment_document()
        original_lessons = list(doc.lessons_learned)
        original_guidance = list(doc.behavioral_guidance)
        doc.lessons_learned = _compact_guidance(doc.lessons_learned, max_entries)
        doc.behavioral_guidance = _compact_guidance(
            doc.behavioral_guidance, max_entries,
        )
        if (
            doc.lessons_learned != original_lessons
            or doc.behavioral_guidance != original_guidance
        ):
            doc.updated_at = current_utc_timestamp()
            self._store.save_global_realignment_document(doc)
        return doc
