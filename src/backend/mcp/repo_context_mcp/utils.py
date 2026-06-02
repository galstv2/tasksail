from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from .config import ALLOWED_LAYERS, REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

ALLOWED_SCOPE_MODES = {"focused"}


def utc_now() -> str:
    return (
        datetime.now(UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def slugify_timestamp(value: str) -> str:
    return value.replace(":", "").replace("-", "")


def resolve_path(base_dir: Path, value: str) -> Path:
    raw_path = Path(value)
    if raw_path.is_absolute():
        return raw_path.resolve()
    return (base_dir / raw_path).resolve()


def ensure_path_within(base_dir: Path, candidate: Path, field_name: str) -> Path:
    resolved_base = base_dir.resolve()
    resolved_candidate = candidate.resolve()
    try:
        resolved_candidate.relative_to(resolved_base)
    except ValueError as exc:
        raise ValueError(
            f"Field '{field_name}' must resolve within {resolved_base}"
        ) from exc
    return resolved_candidate


# Windows drive-absolute (C:\..., C:/...) and UNC (\\server\share) shapes. On
# POSIX these are not Path.is_absolute(), so without this guard they would be
# treated as relative filenames and silently sandboxed instead of rejected —
# making a Windows-authored manifest behave differently across host OSes.
_WINDOWS_ABSOLUTE_RE = re.compile(r"^([A-Za-z]:[\\/]|\\\\)")


def resolve_path_within(base_dir: Path, value: str, field_name: str) -> Path:
    if _WINDOWS_ABSOLUTE_RE.match(value):
        raise ValueError(
            f"Field '{field_name}' must be a repo-relative path, not a Windows "
            f"drive or UNC path: {value!r}"
        )
    return ensure_path_within(
        base_dir,
        resolve_path(base_dir, value),
        field_name,
    )


ALLOWED_CONTAINER_ROOTS: tuple[PurePosixPath, ...] = (
    PurePosixPath("/workspace"),
    PurePosixPath("/context-pack-roots"),
)


def resolve_context_pack_dir(
    workspace_root: Path,
    context_pack_dir: str,
) -> Path:
    """Resolve the active context pack directory.

    Contract: the value must be an absolute POSIX path under one of the
    allowed mount roots. Anything else is a misconfiguration; fail closed.

    Service code paths that operate on host-mounted data roots rather than
    container-internal mount points should use :func:`resolve_context_data_dir`
    instead — keeping that escape hatch out of this function preserves the
    strict invariant for every call site.
    """
    candidate = PurePosixPath(context_pack_dir)
    if not candidate.is_absolute():
        raise ValueError(
            f"context_pack_dir must be an absolute POSIX path; got {context_pack_dir!r}"
        )
    if not any(_is_under(candidate, root) for root in ALLOWED_CONTAINER_ROOTS):
        roots = ", ".join(str(r) for r in ALLOWED_CONTAINER_ROOTS)
        raise ValueError(
            f"context_pack_dir {context_pack_dir!r} is not under any allowed "
            f"mount root ({roots})"
        )
    del workspace_root  # contract is independent of workspace root
    return Path(str(candidate)).resolve()


def resolve_context_data_dir(context_pack_dir: str) -> Path:
    """Resolve a context-pack-derived data root that may live on the host.

    Used by service-side flows (archive, seeding, lineage) that operate on
    host-mounted data directories rather than container-internal mount
    points. When the value points under an allowed container root the
    behavior is identical to :func:`resolve_context_pack_dir`. Otherwise
    the value must still be an absolute path — relative input is rejected.
    """
    posix_candidate = PurePosixPath(context_pack_dir)
    if posix_candidate.is_absolute() and any(
        _is_under(posix_candidate, root) for root in ALLOWED_CONTAINER_ROOTS
    ):
        return Path(str(posix_candidate)).resolve()
    host_candidate = Path(context_pack_dir)
    if not host_candidate.is_absolute():
        roots = ", ".join(str(r) for r in ALLOWED_CONTAINER_ROOTS)
        raise ValueError(
            f"context_pack_dir {context_pack_dir!r} must be an absolute path "
            f"(either a host path or under one of: {roots})"
        )
    return host_candidate.resolve()


def _is_under(candidate: PurePosixPath, root: PurePosixPath) -> bool:
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        return False
    if root == PurePosixPath("/context-pack-roots"):
        parts = relative.parts
        return bool(parts) and parts[0].isdigit()
    return True


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"JSON file is missing: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON file is not valid: {path}: {exc}") from exc


def write_text_atomic(path: Path, content: str) -> None:
    """Write *content* to *path* atomically via temp-file + replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, str(path))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            logger.warning("Failed to remove temp file %s during atomic write cleanup", tmp_path)
        raise


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    """Write JSON *payload* to *path* atomically."""
    write_text_atomic(
        path,
        json.dumps(payload, indent=2, sort_keys=False) + "\n",
    )


def ensure_non_empty_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Field '{field_name}' must be a non-empty string")
    return value.strip()


def ensure_list_of_strings(value: Any, field_name: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(
        isinstance(item, str) for item in value
    ):
        return value
    raise ValueError(
        f"Field '{field_name}' must be a string or list of strings"
    )


def normalize_layer(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return "shared"
    normalized = value.strip().lower()
    if normalized not in ALLOWED_LAYERS:
        return "shared"
    return normalized


def unique_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        normalized = value.strip()
        return [normalized] if normalized else []
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            if isinstance(item, str):
                normalized = item.strip()
                if normalized:
                    result.append(normalized)
        return result
    return []


def compact_text(value: Any, max_length: int = 280) -> str:
    if not isinstance(value, str):
        return ""
    normalized = " ".join(value.split())
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 3].rstrip() + "..."


def compact_list(
    values: list[str],
    max_items: int = 5,
    max_length: int = 140,
) -> list[str]:
    compacted = [
        text
        for value in values
        if (text := compact_text(value, max_length=max_length))
    ]
    if len(compacted) <= max_items:
        return compacted
    return compacted[:max_items]


def normalize_optional_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def parse_int(value: Any, default: int = 0) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return default
    return default


def slugify(value: str) -> str:
    normalized = re.sub(
        r"[^a-zA-Z0-9]+",
        "-",
        value.strip().lower(),
    ).strip("-")
    return normalized or "unnamed"


def titleize_segment(value: str) -> str:
    cleaned = re.sub(r"[-_]+", " ", value).strip()
    return cleaned.title() if cleaned else "Unnamed"


def is_within(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def normalize_bool(value: Any, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return default


def normalize_scope_mode(value: Any) -> str:
    normalized = normalize_optional_string(value) or "focused"
    if normalized not in ALLOWED_SCOPE_MODES:
        return "focused"
    return normalized


def read_existing_created_at(path: Path, fallback: str) -> str:
    if not path.exists():
        return fallback
    try:
        existing = load_json(path)
    except ValueError:
        return fallback
    created_at = existing.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        return created_at.strip()
    return fallback


def generate_request_id() -> str:
    return f"req-{slugify_timestamp(utc_now())}-{uuid4().hex[:8]}"


def resolve_request_id(headers: Any) -> str:
    if headers is None:
        return generate_request_id()

    raw_value = headers.get(REQUEST_ID_HEADER, "")
    if isinstance(raw_value, str):
        normalized = raw_value.strip()
        if normalized:
            return normalized[:128]

    return generate_request_id()


def attach_request_id(
    payload: dict[str, Any],
    request_id: str,
) -> dict[str, Any]:
    enriched = dict(payload)
    enriched["request_id"] = request_id
    return enriched
