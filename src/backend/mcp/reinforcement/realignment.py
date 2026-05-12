"""Realignment workflow: session creation, updates, archival."""
from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Any

from src.backend.scripts.python.lib.time import current_utc_timestamp

from .models import RealignmentSession
from .persistence import ReinforcementStore


class RealignmentManager:
    """Manages realignment sessions triggered by negative feedback."""

    def __init__(self, store: ReinforcementStore) -> None:
        self._store = store

    def _find_session(
        self,
        realignment_id: str,
    ) -> RealignmentSession | None:
        """Look up a session by ID, returning ``None`` if not found."""
        for s in self._store.load_realignment_sessions():
            if s.realignment_id == realignment_id:
                return s
        return None

    def find_session(
        self,
        realignment_id: str,
    ) -> RealignmentSession | None:
        """Look up a session by ID, returning ``None`` if not found."""
        return self._find_session(realignment_id)

    @staticmethod
    def is_analyzable(session: RealignmentSession) -> bool:
        """Return whether a session can run analysis; reviewed uses --archive-reviewed."""
        return session.status in {"open", "error"}

    def start_session(
        self,
        trigger_task_id: str,
        trigger_feedback_id: str,
        participating_agents: list[str],
    ) -> RealignmentSession:
        """Create and persist a new realignment session."""
        session = RealignmentSession(
            realignment_id=f"RA-{uuid.uuid4().hex[:12]}",
            trigger_task_id=trigger_task_id,
            trigger_feedback_id=trigger_feedback_id,
            participating_agents=list(participating_agents),
            failure_analysis="",
            root_cause="",
            corrective_actions=[],
            status="open",
            meeting_notes="",
            created_at=current_utc_timestamp(),
        )
        self._store.save_realignment_session(session)
        return session

    def update_session(
        self,
        realignment_id: str,
        updates: dict[str, Any],
    ) -> RealignmentSession | None:
        """Apply updates to an existing session.

        Returns the updated session or ``None`` if not found.
        """
        target = self._find_session(realignment_id)
        if target is None:
            return None

        for key in (
            "failure_analysis",
            "root_cause",
            "meeting_notes",
            "status",
        ):
            if key in updates:
                setattr(target, key, updates[key])
        if "corrective_actions" in updates:
            target.corrective_actions = list(updates["corrective_actions"])
        if "participating_agents" in updates:
            target.participating_agents = list(updates["participating_agents"])

        self._store.save_realignment_session(target)
        return target

    def archive_session(self, realignment_id: str) -> dict[str, Any]:
        """Mark a session as archived and persist its meeting notes.

        Returns a result dict with ``status`` and ``notes_path``.
        """
        target = self._find_session(realignment_id)
        if target is None:
            return {"status": "not_found"}

        archived = replace(target, status="archived")
        notes_md = self.build_archive_notes(archived)
        notes_path = self._store.save_realignment_notes(realignment_id, notes_md)
        self._store.save_realignment_session(archived)
        return {
            "status": "archived",
            "notes_path": str(notes_path),
            "session": archived.as_dict(),
        }

    def archive_reviewed_session(self, session: RealignmentSession) -> dict[str, Any]:
        """Archive a reviewed session by writing notes before final status."""
        archived = replace(session, status="archived")
        notes_md = self.build_archive_notes(archived)
        notes_path = self._store.save_realignment_notes(
            archived.realignment_id,
            notes_md,
        )
        self._store.save_realignment_session(archived)
        return {
            "status": "archived",
            "notes_path": str(notes_path),
            "session": archived.as_dict(),
        }

    def list_sessions(
        self,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return sessions, optionally filtered by status."""
        sessions = self._store.load_realignment_sessions()
        if status_filter:
            sessions = [s for s in sessions if s.status == status_filter]
        return [s.as_dict() for s in sessions]

    @staticmethod
    def _build_meeting_notes_markdown(session: RealignmentSession) -> str:
        """Render a session into structured meeting notes."""
        lines = [
            f"# Realignment Session: {session.realignment_id}",
            "",
            f"**Trigger task:** {session.trigger_task_id}",
            f"**Trigger feedback:** {session.trigger_feedback_id}",
            f"**Status:** {session.status}",
            f"**Created:** {session.created_at}",
            "",
            "## Participating Agents",
            "",
        ]
        for agent in session.participating_agents:
            lines.append(f"- {agent}")
        lines.extend([
            "",
            "## Failure Analysis",
            "",
            session.failure_analysis or "_Not yet provided._",
            "",
            "## Root Cause",
            "",
            session.root_cause or "_Not yet provided._",
            "",
            "## Corrective Actions",
            "",
        ])
        if session.corrective_actions:
            for action in session.corrective_actions:
                lines.append(f"- {action}")
        else:
            lines.append("_None recorded._")
        lines.extend([
            "",
            "## Meeting Notes",
            "",
            session.meeting_notes or "_No additional notes._",
            "",
        ])
        return "\n".join(lines)

    def build_archive_notes(self, session: RealignmentSession) -> str:
        """Render archive notes without mutating persisted session state."""
        return self._build_meeting_notes_markdown(session)
