#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.text import normalize_string_list  # noqa: E402

# ---------------------------------------------------------------------------
# Subcommand: infer-git-remote-owner
# ---------------------------------------------------------------------------

def cmd_infer_git_remote_owner(args: argparse.Namespace) -> None:
    remote = args.remote_url.strip()
    owner = ""

    patterns = [
        r"github\.com[:/](?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$",
        r"gitlab\.com[:/](?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$",
        r"(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$",
    ]

    for pattern in patterns:
        match = re.search(pattern, remote)
        if match:
            owner = match.group("owner")
            break

    print(owner)


# ---------------------------------------------------------------------------
# Subcommand: collect-bootstrap-answers — helper definitions
# ---------------------------------------------------------------------------

ALLOWED_LAYERS = {
    "backend",
    "frontend",
    "test",
    "infrastructure",
    "database",
    "documents",
    "shared",
}


def slugify(value: str) -> str:
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
            print("Enter a whole number.", file=sys.stderr)
            continue
        if parsed < 1:
            print("Enter a value greater than zero.", file=sys.stderr)
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
        print("Enter one of: backend, frontend, infrastructure, database, documents, shared.", file=sys.stderr)


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
            import json as _json
            pkg = _json.loads(pkg_json.read_text(encoding="utf-8"))
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
    print(f"Repository {index} of {total}:")
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


# ---------------------------------------------------------------------------
# Subcommand: collect-bootstrap-answers — main handler
# ---------------------------------------------------------------------------

def cmd_collect_bootstrap_answers(args: argparse.Namespace) -> None:
    output_path = Path(args.output_path)
    context_pack_dir = Path(args.context_pack_dir)
    repo_root = Path(args.repo_root).resolve()
    provided_context_pack_id = args.context_pack_id.strip()
    inferred_owner = args.inferred_owner.strip()
    answers_file = Path(args.answers_file).resolve() if args.answers_file and args.answers_file.strip() else None

    default_context_pack_id = slugify(provided_context_pack_id or context_pack_dir.name)
    default_project_name = repo_root.name

    if answers_file is not None:
        raw_answers = json.loads(answers_file.read_text(encoding="utf-8"))
    elif sys.stdin.isatty():
        print("Bootstrap questionnaire: answer these structured prompts so the platform can create the context pack correctly.")
        repo_count = prompt_int("How many repositories are in scope for this context pack", 1)
        repositories: list[dict[str, object]] = []
        for repo_index in range(1, repo_count + 1):
            repositories.append(
                prompt_repo_entry(
                    repo_index,
                    repo_count,
                    default_repo_root=str(repo_root) if repo_index == 1 else "",
                    fallback_owner=inferred_owner if repo_index == 1 else "",
                )
            )
        raw_answers = {
            "context_pack_id": prompt("Context-pack ID", default_context_pack_id),
            "estate_name": prompt("Project or estate display name", default_project_name),
            "repositories": repositories,
        }
    else:
        raise SystemExit(
            "Automatic context-pack bootstrap requires a structured questionnaire. "
            "Rerun interactively or pass --answers-file <path>."
        )

    context_pack_id = slugify(str(raw_answers.get("context_pack_id") or default_context_pack_id))
    estate_name = str(raw_answers.get("estate_name") or raw_answers.get("project_name") or default_project_name).strip() or default_project_name

    raw_repositories = raw_answers.get("repositories")
    if raw_repositories is None:
        raw_repositories = [
            {
                "repo_root": raw_answers.get("repo_root") or str(repo_root),
                "repo_name": raw_answers.get("repo_name") or raw_answers.get("project_name") or default_project_name,
                "repo_id": raw_answers.get("repo_id"),
                "owner": raw_answers.get("owner") or inferred_owner,
                "system_layer": raw_answers.get("system_layer"),
                "languages": raw_answers.get("languages"),
                "artifact_roots": raw_answers.get("artifact_roots"),
                "document_paths": raw_answers.get("document_paths"),
                "bounded_context": raw_answers.get("bounded_context"),
                "service_name": raw_answers.get("service_name"),
            }
        ]

    if not isinstance(raw_repositories, list) or not raw_repositories:
        raise SystemExit("Bootstrap questionnaire requires at least one repository entry.")

    repositories_normalized = [
        normalize_repo_entry(
            raw_repo if isinstance(raw_repo, dict) else {},
            default_repo_root=str(repo_root) if index == 0 else "",
            fallback_owner=inferred_owner if index == 0 else "",
        )
        for index, raw_repo in enumerate(raw_repositories)
    ]

    answers = {
        "questionnaire_version": "context-pack-bootstrap/v1",
        "captured_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "context_pack_id": context_pack_id,
        "estate_name": estate_name,
        "repository_count": len(repositories_normalized),
        "repositories": repositories_normalized,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(answers, indent=2) + "\n", encoding="utf-8")
    print(str(output_path))


# ---------------------------------------------------------------------------
# Subcommand: extract-json-field
# ---------------------------------------------------------------------------

def cmd_extract_json_field(args: argparse.Namespace) -> None:
    path = Path(args.file_path)
    field = args.field_name

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        raise SystemExit(1)

    value = payload.get(field, "")
    if value is None:
        value = ""

    print(value)


# ---------------------------------------------------------------------------
# Subcommand: parse-seed-status
# ---------------------------------------------------------------------------

