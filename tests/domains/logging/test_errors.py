from __future__ import annotations

from typing import Any

from src.backend.scripts.python.lib.errors import (
    AgentRunError,
    ConfigError,
    ContainerError,
    ContextPackError,
    InvariantError,
    MCPError,
    PlatformError,
    QueueError,
    ValidationError,
    exit_code_for,
    serialize_error,
)

ERROR_CASES = [
    (ConfigError, "ConfigError", "user"),
    (ValidationError, "ValidationError", "user"),
    (ContainerError, "ContainerError", "external"),
    (MCPError, "MCPError", "external"),
    (AgentRunError, "AgentRunError", "system"),
    (QueueError, "QueueError", "system"),
    (ContextPackError, "ContextPackError", "system"),
    (InvariantError, "InvariantError", "invariant"),
]


def test_platform_error_subclasses_construct_with_typed_fields() -> None:
    for cls, name, category in ERROR_CASES:
        err = cls(
            "failed",
            code=f"{name.upper()}_CODE",
            category=category,
            retryable=True,
            context={"task_id": "task-1"},
        )

        assert type(err).__name__ == name
        assert isinstance(err, PlatformError)
        assert isinstance(err, Exception)
        assert err.code == f"{name.upper()}_CODE"
        assert err.category == category
        assert err.retryable is True
        assert err.context == {"task_id": "task-1"}


def test_serialize_error_emits_nested_cause_envelope() -> None:
    err = ContainerError(
        "outer",
        code="X",
        category="external",
        cause=ValueError("inner"),
    )

    envelope = serialize_error(err)

    assert envelope["name"] == "ContainerError"
    assert envelope["code"] == "X"
    assert envelope["category"] == "external"
    assert envelope["retryable"] is False
    assert envelope["message"] == "outer"
    assert envelope["context"] == {}
    assert envelope["cause"]["name"] == "ValueError"
    assert envelope["cause"]["code"] is None
    assert envelope["cause"]["category"] is None
    assert envelope["cause"]["retryable"] is None
    assert envelope["cause"]["message"] == "inner"
    assert envelope["cause"]["cause"] is None


def test_serialize_error_is_cycle_safe() -> None:
    first = RuntimeError("first")
    second = RuntimeError("second")
    first.__cause__ = second
    second.__cause__ = first

    envelope = serialize_error(first)

    assert envelope["cause"]["name"] == "RuntimeError"
    assert envelope["cause"]["message"] == "second"
    assert envelope["cause"]["cause"]["name"] == "RuntimeError"
    assert envelope["cause"]["cause"]["message"] == "first"
    assert envelope["cause"]["cause"]["cause"] is None


def test_serialize_error_handles_non_exception_values() -> None:
    for value, message in [
        ("boom", "boom"),
        (42, "42"),
        (None, "None"),
    ]:
        assert serialize_error(value) == {
            "name": "NonError",
            "code": None,
            "category": None,
            "retryable": None,
            "message": message,
            "stack": "",
            "cause": None,
        }


def test_exit_code_for_maps_platform_errors() -> None:
    cases: list[tuple[Any, int]] = [
        (ValidationError("x", code="BAD_INPUT", category="user"), 64),
        (ConfigError("x", code="CONFIG_MISSING", category="user"), 78),
        (ConfigError("x", code="BAD_INPUT", category="user"), 64),
        (ContainerError("x", code="CONTAINER_DOWN", category="external"), 69),
        (MCPError("x", code="MCP_DOWN", category="external"), 69),
        (AgentRunError("x", code="AGENT_FAILED", category="system"), 70),
        (QueueError("x", code="QUEUE_FAILED", category="system"), 70),
        (ContextPackError("x", code="PACK_FAILED", category="system"), 70),
        (InvariantError("x", code="BUG", category="invariant"), 70),
        (RuntimeError("x"), 1),
        (None, 1),
    ]

    for err, code in cases:
        assert exit_code_for(err) == code
