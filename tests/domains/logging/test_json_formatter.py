from __future__ import annotations

import json
import logging
import sys

from src.backend.scripts.python.lib.json_formatter import JsonFormatter


def test_json_formatter_emits_reserved_schema_fields() -> None:
    record = logging.LogRecord(
        "src.backend.platform.queue.createDropboxTask",
        logging.INFO,
        __file__,
        10,
        "hello %s",
        ("world",),
        None,
    )

    payload = json.loads(JsonFormatter().format(record))

    assert payload["module"] == "platform/queue/createDropboxTask"
    assert payload["level"] == "info"
    assert payload["msg"] == "hello world"
    for key in (
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
    ):
        assert key in payload
    assert payload["task_id"] is None


def test_json_formatter_maps_debug_level() -> None:
    record = logging.LogRecord("src.backend.mcp.service", logging.DEBUG, __file__, 1, "debug", (), None)

    assert json.loads(JsonFormatter().format(record))["level"] == "debug"


def test_json_formatter_serializes_exc_info() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.getLogger("src.backend.mcp.service").makeRecord(
            "src.backend.mcp.service",
            logging.ERROR,
            __file__,
            1,
            "failed",
            (),
            exc_info=sys.exc_info(),
        )

    payload = json.loads(JsonFormatter().format(record))

    assert payload["err"]["name"] == "ValueError"
    assert payload["err"]["message"] == "boom"


def test_json_formatter_places_extras_under_extra_and_drops_reserved_keys() -> None:
    record = logging.LogRecord("src.backend.mcp.service", logging.INFO, __file__, 1, "msg", (), None)
    record.task_id = "top"
    record.custom = 1
    record.msg = "canonical"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["msg"] == "canonical"
    assert payload["task_id"] == "top"
    assert payload["extra"] == {"custom": 1}
