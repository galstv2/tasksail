from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Any, Literal

from src.backend.mcp.repo_context_mcp.utils import generate_request_id

from .errors import exit_code_for
from .json_formatter import TASKSAIL_MODULE_KEY
from .level_router import LevelRouter
from .log_paths import logs_dir

LOG_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}
DEFAULT_RETENTION_DAYS = 30


class BoundLoggerAdapter(logging.LoggerAdapter):
    def process(
        self,
        msg: Any,
        kwargs: dict[str, Any],
    ) -> tuple[Any, dict[str, Any]]:
        extra = dict(kwargs.get("extra") or {})
        extra.update(self.extra)
        module = extra.pop("module", None)
        if module is not None:
            extra[TASKSAIL_MODULE_KEY] = module
        kwargs["extra"] = extra
        return msg, kwargs


def configure_logging(
    stack: Literal["py"] = "py",
    *,
    service: str | None = None,
    repo_root: str | None = None,
) -> None:
    del stack, service
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)
        handler.close()

    root.setLevel(_read_level())
    root.addHandler(LevelRouter(repo_root=repo_root))
    sys.excepthook = _excepthook
    _install_asyncio_exception_handler()
    _prune_retention(logs_dir(repo_root))


def bind(logger: logging.Logger, **ctx: Any) -> logging.LoggerAdapter:
    return BoundLoggerAdapter(logger, ctx)


def new_span_id() -> str:
    return generate_request_id()


def _read_level() -> int:
    return LOG_LEVELS.get(os.getenv("LOG_LEVEL", "info").lower(), logging.INFO)


def _excepthook(
    exc_type: type[BaseException],
    exc: BaseException,
    tb: Any,
) -> None:
    del exc_type, tb
    logging.getLogger("process.uncaught").exception(
        "process.uncaught_exception",
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    sys.exit(exit_code_for(exc))


def _install_asyncio_exception_handler() -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def handle_exception(
        _loop: asyncio.AbstractEventLoop,
        context: dict[str, Any],
    ) -> None:
        exc = context.get("exception")
        if isinstance(exc, BaseException):
            logging.getLogger("process.asyncio").exception(
                "process.asyncio_exception",
                exc_info=(type(exc), exc, exc.__traceback__),
            )
        else:
            logging.getLogger("process.asyncio").error(
                "process.asyncio_exception",
                extra={"context": context},
            )

    loop.set_exception_handler(handle_exception)


def _prune_retention(log_dir: Path) -> None:
    cutoff = _cutoff_seconds()
    try:
        for path in log_dir.rglob("*.jsonl"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                continue
    except OSError:
        return


def _cutoff_seconds() -> float:
    try:
        days = int(os.getenv("TASKSAIL_LOG_RETENTION_DAYS", "30"))
    except ValueError:
        days = DEFAULT_RETENTION_DAYS
    if days <= 0:
        days = DEFAULT_RETENTION_DAYS
    return __import__("time").time() - days * 24 * 60 * 60


__all__ = ["configure_logging", "bind", "new_span_id"]
