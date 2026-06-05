"""Helpers for context-pack bootstrap questionnaire answers."""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from src.backend.mcp.pack_constants import ALLOWED_LAYERS

from .protocol_output import write_protocol_stdout
from .text import normalize_string_list

logger = logging.getLogger(__name__)


def slugify(value: str) -> str:
    # Intentionally Unicode-aware (str.isalnum keeps non-ASCII letters/digits),
    # unlike the ASCII-only lib.text.slugify. Kept separate by design; the
    # "context-pack" fallback is specific to bootstrap ids.
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-")
    return slug or "context-pack"


def normalize_csv_list(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def prompt(label: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    response = input(f"{label}{suffix}: ").strip()
    return response or default


def prompt_int(label: str, default: int) -> int:
    while True:
        value = prompt(label, str(default)).strip()
        try:
            parsed = int(value)
        except ValueError:
            logger.warning("context_pack_activation.prompt.invalid_integer")
            continue
        if parsed < 1:
            logger.warning("context_pack_activation.prompt.non_positive_integer")
            continue
        return parsed


def prompt_layer(default: str) -> str:
    while True:
        value = prompt(
            "Primary system layer (backend/frontend/infrastructure/database/documents/shared)",
            default,
        ).lower()
        if value in ALLOWED_LAYERS:
            return value
        logger.warning(
            "context_pack_activation.prompt.invalid_layer",
            extra={"allowed_layers": sorted(ALLOWED_LAYERS)},
        )


def detect_artifact_roots(repo_root: Path) -> list[str]:
    candidates = [
        "src",
        "app",
        "lib",
        "packages",
        "services",
        "server",
        "client",
        "frontend",
        "backend",
        "infra",
        "infrastructure",
        "schema",
        "db",
        "migrations",
    ]
    return [name for name in candidates if (repo_root / name).is_dir()]


def detect_document_paths(repo_root: Path) -> list[str]:
    return [name for name in ["docs"] if (repo_root / name).is_dir()]


def detect_system_layer(repo_root: Path) -> str:
    database_markers = ["schema", "db", "migrations", "sql"]
    infrastructure_markers = ["infra", "infrastructure", "terraform", "helm", "k8s", ".github/workflows"]
    frontend_markers = ["public", "components", "pages", "views"]
    frontend_config_files = [
        "next.config.js", "next.config.ts", "next.config.mjs",
        "vite.config.ts", "vite.config.js", "angular.json", "nuxt.config.ts",
    ]
    app_markers = ["src", "app", "lib", "server", "client", "packages"]

    has_database = any((repo_root / marker).exists() for marker in database_markers)
    has_infrastructure = any((repo_root / marker).exists() for marker in infrastructure_markers)
    has_frontend = any((repo_root / marker).exists() for marker in frontend_markers)
    has_frontend_config = any((repo_root / cfg).is_file() for cfg in frontend_config_files)
    has_app = any((repo_root / marker).exists() for marker in app_markers)

    if has_database and not has_app:
        return "database"
    if has_infrastructure and not has_app:
        return "infrastructure"

    if has_frontend or has_frontend_config:
        return "frontend"
    pkg_json = repo_root / "package.json"
    if pkg_json.is_file():
        try:
            pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
            all_deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
            if all_deps.keys() & {"react", "vue", "angular", "next", "nuxt", "svelte", "@angular/core"}:
                return "frontend"
        except Exception:
            logger.debug("Failed to parse package.json for framework detection")

    if has_app:
        return "backend"
    return "shared"


def detect_languages(repo_root: Path) -> list[str]:
    extension_map = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".go": "go",
        ".java": "java",
        ".kt": "kotlin",
        ".rb": "ruby",
        ".rs": "rust",
        ".cs": "csharp",
        ".php": "php",
        ".swift": "swift",
        ".sql": "sql",
        ".sh": "shell",
        ".tf": "hcl",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".json": "json",
    }
    excluded_parts = {".git", ".venv", "node_modules", "dist", "build", "qmd"}
    languages: list[str] = []
    seen: set[str] = set()
    scanned = 0

    for path in repo_root.rglob("*"):
        if scanned >= 250:
            break
        if not path.is_file():
            continue
        if any(part in excluded_parts for part in path.parts):
            continue
        scanned += 1
        language = extension_map.get(path.suffix.lower())
        if language and language not in seen:
            seen.add(language)
            languages.append(language)

    return languages


def infer_git_remote_owner_py(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "config", "--get", "remote.origin.url"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""

    remote = result.stdout.strip()
    if not remote:
        return ""

    for separator in ("github.com:", "github.com/", "gitlab.com:", "gitlab.com/"):
        if separator in remote:
            tail = remote.split(separator, 1)[1]
            parts = tail.split("/")
            if parts:
                return parts[0].strip()

    parts = remote.rstrip("/").split("/")
    if len(parts) >= 2:
        return parts[-2].strip()
    return ""


def build_repo_defaults(repo_root_value: str, fallback_owner: str = "") -> dict[str, object]:
    if not repo_root_value:
        return {
            "repo_root": "",
            "repo_name": "repo",
            "repo_id": "repo",
            "owner": fallback_owner,
            "system_layer": "shared",
            "languages": [],
            "artifact_roots": [],
            "document_paths": [],
        }

    repo_root = Path(repo_root_value).expanduser().resolve()
    root_exists = repo_root.exists()
    repo_name = repo_root.name or "repo"
    return {
        "repo_root": str(repo_root),
        "repo_name": repo_name,
        "repo_id": slugify(repo_name),
        "owner": infer_git_remote_owner_py(repo_root) if root_exists else fallback_owner,
        "system_layer": detect_system_layer(repo_root) if root_exists else "shared",
        "languages": detect_languages(repo_root) if root_exists else [],
        "artifact_roots": detect_artifact_roots(repo_root) if root_exists else [],
        "document_paths": detect_document_paths(repo_root) if root_exists else [],
    }


def normalize_repo_entry(raw_repo: dict[str, object], *, default_repo_root: str, fallback_owner: str) -> dict[str, object]:
    defaults = build_repo_defaults(default_repo_root, fallback_owner)

    repo_root_value = str(
        raw_repo.get("repo_root")
        or raw_repo.get("local_path")
        or raw_repo.get("local_root")
        or default_repo_root
        or defaults["repo_root"]
    ).strip()
    repo_defaults = build_repo_defaults(repo_root_value, fallback_owner)

    repo_name = str(
        raw_repo.get("repo_name")
        or raw_repo.get("project_name")
        or repo_defaults["repo_name"]
    ).strip() or str(repo_defaults["repo_name"])
    repo_id = slugify(str(raw_repo.get("repo_id") or repo_name))
    owner = str(raw_repo.get("owner") or repo_defaults["owner"] or "").strip()
    system_layer = str(raw_repo.get("system_layer") or repo_defaults["system_layer"] or "shared").strip().lower()
    if system_layer not in ALLOWED_LAYERS:
        raise SystemExit(f"Unsupported system_layer for bootstrap questionnaire: {system_layer}")

    return {
        "repo_id": repo_id,
        "repo_name": repo_name,
        "repo_root": repo_root_value,
        "owner": owner,
        "system_layer": system_layer,
        "languages": normalize_string_list(raw_repo.get("languages", repo_defaults["languages"])),
        "artifact_roots": normalize_string_list(raw_repo.get("artifact_roots", repo_defaults["artifact_roots"])),
        "document_paths": normalize_string_list(raw_repo.get("document_paths", repo_defaults["document_paths"])),
        "bounded_context": str(raw_repo.get("bounded_context") or "").strip(),
        "service_name": str(raw_repo.get("service_name") or "").strip(),
    }


def prompt_repo_entry(index: int, total: int, *, default_repo_root: str, fallback_owner: str) -> dict[str, object]:
    write_protocol_stdout(str(f"Repository {index} of {total}:") + '\n')
    repo_root_value = prompt("Local repo root", default_repo_root)
    repo_defaults = build_repo_defaults(repo_root_value, fallback_owner)
    return normalize_repo_entry(
        {
            "repo_root": repo_root_value,
            "repo_name": prompt("Repository display name", str(repo_defaults["repo_name"])),
            "repo_id": prompt("Repository ID", str(repo_defaults["repo_id"])),
            "owner": prompt("Repository owner or org", str(repo_defaults["owner"])),
            "system_layer": prompt_layer(str(repo_defaults["system_layer"])),
            "languages": normalize_csv_list(prompt("Languages (comma-separated)", ", ".join(str(v) for v in (repo_defaults["languages"] or [])))),  # type: ignore[union-attr]
            "artifact_roots": normalize_csv_list(prompt("Artifact roots to scan (comma-separated)", ", ".join(str(v) for v in (repo_defaults["artifact_roots"] or [])))),  # type: ignore[union-attr]
            "document_paths": normalize_csv_list(prompt("Document paths to scan (comma-separated)", ", ".join(str(v) for v in (repo_defaults["document_paths"] or [])))),  # type: ignore[union-attr]
            "bounded_context": prompt("Bounded context (optional)", ""),
            "service_name": prompt("Service name (optional)", ""),
        },
        default_repo_root=repo_root_value,
        fallback_owner=fallback_owner,
    )
