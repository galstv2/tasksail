from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from src.backend.mcp.pack_schemas.manifest_v2 import LocalPath

_HOST_ENV = "REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR"
_CONTAINER_ENV = "REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR"
_CONTAINER_PORT_ENV = "REPO_CONTEXT_MCP_CONTAINER_PORT"


@dataclass(slots=True, frozen=True)
class MountConfig:
    host_dir: str
    container_dir: str


class ContainerPathMissing(Exception):
    def __init__(self, host: str) -> None:
        self.host = host
        super().__init__(
            f"Container path is missing for host path {host!r}; "
            "run `pnpm run upgrade-pack-schema` on this pack."
        )


def _normalize_path(value: str) -> str:
    normalized = value.replace("\\", "/").rstrip("/")
    return normalized or "/"


def normalize_manifest_local_path(value: Any) -> str | None:
    """Normalize legacy string and v2 object local_paths entries to host paths."""
    if isinstance(value, str):
        normalized = value.replace("\\", "/").strip()
        return normalized or None
    if isinstance(value, dict) and isinstance(value.get("host"), str):
        normalized = value["host"].replace("\\", "/").strip()
        return normalized or None
    return None


def load_mount_config() -> MountConfig | None:
    host_dir = os.environ.get(_HOST_ENV, "").strip()
    container_dir = os.environ.get(_CONTAINER_ENV, "").strip()
    if not host_dir or not container_dir:
        return None
    return MountConfig(
        host_dir=_normalize_path(host_dir),
        container_dir=_normalize_path(container_dir),
    )


def resolve_container_path(host: str, mount_config: MountConfig | None) -> str | None:
    if mount_config is None:
        return None
    host_path = _normalize_path(host)
    mount_host = mount_config.host_dir
    if host_path != mount_host and not host_path.startswith(f"{mount_host}/"):
        return None
    relative = host_path[len(mount_host):].lstrip("/")
    container_root = PurePosixPath(mount_config.container_dir)
    if not relative:
        return container_root.as_posix()
    return (container_root / PurePosixPath(relative)).as_posix()


def runs_in_container() -> bool:
    return os.path.exists("/.dockerenv") or bool(os.environ.get(_CONTAINER_PORT_ENV))


def pick_local_path(
    local_path: LocalPath,
    *,
    in_container: bool | None = None,
) -> str:
    use_container = runs_in_container() if in_container is None else in_container
    if use_container:
        if local_path.container is not None:
            return local_path.container
        raise ContainerPathMissing(local_path.host)
    return local_path.host
