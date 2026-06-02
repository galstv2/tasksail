"""Agent metadata resolution and task identity helpers."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from ..protocol_output import write_protocol_stdout
from ..workspace_paths import handoffs_dir

PROVIDER_REQUIRED_REGISTRY_FIELDS = ("instruction_path", "agent_profile_path")


def read_markdown_file(path: Path) -> str:
    """Read a markdown file, returning ``""`` when the file is missing."""
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def extract_metadata_value(content: str, label: str) -> str:
    """Extract a ``- Label: value`` field from markdown content."""
    pattern = re.compile(rf"^- {re.escape(label)}:\s*(.*)$", re.MULTILINE)
    match = pattern.search(content)
    return match.group(1).strip() if match else ""


def resolve_task_metadata(root_dir: Path) -> tuple[str, str]:
    """Read the task ID and title from handoff artifacts."""
    professional_task = read_markdown_file(
        handoffs_dir(root_dir) / "professional-task.md"
    )

    task_id = extract_metadata_value(professional_task, "Task ID")
    task_title = extract_metadata_value(professional_task, "Task Title")
    return task_id, task_title


def find_agent_entry(
    registry_payload: dict, agent_id: str
) -> dict | None:
    """Return the registry entry for *agent_id*, or ``None``."""
    for item in registry_payload.get("agents", []):
        if item.get("agent_id") == agent_id:
            return item
    return None


def required_registry_value(entry: dict, field_name: str) -> str:
    """Return a provider-required registry field or fail closed."""
    value = str(entry.get(field_name, "")).strip()
    if not value:
        raise ValueError(
            f"Agent '{entry.get('agent_id', '')}' is missing provider-required "
            f"registry field '{field_name}'"
        )
    return value


def cmd_resolve_agent_metadata(args: argparse.Namespace) -> int:
    """Print agent registry fields for a given agent ID."""
    payload = json.loads(args.registry_path.read_text(encoding="utf-8"))
    found = find_agent_entry(payload, args.agent_id)
    if found is None:
        return 2
    provider_fields = {
        field_name: required_registry_value(found, field_name)
        for field_name in PROVIDER_REQUIRED_REGISTRY_FIELDS
    }
    write_protocol_stdout(provider_fields["agent_profile_path"] + '\n')
    write_protocol_stdout(str(found.get("required_model", "")) + '\n')
    write_protocol_stdout(str(found.get("role_name", "")) + '\n')
    write_protocol_stdout(provider_fields["instruction_path"] + '\n')
    write_protocol_stdout(str(found.get("autonomy_profile", "")) + '\n')
    write_protocol_stdout(str(str(found.get("pre_task", False)).lower()) + '\n')
    return 0
