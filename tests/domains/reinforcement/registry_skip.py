"""Module-level skip helper for registry-dependent reinforcement tests."""
from __future__ import annotations

import os

import pytest

_REGISTRY_ENV_VAR = "TASKSAIL_AGENT_REGISTRY_PATH"
_SKIP_REASON = (
    f"{_REGISTRY_ENV_VAR} is not set; skipping reinforcement tests that require "
    "the active CLI provider agent registry."
)


def skip_if_agent_registry_missing() -> None:
    if not os.environ.get(_REGISTRY_ENV_VAR, "").strip():
        pytest.skip(_SKIP_REASON, allow_module_level=True)
