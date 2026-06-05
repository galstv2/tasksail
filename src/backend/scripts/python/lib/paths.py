"""Path normalization and jail helpers shared across platform scripts."""
from __future__ import annotations

import re
from pathlib import Path

from .cli import fail

AGENT_WORKSPACE_RELDIR = "AgentWorkSpace"


def normalize_repo_relative_path(value: str) -> str:
    """Normalize separators, collapse runs of ``/``, strip leading ``./``."""
    normalized = value.replace("\\", "/").strip()
    normalized = re.sub(r"/+", "/", normalized)
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def resolve_repo_relative_path(
    root_dir: Path,
    relative_path: str,
) -> Path | None:
    """Resolve *relative_path* under *root_dir* and verify it stays inside.

    Returns ``None`` when the path is empty, absolute, or escapes root.
    """
    normalized = normalize_repo_relative_path(relative_path)
    if not normalized or Path(normalized).is_absolute():
        return None
    resolved = (root_dir / normalized).resolve()
    try:
        resolved.relative_to(root_dir)
    except ValueError:
        return None
    return resolved


def ensure_write_path(
    *,
    root_dir: Path,
    candidate: Path,
    allowed_relative_dir: str,
    error_message: str,
) -> Path:
    """Validate that *candidate* resolves within *allowed_relative_dir*.

    Creates intermediate parent directories.  Raises ``ValueError`` if
    the resolved path escapes the allowed subtree.
    """
    root_dir = root_dir.resolve()
    allowed_root = (root_dir / allowed_relative_dir).resolve()
    candidate = candidate.expanduser()
    if not candidate.is_absolute():
        candidate = root_dir / candidate

    candidate.parent.mkdir(parents=True, exist_ok=True)
    resolved_path = candidate.parent.resolve() / candidate.name
    try:
        resolved_path.relative_to(allowed_root)
    except ValueError as exc:
        raise ValueError(error_message) from exc
    return resolved_path


def normalize_boundary_path(root_dir: Path, value: str) -> str | None:
    """Normalize a boundary path: repo-relative when inside root, absolute
    otherwise.  Returns ``None`` for blank input.
    """
    normalized = value.strip()
    if not normalized:
        return None

    candidate = Path(normalized).expanduser()
    if not candidate.is_absolute():
        return normalize_repo_relative_path(normalized)

    resolved = candidate.resolve()
    try:
        relative = resolved.relative_to(root_dir.resolve())
    except ValueError:
        return str(resolved)
    return normalize_repo_relative_path(str(relative))


def ensure_within_root(
    root_dir: Path,
    candidate: Path,
    message: str,
) -> None:
    """Raise ``SystemExit`` if *candidate* is not under *root_dir*."""
    try:
        candidate.relative_to(root_dir)
    except ValueError:
        fail(message)


def assert_safe_path_segment(value: str, field_name: str) -> str:
    """Reject an untrusted *single* path segment that could redirect a write.

    Identifiers such as task IDs are interpolated as one directory name; a
    separator or traversal token would escape the intended parent. Fails closed
    via ``fail`` and returns the value unchanged when safe.
    """
    if not value or "/" in value or "\\" in value or value in {".", ".."}:
        fail(f"Unsafe {field_name} path segment: {value!r}")
    return value
