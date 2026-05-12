#!/usr/bin/env python3
"""CLI entrypoint: ingest standalone realignment analysis."""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.backend.mcp.reinforcement.fairness import FairnessManager
from src.backend.mcp.reinforcement.models import RealignmentSession
from src.backend.mcp.reinforcement.persistence import ReinforcementStore
from src.backend.mcp.reinforcement.realignment import RealignmentManager


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest standalone corrective realignment analysis",
    )
    parser.add_argument("--repo-root", default=str(ROOT_DIR))
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--realignment-id", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--stdin", action="store_true", dest="stdin_mode")
    mode.add_argument("--mark-error", action="store_true")
    mode.add_argument("--archive-reviewed", action="store_true")
    parser.add_argument("--reason", default="")
    return parser.parse_args(argv)


def _load_payload() -> dict[str, Any]:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid stdin payload: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise ValueError("invalid stdin payload: expected object")
    corrective_actions = payload.get("corrective_actions")
    if not isinstance(corrective_actions, list) or not all(
        isinstance(action, str) for action in corrective_actions
    ):
        raise ValueError("invalid stdin payload: corrective_actions must be strings")
    for key in (
        "failure_analysis",
        "root_cause",
        "validation_notes",
        "meeting_notes",
    ):
        if not isinstance(payload.get(key), str):
            raise ValueError(f"invalid stdin payload: {key} must be a string")
    return payload


def _meeting_notes(validation_notes: str, supplied_notes: str) -> str:
    parts = [f"Validation Notes: {validation_notes.strip()}"]
    if supplied_notes.strip():
        parts.extend(["", supplied_notes.strip()])
    return "\n".join(parts)


def _require_analyzable(
    manager: RealignmentManager,
    realignment_id: str,
) -> RealignmentSession:
    session = manager.find_session(realignment_id)
    if session is None:
        print("session not found", file=sys.stderr)
        raise SystemExit(2)
    if not manager.is_analyzable(session):
        print("session not analyzable", file=sys.stderr)
        raise SystemExit(3)
    return session


def _mark_error(manager: RealignmentManager, realignment_id: str, reason: str) -> int:
    session = _require_analyzable(manager, realignment_id)
    reason = reason.strip()
    notes = session.meeting_notes.rstrip()
    addition = f"Error: {reason}" if reason else "Error"
    updated_notes = f"{notes}\n\n{addition}" if notes else addition
    updated = manager.update_session(
        realignment_id,
        {"status": "error", "meeting_notes": updated_notes},
    )
    print(json.dumps({
        "realignment_id": realignment_id,
        "status": "error",
        "session": updated.as_dict() if updated is not None else None,
    }, indent=2))
    return 0


def _archive_reviewed(
    store: ReinforcementStore,
    manager: RealignmentManager,
    realignment_id: str,
) -> int:
    session = manager.find_session(realignment_id)
    if session is None:
        print("session not found", file=sys.stderr)
        raise SystemExit(2)
    if session.status != "reviewed":
        print("session not reviewed", file=sys.stderr)
        raise SystemExit(3)

    doc = store.load_global_realignment_document()
    try:
        archive = manager.archive_reviewed_session(session)
    except Exception as exc:
        print(json.dumps({
            "realignment_id": realignment_id,
            "status": "partial",
            "reason": "promotion_committed_archive_failed",
            "detail": str(exc),
            "global_realignment_version": doc.version,
        }, indent=2))
        return 1

    print(json.dumps({
        "realignment_id": realignment_id,
        "status": "archived",
        "global_realignment_version": doc.version,
        "notes_path": archive["notes_path"],
        "session": archive["session"],
    }, indent=2))
    return 0


def _ingest(
    store: ReinforcementStore,
    manager: RealignmentManager,
    fairness: FairnessManager,
    realignment_id: str,
) -> int:
    original = _require_analyzable(manager, realignment_id)
    try:
        payload = _load_payload()
        reviewed = replace(
            original,
            failure_analysis=payload["failure_analysis"],
            root_cause=payload["root_cause"],
            corrective_actions=list(payload["corrective_actions"]),
            status="reviewed",
            meeting_notes=_meeting_notes(
                payload["validation_notes"],
                payload["meeting_notes"],
            ),
        )
        manager.build_archive_notes(replace(reviewed, status="archived"))
        store.ensure_realignment_notes_dir_writable()
        store.save_realignment_session(reviewed)
        try:
            doc = fairness.apply_lessons_from_session(reviewed)
        except Exception:
            store.save_realignment_session(original)
            raise
    except SystemExit:
        raise
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    try:
        doc = fairness.compact_global_document()
        archive = manager.archive_reviewed_session(reviewed)
        print(json.dumps({
            "realignment_id": realignment_id,
            "status": "archived",
            "global_realignment_version": doc.version,
            "notes_path": archive["notes_path"],
            "session": archive["session"],
        }, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({
            "realignment_id": realignment_id,
            "status": "partial",
            "reason": "promotion_committed_archive_failed",
            "detail": str(exc),
            "global_realignment_version": doc.version,
        }, indent=2))
        return 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.mark_error and not args.reason:
        print("--reason is required with --mark-error", file=sys.stderr)
        return 1
    repo_root = Path(args.repo_root).resolve()
    context_pack_dir = Path(args.context_pack_dir).resolve()
    store = ReinforcementStore(
        repo_root,
        legacy_context_pack_dir=context_pack_dir,
    )
    manager = RealignmentManager(store)
    fairness = FairnessManager(store)
    if args.mark_error:
        return _mark_error(manager, args.realignment_id, args.reason)
    if args.archive_reviewed:
        return _archive_reviewed(store, manager, args.realignment_id)
    return _ingest(store, manager, fairness, args.realignment_id)


if __name__ == "__main__":
    raise SystemExit(main())
