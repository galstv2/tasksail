from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from src.backend.scripts.python.lib.logging_config import configure_logging

RESERVED_KEYS = {
    "ts",
    "level",
    "stack",
    "module",
    "msg",
    "pid",
    "task_id",
    "agent_id",
    "provider_id",
    "span_id",
}
LEVELS = {"debug", "info", "warn", "error"}


def test_python_and_typescript_emit_matching_reserved_schema(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("LOG_DIR", str(log_dir))
    monkeypatch.setenv("LOG_LEVEL", "debug")

    configure_logging(service="cross-stack-test")
    logger = logging.getLogger("src.backend.tests.cross_stack")
    logger.debug("py.debug")
    logger.info("py.info")
    logger.warning("py.warn")
    try:
        raise ValueError("py boom")
    except ValueError:
        logger.exception("py.error")
    _close_python_handlers()

    ts_code = """
      import { createLogger, flushLoggers } from './src/backend/platform/core/index.ts';
      process.env.LOG_LEVEL = 'debug';
      const log = createLogger('platform/tests/cross-stack');
      log.debug('ts.debug');
      log.info('ts.info');
      log.warn('ts.warn');
      log.error('ts.error', new Error('ts boom'));
      flushLoggers();
    """
    env = os.environ.copy()
    env["LOG_DIR"] = str(log_dir)
    env["LOG_LEVEL"] = "debug"
    subprocess.run(
        ["pnpm", "exec", "tsx", "-e", ts_code],
        cwd=repo_root,
        env=env,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    lines = _read_lines(log_dir)
    py_lines = [line for line in lines if line["stack"] == "py"]
    ts_lines = [line for line in lines if line["stack"] == "ts"]

    assert {line["level"] for line in py_lines} == LEVELS
    assert {line["level"] for line in ts_lines} == LEVELS
    for line in lines:
        assert set(line.keys()).issuperset(RESERVED_KEYS)
        assert isinstance(line["ts"], str)
        assert line["level"] in LEVELS
        assert line["stack"] in {"py", "ts"}
        assert isinstance(line["module"], str)
        assert isinstance(line["msg"], str)
        assert isinstance(line["pid"], int)
        assert line["task_id"] is None or isinstance(line["task_id"], str)
        assert line["agent_id"] is None or isinstance(line["agent_id"], str)
        assert line["provider_id"] is None or isinstance(line["provider_id"], str)
        assert line["span_id"] is None or isinstance(line["span_id"], str)

    key_sets_by_stack = {
        stack: {frozenset(line.keys()) for line in lines if line["stack"] == stack}
        for stack in ("py", "ts")
    }
    assert key_sets_by_stack["py"] == key_sets_by_stack["ts"]


def _read_lines(log_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted(log_dir.glob("*/*.jsonl")):
        if path.parent.name == "agent":
            continue
        rows.extend(json.loads(line) for line in path.read_text().splitlines() if line)
    return rows


def _close_python_handlers() -> None:
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)
        handler.close()
