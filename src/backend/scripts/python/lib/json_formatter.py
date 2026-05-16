from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .errors import serialize_error

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
    "err",
    "extra",
}
TASKSAIL_MODULE_KEY = "_tasksail_module"

_LOG_RECORD_KEYS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "ts": _timestamp(record),
            "level": _level(record),
            "stack": "py",
            "module": _module(record),
            "msg": record.getMessage(),
            "pid": os.getpid(),
            "task_id": getattr(record, "task_id", None),
            "agent_id": getattr(record, "agent_id", None),
            "provider_id": getattr(record, "provider_id", None),
            "span_id": getattr(record, "span_id", None),
        }

        if (
            isinstance(record.exc_info, tuple)
            and len(record.exc_info) >= 2
            and record.exc_info[1] is not None
        ):
            line["err"] = serialize_error(record.exc_info[1])

        extra = _extra(record)
        if extra:
            line["extra"] = extra

        return json.dumps(line, separators=(",", ":"), default=str)


def _timestamp(record: logging.LogRecord) -> str:
    return (
        datetime.fromtimestamp(record.created, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _level(record: logging.LogRecord) -> str:
    if record.levelno >= logging.ERROR:
        return "error"
    if record.levelno >= logging.WARNING:
        return "warn"
    if record.levelno >= logging.INFO:
        return "info"
    return "debug"


def _module(record: logging.LogRecord) -> str:
    internal_override = getattr(record, TASKSAIL_MODULE_KEY, None)
    if isinstance(internal_override, str):
        return internal_override.replace(".", "/")

    override = getattr(record, "module", None)
    filename_stem = Path(record.pathname).stem
    raw = (
        override
        if isinstance(override, str) and override != filename_stem
        else record.name
    )
    for prefix in ("src.backend.", "backend."):
        if raw.startswith(prefix):
            raw = raw[len(prefix) :]
            break
    return raw.replace(".", "/")


def _extra(record: logging.LogRecord) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    for key, value in record.__dict__.items():
        if key in _LOG_RECORD_KEYS or key in RESERVED_KEYS or key == TASKSAIL_MODULE_KEY:
            continue
        extra[key] = value
    return extra


__all__ = ["JsonFormatter"]
