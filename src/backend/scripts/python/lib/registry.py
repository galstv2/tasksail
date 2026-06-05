"""Shared registry loader - single source of truth for agent metadata.

All agent properties (role names, human names, workflow order, model pins)
live in the active CLI provider's injected agent registry. Import helpers from
this module instead of hardcoding agent metadata elsewhere.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

_REGISTRY_PATH_ENV_VAR = "TASKSAIL_AGENT_REGISTRY_PATH"


def _resolve_registry_path() -> Path:
    configured_path = os.environ.get(_REGISTRY_PATH_ENV_VAR, "").strip()
    if configured_path:
        return Path(configured_path)
    raise RuntimeError(
        f"{_REGISTRY_PATH_ENV_VAR} is required; set it to the active CLI "
        "provider agent registry path."
    )


@lru_cache(maxsize=1)
def _load_agents() -> tuple[dict[str, str], ...]:
    data = json.loads(_resolve_registry_path().read_text(encoding="utf-8"))
    return tuple(data.get("agents", []))


@lru_cache(maxsize=1)
def agent_roles() -> dict[str, str]:
    """Return ``{agent_id: role_name}`` from the registry."""
    return {a["agent_id"]: a["role_name"] for a in _load_agents()}


@lru_cache(maxsize=1)
def agent_names() -> dict[str, str]:
    """Return ``{agent_id: human_name}`` from the registry."""
    return {a["agent_id"]: a["human_name"] for a in _load_agents()}


@lru_cache(maxsize=1)
def workflow_roles() -> tuple[tuple[str, str], ...]:
    """Return ``((human_name, role_name), ...)`` ordered by workflow_order."""
    agents = sorted(_load_agents(), key=lambda a: a.get("workflow_order", 0))
    return tuple((a["human_name"], a["role_name"]) for a in agents)


@lru_cache(maxsize=1)
def contribution_section_names() -> tuple[str, ...]:
    """Return retrospective contribution section headings in workflow order."""
    return tuple(
        f"{name}'s Contribution ({role})"
        for name, role in workflow_roles()
    )


@lru_cache(maxsize=1)
def agent_reward_multipliers() -> dict[str, float]:
    """Return ``{agent_id: reward_multiplier}`` from the registry.

    Defaults to 1.0 when the field is absent.
    """
    return {a["agent_id"]: float(a.get("reward_multiplier", 1.0)) for a in _load_agents()}
