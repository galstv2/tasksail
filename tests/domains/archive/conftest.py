"""Shared test fixtures for the archive test domain."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest


@pytest.fixture()
def write_record():
    """Return a helper that writes a JSON record into a scope directory."""

    def _write(scope_dir: Path, file_name: str, record: dict[str, Any]) -> Path:
        scope_dir.mkdir(parents=True, exist_ok=True)
        path = scope_dir / file_name
        path.write_text(json.dumps(record), encoding="utf-8")
        return path

    return _write
