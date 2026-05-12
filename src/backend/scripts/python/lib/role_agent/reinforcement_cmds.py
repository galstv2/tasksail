"""Reinforcement context rendering command."""
from __future__ import annotations

import argparse
import shlex
from pathlib import Path
from typing import Any

from src.backend.mcp.reinforcement.models import SETTLEMENT_STREAK_THRESHOLD
from src.backend.mcp.reinforcement.paths import (
    migrate_legacy_agent_reward_sidecars,
    migrate_legacy_reinforcement_store,
    resolve_agent_reward_file_for_read,
    resolve_store_file_for_read,
)
from src.backend.scripts.python.lib.io import load_json_safe
from src.backend.scripts.python.lib.registry import agent_names as _load_agent_names


def _load_json_file(path: Path) -> dict[str, Any] | None:
    """Load a JSON object, returning None on missing or malformed file."""
    try:
        payload, err = load_json_safe(path)
        if err is not None or payload is None:
            return None
        return payload
    except (FileNotFoundError, OSError):
        return None


def _count_unrewarded_successes(entries: list[dict[str, Any]]) -> int:
    """Count consecutive unrewarded success entries from the end."""
    count = 0
    for entry in reversed(entries):
        if (
            entry.get("settlement_status") == "unrewarded"
            and entry.get("quality_outcome") == "success"
        ):
            count += 1
        else:
            break
    return count


def _format_number(n: int) -> str:
    return f"{n:,}"


def _render_reward_standing(
    agent_entry: dict[str, Any],
    streak_progress: int,
) -> list[str]:
    lines = [
        "## Your Reward Standing",
        "",
        f"- Lifetime Reward: {_format_number(agent_entry.get('lifetime_reward', 0))}",
        f"- Streak Progress: {streak_progress} of {SETTLEMENT_STREAK_THRESHOLD}"
        " successful tasks toward your next reward checkpoint",
    ]
    lines.append("")
    return lines


def _render_recent_feedback(
    feedback_entries: list[dict[str, Any]],
) -> list[str]:
    if not feedback_entries:
        return []
    lines = ["## Recent Feedback", ""]
    for fb in feedback_entries[-3:]:
        task_id = fb.get("task_id", "unknown")
        fb_type = fb.get("feedback_type", "none")
        stars = fb.get("star_rating")
        parts = [fb_type]
        if stars is not None:
            parts = [f"{fb_type} ({stars} stars)"]
        comment = fb.get("comment", "")
        if comment:
            parts.append(f"\u2014 {comment}")
        lines.append(f"- Task {task_id}: {' '.join(parts)}")
    lines.append("")
    return lines


def _render_list_section(
    title: str,
    items: list[str],
) -> list[str]:
    if not items:
        return []
    lines = [f"## {title}", ""]
    for item in items:
        lines.append(f"- {item}")
    lines.append("")
    return lines


def cmd_render_reinforcement_context(args: argparse.Namespace) -> int:
    repo_root = Path(args.repo_root)
    agent_id: str = args.agent_id
    output_path = Path(args.output_path)
    export_path = Path(args.export_path)

    migrate_legacy_reinforcement_store(repo_root)
    migrate_legacy_agent_reward_sidecars(repo_root)

    # Prefer per-agent JSON sidecar (one file per agent, no peer data).
    per_agent_json = resolve_agent_reward_file_for_read(
        repo_root, f"{agent_id}.json",
    )
    agent_entry = _load_json_file(per_agent_json)

    if agent_entry is None:
        return _write_unavailable(
            output_path, export_path,
            "No private per-agent reinforcement data has been generated yet.",
        )

    ledger_data = _load_json_file(
        resolve_store_file_for_read(repo_root, "task-ledger.json"),
    )
    global_doc_data = _load_json_file(
        resolve_store_file_for_read(repo_root, "global-realignment-doc.json"),
    )
    feedback_data = _load_json_file(
        resolve_store_file_for_read(repo_root, "feedback-events.json"),
    )

    streak_progress = 0
    if ledger_data:
        streak_progress = _count_unrewarded_successes(
            ledger_data.get("entries", []),
        )

    display_name = _load_agent_names().get(agent_id, agent_id)
    multiplier = agent_entry.get("multiplier", 1.0)

    md_lines: list[str] = [
        "# Reinforcement Context",
        "",
        "- Status: available",
        f"- Agent: {agent_id} ({display_name})",
        f"- Role Multiplier: {multiplier:.2f}x",
        "",
    ]

    md_lines.extend(
        _render_reward_standing(agent_entry, streak_progress),
    )

    if feedback_data:
        md_lines.extend(
            _render_recent_feedback(feedback_data.get("entries", [])),
        )

    if global_doc_data:
        md_lines.extend(_render_list_section(
            "Standing Expectations",
            global_doc_data.get("standing_expectations", []),
        ))
        md_lines.extend(_render_list_section(
            "Behavioral Guidance",
            global_doc_data.get("behavioral_guidance", []),
        ))
        md_lines.extend(_render_list_section(
            "Lessons Learned",
            global_doc_data.get("lessons_learned", []),
        ))
        md_lines.extend(_render_list_section(
            "Fairness Framing",
            global_doc_data.get("fairness_framing", []),
        ))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(md_lines), encoding="utf-8")

    _write_exports(
        export_path,
        status="available",
        reason="Reinforcement context is available.",
        injection_enabled=True,
        context_file=str(output_path),
    )
    return 0


def _write_unavailable(
    output_path: Path,
    export_path: Path,
    reason: str,
    status: str = "unavailable",
) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    md = "\n".join([
        "# Reinforcement Context",
        "",
        f"- Status: {status}",
        f"- Reason: {reason}",
        "",
    ])
    output_path.write_text(md, encoding="utf-8")
    _write_exports(
        export_path, status=status, reason=reason,
        injection_enabled=False, context_file=str(output_path),
    )
    return 0


def _write_exports(
    export_path: Path,
    *,
    status: str,
    reason: str,
    injection_enabled: bool,
    context_file: str,
) -> None:
    exports = {
        "CONTEXT_PACK_REINFORCEMENT_STATUS": status,
        "CONTEXT_PACK_REINFORCEMENT_REASON": reason,
        "CONTEXT_PACK_REINFORCEMENT_INJECTION_ENABLED": (
            "true" if injection_enabled else "false"
        ),
        "CONTEXT_PACK_REINFORCEMENT_CONTEXT_FILE": context_file,
    }
    export_path.parent.mkdir(parents=True, exist_ok=True)
    with export_path.open("w", encoding="utf-8") as handle:
        for key, value in exports.items():
            handle.write(f"export {key}={shlex.quote(value)}\n")
