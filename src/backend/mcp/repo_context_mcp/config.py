from __future__ import annotations

import os
from dataclasses import dataclass
from typing import FrozenSet, Literal

DEFAULT_EXCLUDED_DIRS: FrozenSet[str] = frozenset(
    {
        ".git",
        ".venv",
        "__pycache__",
        "node_modules",
        "dist",
        "build",
        "coverage",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
    }
)
DEFAULT_ALLOWED_SUFFIXES: FrozenSet[str] = frozenset(
    {
        ".md",
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".yaml",
        ".yml",
        ".sh",
        ".sql",
        ".toml",
        ".ini",
        ".cfg",
    }
)
ALLOWED_LAYERS: FrozenSet[str] = frozenset(
    {
        "backend",
        "frontend",
        "test",
        "infrastructure",
        "database",
        "documents",
        "shared",
    }
)
REQUEST_ID_HEADER = "X-Request-ID"
AUTH_TOKEN_HEADER = "X-Repo-Context-Token"
TASKSAIL_TASK_ID_HEADER = "X-TaskSail-Task-Id"
TASKSAIL_CONTEXT_PACK_DIR_HEADER = "X-TaskSail-Context-Pack-Dir"


@dataclass(frozen=True)
class RequestScope:
    task_id: str
    context_pack_dir: str
    source: Literal["header", "body", "env"]


@dataclass(frozen=True)
class ServerConfig:
    host: str
    port: int
    auth_token: str
    auth_header: str
    max_request_bytes: int
    log_level: str
    socket_timeout: int

    @classmethod
    def from_env(cls) -> "ServerConfig":
        return cls(
            host=os.getenv("REPO_CONTEXT_MCP_HOST", "127.0.0.1"),
            port=int(os.getenv("REPO_CONTEXT_MCP_PORT", "8811")),
            auth_token=os.getenv("REPO_CONTEXT_MCP_AUTH_TOKEN", "").strip(),
            auth_header=(
                os.getenv(
                    "REPO_CONTEXT_MCP_AUTH_HEADER",
                    AUTH_TOKEN_HEADER,
                ).strip()
                or AUTH_TOKEN_HEADER
            ),
            max_request_bytes=int(
                os.getenv("REPO_CONTEXT_MCP_MAX_REQUEST_BYTES", "65536")
            ),
            log_level=os.getenv("LOG_LEVEL", "info").upper(),
            socket_timeout=int(
                os.getenv("REPO_CONTEXT_MCP_SOCKET_TIMEOUT", "30")
            ),
        )


@dataclass(frozen=True)
class RepoContextConfig:
    default_manifest: str
    default_plan_file: str
    global_retrospective_root: str
    max_files_per_repo: int
    excluded_dirs: FrozenSet[str]
    allowed_suffixes: FrozenSet[str]
    allowed_layers: FrozenSet[str]
    request_id_header: str

    @classmethod
    def from_env(cls) -> "RepoContextConfig":
        return cls(
            default_manifest=os.getenv(
                "CONTEXT_PACK_QMD_REPO_SOURCES_FILE",
                "qmd/repo-sources.json",
            ),
            default_plan_file=os.getenv(
                "CONTEXT_PACK_QMD_DRY_RUN_PLAN_FILE",
                "qmd/bootstrap/seed-plan.json",
            ),
            global_retrospective_root=os.getenv(
                "QMD_GLOBAL_RETROSPECTIVE_ROOT",
                "AgentWorkSpace/qmd/global/retrospectives",
            ),
            max_files_per_repo=int(os.getenv("QMD_MAX_FILES_PER_REPO", "200")),
            excluded_dirs=DEFAULT_EXCLUDED_DIRS,
            allowed_suffixes=DEFAULT_ALLOWED_SUFFIXES,
            allowed_layers=ALLOWED_LAYERS,
            request_id_header=REQUEST_ID_HEADER,
        )
