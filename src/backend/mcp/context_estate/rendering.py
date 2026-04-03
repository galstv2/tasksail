"""Markdown rendering for context estate discovery output."""
from __future__ import annotations

from typing import Any


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Context Estate Discovery",
        "",
        f"- Estate type: `{payload['estate_type']}`",
        f"- Root path: `{payload['root_path']}`",
        f"- Discovered at: `{payload['discovered_at']}`",
        "",
    ]

    repos = payload.get("candidate_repos", [])
    focus_areas = payload.get("candidate_focus_areas", [])
    high_signal_paths = payload.get("high_signal_paths", [])
    warnings = payload.get("warnings", [])

    if repos:
        lines.extend(["## Candidate repositories", ""])
        for repo in repos:
            lines.append(f"- `{repo['relative_path']}`")
        lines.append("")

    if focus_areas:
        lines.extend(["## Candidate focus areas", ""])
        for area in focus_areas:
            lines.append(f"- `{area['relative_path']}` ({area['focus_type']})")
        lines.append("")

    if high_signal_paths:
        lines.extend(["## High-signal paths", ""])
        for signal in high_signal_paths:
            lines.append(
                f"- `{signal['relative_path']}` ({signal['signal_type']})"
            )
        lines.append("")

    if warnings:
        lines.extend(["## Warnings", ""])
        for warning in warnings:
            lines.append(f"- {warning}")
        lines.append("")

    draft_path = payload.get("qmd_draft_artifact_path")
    if isinstance(draft_path, str) and draft_path:
        lines.extend([
            "## QMD draft artifact",
            "",
            f"- `{draft_path}`",
            "",
        ])

    return "\n".join(lines).rstrip() + "\n"
