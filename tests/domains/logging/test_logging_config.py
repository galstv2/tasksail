from __future__ import annotations

import json
import logging
import sys
import warnings
from pathlib import Path

import pytest

from src.backend.scripts.python.lib.errors import ValidationError
from src.backend.scripts.python.lib.logging_config import (
    bind,
    configure_logging,
    new_span_id,
)


@pytest.fixture(autouse=True)
def restore_logging():
    original_handlers = logging.getLogger().handlers[:]
    original_level = logging.getLogger().level
    original_hook = sys.excepthook
    yield
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)
        handler.close()
    for handler in original_handlers:
        root.addHandler(handler)
    root.setLevel(original_level)
    sys.excepthook = original_hook


def test_configure_logging_is_idempotent(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))

    configure_logging()
    configure_logging()

    assert len(logging.getLogger().handlers) == 1


def test_configure_logging_applies_log_level(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_LEVEL", "warn")

    configure_logging()

    assert logging.getLogger().level == logging.WARNING


def test_excepthook_logs_and_exits(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    exits: list[int] = []
    monkeypatch.setattr(sys, "exit", lambda code: exits.append(code))
    configure_logging()
    err = ValidationError("bad", code="BAD_INPUT", category="user")

    sys.excepthook(type(err), err, err.__traceback__)

    assert exits == [64]
    payload = json.loads(_one(tmp_path / "error", "backend-py-*.jsonl").read_text().splitlines()[0])
    assert payload["err"]["name"] == "ValidationError"


def test_bind_propagates_context_to_output(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()

    bind(logging.getLogger("src.backend.mcp.service"), task_id="t1").warning("warn")

    payload = json.loads(_one(tmp_path / "warn", "backend-py-*.jsonl").read_text().splitlines()[0])
    assert payload["task_id"] == "t1"


def test_bind_module_override_uses_canonical_module_field(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    configure_logging()

    bind(logging.getLogger("src.backend.mcp.service"), module="mcp/custom").warning("warn")

    payload = json.loads(_one(tmp_path / "warn", "backend-py-*.jsonl").read_text().splitlines()[0])
    assert payload["module"] == "mcp/custom"
    assert "_tasksail_module" not in payload.get("extra", {})


def test_configure_logging_skips_asyncio_handler_without_warning(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))

    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        configure_logging()

    assert not [warning for warning in captured if issubclass(warning.category, DeprecationWarning)]


def test_new_span_id_reuses_request_id_shape() -> None:
    assert new_span_id().startswith("req-")


def _one(root: Path, pattern: str) -> Path:
    matches = list(root.glob(pattern))
    assert len(matches) == 1
    return matches[0]
