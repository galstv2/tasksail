"""Behavior correction memo MCP service."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from src.backend.mcp.pack_schemas import validate_manifest

from ..config import RepoContextConfig

logger = logging.getLogger(__name__)

_DEFAULT_MANIFEST = RepoContextConfig.from_env().default_manifest


def _resolve_qmd_scope(pack_dir: Path) -> str:
    """Read qmd_scope_root / context_pack_id from the manifest, falling pmck to dir name."""
    manifest_path = pack_dir / _DEFAULT_MANIFEST
    context_pack_id = pack_dir.name
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            validate_manifest(manifest, path=str(manifest_path))
        except (json.JSONDecodeError, OSError):
            return f"qmd/context-packs/{context_pack_id}"
        context_pack_id = (
            str(manifest.get("context_pack_id") or context_pack_id).strip()
            or context_pack_id
        )
        qmd_scope = (
            str(
                manifest.get("qmd_scope_root")
                or f"qmd/context-packs/{context_pack_id}"
            ).strip()
            or f"qmd/context-packs/{context_pack_id}"
        )
        return qmd_scope
    return f"qmd/context-packs/{context_pack_id}"


def load_behavior_correction_memo(
    *,
    context_pack_dir: str,
) -> dict[str, Any]:
    """Load the correction memo from the QMD canonical directory."""
    from ..utils import ensure_non_empty_string, resolve_path_within

    pack_dir = Path(
        ensure_non_empty_string(context_pack_dir, "context_pack_dir")
    ).resolve()
    if not pack_dir.is_dir():
        return {
            "corrections_status": "unavailable",
            "corrections_reason": (
                f"Context pack directory does not exist: {pack_dir}"
            ),
        }

    qmd_scope = _resolve_qmd_scope(pack_dir)
    scope_dir = resolve_path_within(pack_dir, qmd_scope, "qmd_scope")
    memo_path = (
        scope_dir / "canonical" / "context-pack"
        / "behavior-correction-memo.md"
    )
    record_path = memo_path.with_name(memo_path.name + ".record.json")

    if not memo_path.exists():
        return {
            "corrections_status": "unavailable",
            "corrections_reason": "No behavior correction memo has been generated yet.",
            "corrections_memo_path": str(memo_path),
            "qmd_scope": qmd_scope,
        }

    try:
        markdown = memo_path.read_text(encoding="utf-8")
    except OSError as exc:
        return {
            "corrections_status": "malformed",
            "corrections_reason": f"Failed to read correction memo: {exc}",
            "corrections_memo_path": str(memo_path),
            "qmd_scope": qmd_scope,
        }

    record: dict[str, Any] = {}
    record_warning = ""
    if record_path.exists():
        try:
            record = json.loads(record_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            record_warning = f"Failed to read correction memo record: {exc}"

    return {
        "corrections_status": "available",
        "corrections_reason": "Behavior correction memo is available.",
        "corrections_memo_path": str(memo_path),
        "corrections_memo_markdown": markdown,
        "corrections_record": record,
        "corrections_record_warning": record_warning,
        "qmd_scope": qmd_scope,
        "context_pack_id": qmd_scope.rsplit("/", 1)[-1],
        "cycle_count": record.get("cycle_count", 0),
        "task_count": record.get("task_count", 0),
    }


def render_behavior_correction_memo(summary: dict[str, Any]) -> str:
    """Render correction memo summary as markdown for CLI output."""
    status = summary.get("corrections_status", "unknown")
    if status != "available":
        reason = summary.get("corrections_reason", "No correction memo available.")
        return (
            f"# Behavior Correction Memo\n\n"
            f"- Status: {status}\n"
            f"- Reason: {reason}\n"
        )
    markdown = summary.get("corrections_memo_markdown", "")
    if markdown:
        return markdown
    return (
        "# Behavior Correction Memo\n\n"
        "- Status: available\n"
        "- Content: empty\n"
    )
