from __future__ import annotations

import traceback
from typing import Any, Literal, Mapping

ErrorCategory = Literal["user", "system", "external", "invariant"]


class PlatformError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        category: ErrorCategory,
        retryable: bool = False,
        context: Mapping[str, Any] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.category: ErrorCategory = category
        self.retryable = retryable
        self.context: dict[str, Any] = dict(context or {})
        if cause is not None:
            self.__cause__ = cause


class ConfigError(PlatformError):
    pass


class ValidationError(PlatformError):
    pass


class ContainerError(PlatformError):
    pass


class MCPError(PlatformError):
    pass


class AgentRunError(PlatformError):
    pass


class QueueError(PlatformError):
    pass


class ContextPackError(PlatformError):
    pass


class InvariantError(PlatformError):
    pass


def serialize_error(err: BaseException | Any) -> dict[str, Any]:
    return _serialize_error(err, set())


def exit_code_for(err: Any) -> int:
    if not isinstance(err, PlatformError):
        return 1

    if isinstance(err, ConfigError) and err.code in {
        "CONFIG_MISSING",
        "CONFIG_INVALID",
    }:
        return 78

    if err.category == "user":
        return 64
    if err.category == "external":
        return 69
    if err.category in {"system", "invariant"}:
        return 70
    return 1


def _serialize_error(err: Any, seen: set[int]) -> dict[str, Any]:
    if isinstance(err, PlatformError):
        envelope = _base_error_envelope(err)
        envelope["code"] = err.code
        envelope["category"] = err.category
        envelope["retryable"] = err.retryable
        envelope["context"] = err.context
        envelope["cause"] = _serialize_cause(err, seen)
        return envelope

    if isinstance(err, BaseException):
        envelope = _base_error_envelope(err)
        envelope["code"] = None
        envelope["category"] = None
        envelope["retryable"] = None
        envelope["cause"] = _serialize_cause(err, seen)
        return envelope

    return {
        "name": "NonError",
        "code": None,
        "category": None,
        "retryable": None,
        "message": str(err),
        "stack": "",
        "cause": None,
    }


def _base_error_envelope(err: BaseException) -> dict[str, Any]:
    return {
        "name": type(err).__name__,
        "message": str(err),
        "stack": "".join(
            traceback.format_exception(type(err), err, err.__traceback__)
        ),
        "cause": None,
    }


def _serialize_cause(
    err: BaseException,
    seen: set[int],
) -> dict[str, Any] | None:
    err_id = id(err)
    if err_id in seen:
        return None

    seen.add(err_id)
    cause = err.__cause__
    return _serialize_error(cause, seen) if cause is not None else None


__all__ = [
    "ErrorCategory",
    "PlatformError",
    "ConfigError",
    "ValidationError",
    "ContainerError",
    "MCPError",
    "AgentRunError",
    "QueueError",
    "ContextPackError",
    "InvariantError",
    "serialize_error",
    "exit_code_for",
]
