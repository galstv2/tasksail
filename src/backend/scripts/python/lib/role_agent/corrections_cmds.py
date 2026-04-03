"""Corrections context rendering command."""
from __future__ import annotations

import argparse
import json
import shlex


def cmd_render_corrections_context(args: argparse.Namespace) -> int:
    """Render corrections context markdown and export shell variables."""
    payload = json.loads(args.summary_json.read_text(encoding="utf-8"))

    status = (
        str(payload.get("corrections_status") or "unknown").strip()
        or "unknown"
    )
    reason = str(payload.get("corrections_reason") or "").strip()
    markdown = str(payload.get("corrections_memo_markdown") or "")
    injection_enabled = (
        status == "available" and bool(markdown.strip())
    )

    args.output_path.parent.mkdir(parents=True, exist_ok=True)
    if injection_enabled:
        context_markdown = "\n".join([
            "# Context-Pack Behavior Corrections Runtime Context",
            "",
            f"- Status: {status}",
            f"- Reason: {reason or 'Behavior correction memo is available.'}",
            "",
            "## Loaded Memo",
            "",
            markdown.rstrip(),
            "",
        ])
    else:
        context_markdown = "\n".join([
            "# Context-Pack Behavior Corrections Runtime Context",
            "",
            f"- Status: {status}",
            f"- Reason: {reason or 'No corrections memo is available.'}",
            "",
        ])
    args.output_path.write_text(context_markdown, encoding="utf-8")

    exports = {
        "CONTEXT_PACK_CORRECTIONS_STATUS": status,
        "CONTEXT_PACK_CORRECTIONS_REASON": reason,
        "CONTEXT_PACK_CORRECTIONS_INJECTION_ENABLED": (
            "true" if injection_enabled else "false"
        ),
        "CONTEXT_PACK_CORRECTIONS_CONTEXT_FILE": str(args.output_path),
    }
    with args.export_path.open("w", encoding="utf-8") as handle:
        for key, value in exports.items():
            handle.write(f"export {key}={shlex.quote(value)}\n")

    return 0