def cmd_parse_seed_status(args: argparse.Namespace) -> None:
    payload = json.loads(args.seed_output)
    print(payload.get("overall_status", "unknown"))


# ---------------------------------------------------------------------------
# Subcommand: extract-json-stdin-field
# ---------------------------------------------------------------------------

def cmd_extract_json_stdin_field(args: argparse.Namespace) -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        raise SystemExit(1)

    default = args.default if args.default is not None else ""
    value = payload.get(args.field_name, default)
    if value is None:
        value = default

    print(value)


# ---------------------------------------------------------------------------
# Subcommand: emit-json (workspace-sync JSON envelope helper)
# ---------------------------------------------------------------------------

def cmd_emit_json(args: argparse.Namespace) -> None:
    workspace_payload: dict[str, object] | object = {}
    if args.workspace_payload:
        try:
            workspace_payload = json.loads(args.workspace_payload)
        except json.JSONDecodeError:
            workspace_payload = {"raw_output": args.workspace_payload}

    activation_exit_code: int | None = None
    if args.activation_exit_code:
        try:
            activation_exit_code = int(args.activation_exit_code)
        except ValueError:
            pass

    payload: dict[str, object] = {
        "ok": args.ok == "true",
        "action": args.action,
        "stage": args.stage,
        "status": args.status,
        "activation": {
            "performed": args.activation_performed == "true",
            "exit_code": activation_exit_code,
            "output": args.activation_output,
        },
        "workspace": workspace_payload,
        "env_state_cleared": args.env_cleared == "true",
    }

    if args.error_message:
        payload["error"] = args.error_message

    print(json.dumps(payload, indent=2))


# ---------------------------------------------------------------------------
# CLI definition
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Helper subcommands for context-pack activation and workspace sync.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # -- infer-git-remote-owner ------------------------------------------------
    sp_infer = subparsers.add_parser(
        "infer-git-remote-owner",
        help="Parse a git remote URL and print the owner/org.",
    )
    sp_infer.add_argument("remote_url", help="The git remote URL to parse.")
    sp_infer.set_defaults(func=cmd_infer_git_remote_owner)

    # -- collect-bootstrap-answers ---------------------------------------------
    sp_collect = subparsers.add_parser(
        "collect-bootstrap-answers",
        help="Run the bootstrap questionnaire and write answers JSON.",
    )
    sp_collect.add_argument("--output-path", required=True, help="Path to write the answers JSON file.")
    sp_collect.add_argument("--context-pack-dir", required=True, help="Path to the context-pack directory.")
    sp_collect.add_argument("--repo-root", required=True, help="Path to the target repository root.")
    sp_collect.add_argument("--context-pack-id", default="", help="Provided context-pack ID (may be empty).")
    sp_collect.add_argument("--inferred-owner", default="", help="Pre-inferred repository owner/org.")
    sp_collect.add_argument("--answers-file", default="", help="Path to a pre-filled answers JSON file (optional).")
    sp_collect.set_defaults(func=cmd_collect_bootstrap_answers)

    # -- extract-json-field ----------------------------------------------------
    sp_extract = subparsers.add_parser(
        "extract-json-field",
        help="Read a JSON file and print a top-level field value.",
    )
    sp_extract.add_argument("file_path", help="Path to the JSON file.")
    sp_extract.add_argument("field_name", help="Top-level field name to extract.")
    sp_extract.set_defaults(func=cmd_extract_json_field)

    # -- parse-seed-status -----------------------------------------------------
    sp_seed = subparsers.add_parser(
        "parse-seed-status",
        help="Parse QMD seed output JSON and print the overall_status.",
    )
    sp_seed.add_argument("seed_output", help="The seed output JSON string.")
    sp_seed.set_defaults(func=cmd_parse_seed_status)

    # -- extract-json-stdin-field ----------------------------------------------
    sp_stdin = subparsers.add_parser(
        "extract-json-stdin-field",
        help="Read JSON from stdin and print a field value.",
    )
    sp_stdin.add_argument("field_name", help="Top-level field name to extract.")
    sp_stdin.add_argument("--default", default=None, help="Default value if field is missing (default: empty string).")
    sp_stdin.set_defaults(func=cmd_extract_json_stdin_field)

    # -- emit-json ---------------------------------------------------------------
    sp_emit = subparsers.add_parser(
        "emit-json",
        help="Build and print a structured JSON response payload.",
    )
    sp_emit.add_argument("--ok", default="false", help="Whether the operation succeeded (true/false).")
    sp_emit.add_argument("--action", default="", help="Action name.")
    sp_emit.add_argument("--stage", default="", help="Stage name.")
    sp_emit.add_argument("--status", default="", help="Status string.")
    sp_emit.add_argument("--activation-performed", default="false", help="Whether activation was performed (true/false).")
    sp_emit.add_argument("--activation-exit-code", default="", help="Activation exit code.")
    sp_emit.add_argument("--activation-output", default="", help="Activation output text.")
    sp_emit.add_argument("--workspace-payload", default="", help="Workspace JSON payload string.")
    sp_emit.add_argument("--error-message", default="", help="Error message (optional).")
    sp_emit.add_argument("--env-cleared", default="false", help="Whether env state was cleared (true/false).")
    sp_emit.set_defaults(func=cmd_emit_json)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
