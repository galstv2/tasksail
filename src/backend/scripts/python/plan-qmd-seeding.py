#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from lib.protocol_output import write_protocol_stderr, write_protocol_stdout

DEFAULT_MANIFEST = "qmd/repo-sources.json"
DEFAULT_PLAN_FILE = "qmd/bootstrap/seed-plan.json"

_REPO_ROOT = Path(__file__).resolve().parents[4]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.backend.mcp.pack.constants import (  # noqa: E402
    MANIFEST_VERSION as DEFAULT_MANIFEST_VERSION,
)
from src.backend.mcp.pack_schemas.manifest_v2 import LocalPath  # noqa: E402
from src.backend.mcp.probes.git_roots import coerce_git_root_field  # noqa: E402
from src.backend.mcp.probes.path_resolution import pick_local_path  # noqa: E402
from src.backend.mcp.repo_context_mcp.utils import (  # noqa: E402
    ensure_list_of_strings,
    ensure_non_empty_string,
    normalize_layer,
    unique_preserving_order,
)
from src.backend.scripts.python.lib.logging_config import configure_logging  # noqa: E402


@dataclass
class RepoPlan:
    repo_id: str
    repo_name: str
    owner: str | None
    bounded_context: str | None
    system_layer: str
    languages: list[str]
    tags: list[str]
    existing_roots: list[str]
    missing_roots: list[str]
    scan_targets: list[str]
    qmd_targets: dict[str, Any]
    status: str
    warnings: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a dry-run QMD seeding plan for a context pack, with "
            "multi-repository support."
        )
    )
    parser.add_argument(
        "--context-pack-dir",
        required=True,
        help="Path to the active context pack directory.",
    )
    parser.add_argument(
        "--manifest",
        default=DEFAULT_MANIFEST,
        help=(
            "Path to the repo-sources manifest, relative to the context pack "
            "directory unless absolute."
        ),
    )
    parser.add_argument(
        "--plan-file",
        default=DEFAULT_PLAN_FILE,
        help=(
            "Path to write the generated dry-run plan, relative to the "
            "context pack directory unless absolute."
        ),
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format for stdout.",
    )
    parser.add_argument(
        "--write-plan",
        action="store_true",
        help="Write the generated plan JSON to --plan-file.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress stdout output and only use exit status plus warnings.",
    )
    return parser.parse_args()


def resolve_path(base_dir: Path, value: str) -> Path:
    raw_path = Path(value)
    if raw_path.is_absolute():
        return raw_path
    return (base_dir / raw_path).resolve()


def load_json(path: Path) -> dict[str, Any]:
    # Intentionally local: emits manifest-specific operator-facing error
    # messages. Distinct by design from lib.io.load_json (generic messages,
    # TypeError on non-object) and repo_context_mcp.utils.load_json.
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Manifest file is missing: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Manifest file is not valid JSON: {path}: {exc}"
        ) from exc


def coerce_local_path(value: Any) -> LocalPath:
    if isinstance(value, str):
        return LocalPath(host=value.replace("\\", "/"))
    if isinstance(value, dict) and isinstance(value.get("host"), str):
        container = value.get("container")
        if container is not None and not isinstance(container, str):
            raise ValueError("local_paths[].container must be a string or null")
        return LocalPath(
            host=value["host"].replace("\\", "/"),
            container=container.replace("\\", "/") if isinstance(container, str) else None,
            git_root=coerce_git_root_field(value.get("git_root")),
        )
    raise ValueError("local_paths entries must be strings or objects with host")


def normalize_plan_repo_entry(
    context_pack_dir: Path,
    entry: dict[str, Any],
    qmd_scope_root: str,
) -> RepoPlan:
    repo_name = str(entry.get("repo_name") or entry.get("name") or "").strip()
    repo_id = str(entry.get("repo_id") or repo_name).strip()
    if not repo_id:
        raise ValueError(
            "Each repository entry requires 'repo_id' or 'repo_name'"
        )
    if not repo_name:
        repo_name = repo_id

    raw_local_paths = entry.get("local_paths") or []
    if not isinstance(raw_local_paths, list):
        raise ValueError("Field 'local_paths' must be a list")
    local_paths = [coerce_local_path(item) for item in raw_local_paths]
    if not local_paths:
        raise ValueError(
            f"Repository '{repo_id}' requires at least one local path"
        )

    artifact_roots = ensure_list_of_strings(
        entry.get("artifact_roots"),
        "artifact_roots",
    )
    document_paths = ensure_list_of_strings(
        entry.get("document_paths"),
        "document_paths",
    )
    languages = [item.strip().lower() for item in ensure_list_of_strings(
        entry.get("languages"),
        "languages",
    ) if item.strip()]
    tags = [
        item.strip()
        for item in ensure_list_of_strings(entry.get("tags"), "tags")
        if item.strip()
    ]

    bounded_context = str(entry.get("bounded_context") or "").strip() or None
    system_layer = normalize_layer(entry.get("system_layer"))

    existing_roots: list[str] = []
    missing_roots: list[str] = []
    scan_targets: list[str] = []
    warnings: list[str] = []

    for local_path in local_paths:
        resolved_root = resolve_path(context_pack_dir, pick_local_path(local_path))
        root_str = str(resolved_root)
        if resolved_root.exists():
            existing_roots.append(root_str)
            if artifact_roots:
                for artifact_root in artifact_roots:
                    scan_targets.append(
                        str((resolved_root / artifact_root).resolve())
                    )
            else:
                scan_targets.append(root_str)

            for document_path in document_paths:
                scan_targets.append(
                    str((resolved_root / document_path).resolve())
                )
        else:
            missing_roots.append(root_str)

    scan_targets = unique_preserving_order(scan_targets)

    if not existing_roots:
        warnings.append(
            "No configured local paths currently exist; this repo cannot be "
            "seeded yet."
        )
    if not languages:
        warnings.append(
            "No languages declared; retrieval will rely more heavily on path "
            "and repo tags."
        )
    if not bounded_context:
        warnings.append(
            "No bounded_context declared; cross-repo retrieval may be less precise."
        )
    if missing_roots:
        warnings.append(
            "One or more configured local paths are missing; review "
            "workstation "
            "checkout locations."
        )
    if not artifact_roots and not document_paths:
        warnings.append(
            "No artifact_roots or document_paths declared; dry-run will fall back to broad repo-root scanning."
        )

    qmd_targets: dict[str, Any] = {
        "canonical_repo_summary": (
            f"{qmd_scope_root}/canonical/repos/{repo_id}/repo-summary.md"
        ),
        "operational_bootstrap_note": (
            f"{qmd_scope_root}/operational/bootstrap/{repo_id}/"
            "initial-index.md"
        ),
        "estate_partition": (
            f"{qmd_scope_root}/estate/{system_layer}/{repo_id}/"
        ),
        "language_partitions": [
            f"{qmd_scope_root}/estate/languages/{language}/{repo_id}/"
            for language in languages
        ],
    }

    if bounded_context:
        qmd_targets["bounded_context_summary"] = (
            f"{qmd_scope_root}/canonical/contexts/{bounded_context}/"
            f"repo-{repo_id}.md"
        )
    if document_paths:
        qmd_targets["documents_partition"] = (
            f"{qmd_scope_root}/estate/documents/{repo_id}/"
        )

    status = "ready" if existing_roots else "blocked"

    if status == "ready" and not artifact_roots and not document_paths and existing_roots:
        broad_file_count = 0
        excluded_dirs = {
            ".git", ".venv", "venv", "node_modules", "__pycache__",
            "bin", "obj", "dist", "build",
        }
        for root_path_str in existing_roots:
            root_path = Path(root_path_str)
            if root_path.is_dir():
                for item in root_path.rglob("*"):
                    if any(part in excluded_dirs for part in item.parts):
                        continue
                    if item.is_file():
                        broad_file_count += 1
                    if broad_file_count >= 5:
                        break
            if broad_file_count >= 5:
                break
        if broad_file_count < 5:
            status = "needs-review"
            warnings.append(
                "Broad repo-root scan found fewer than 5 files; this repo "
                "may be under-seeded. Consider adding artifact_roots or "
                "verifying repo contents."
            )

    return RepoPlan(
        repo_id=repo_id,
        repo_name=repo_name,
        owner=str(entry.get("owner") or "").strip() or None,
        bounded_context=bounded_context,
        system_layer=system_layer,
        languages=languages,
        tags=tags,
        existing_roots=existing_roots,
        missing_roots=missing_roots,
        scan_targets=scan_targets,
        qmd_targets=qmd_targets,
        status=status,
        warnings=warnings,
    )


def build_plan(context_pack_dir: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = load_json(manifest_path)
    context_pack_id = ensure_non_empty_string(
        manifest.get("context_pack_id") or context_pack_dir.name,
        "context_pack_id",
    )

    qmd_scope_root = ensure_non_empty_string(
        manifest.get("qmd_scope_root")
        or f"qmd/context-packs/{context_pack_id}",
        "qmd_scope_root",
    )
    manifest_version = str(
        manifest.get("manifest_version") or DEFAULT_MANIFEST_VERSION
    ).strip() or DEFAULT_MANIFEST_VERSION

    repositories = manifest.get("repositories")
    if not isinstance(repositories, list) or not repositories:
        raise ValueError("Manifest requires a non-empty 'repositories' list")

    repo_plans: list[RepoPlan] = []
    seen_repo_ids: set[str] = set()
    for raw_entry in repositories:
        if not isinstance(raw_entry, dict):
            raise ValueError("Each repository entry must be a JSON object")
        normalized = normalize_plan_repo_entry(context_pack_dir, raw_entry, qmd_scope_root)
        if normalized.repo_id in seen_repo_ids:
            raise ValueError(
                f"Duplicate repository repo_id detected in manifest: {normalized.repo_id}"
            )
        seen_repo_ids.add(normalized.repo_id)
        repo_plans.append(normalized)

    warning_count = sum(len(plan.warnings) for plan in repo_plans)
    ready_count = sum(1 for plan in repo_plans if plan.status == "ready")
    blocked_count = sum(1 for plan in repo_plans if plan.status == "blocked")
    overall_status = "ready" if blocked_count == 0 else "needs-review"

    return {
        "plan_type": "qmd-seeding-dry-run",
        "plan_version": "qmd-seeding-dry-run/v1",
        "manifest_version": manifest_version,
        "context_pack_id": context_pack_id,
        "context_pack_dir": str(context_pack_dir),
        "manifest_path": str(manifest_path),
        "qmd_scope_root": qmd_scope_root,
        "overall_status": overall_status,
        "repository_count": len(repo_plans),
        "ready_count": ready_count,
        "blocked_count": blocked_count,
        "warning_count": warning_count,
        "repositories": [plan.__dict__ for plan in repo_plans],
        "next_steps": [
            "Review blocked repositories and fix missing local paths "
            "before live seeding.",
            "Approve the QMD targets and scan targets repo by repo.",
            "Run the actual repo-context or QMD seed flow only after "
            "this dry-run plan is accepted.",
        ],
    }


def render_markdown(plan: dict[str, Any]) -> str:
    lines = [
        "# QMD Seeding Dry Run",
        "",
        f"- Context Pack ID: {plan['context_pack_id']}",
        f"- Context Pack Dir: {plan['context_pack_dir']}",
        f"- Manifest Path: {plan['manifest_path']}",
        f"- Manifest Version: {plan['manifest_version']}",
        f"- QMD Scope Root: {plan['qmd_scope_root']}",
        f"- Overall Status: {plan['overall_status']}",
        f"- Repositories: {plan['repository_count']}",
        f"- Ready: {plan['ready_count']}",
        f"- Blocked: {plan['blocked_count']}",
        f"- Warnings: {plan['warning_count']}",
        "",
        "## Repository Plan",
        "",
    ]

    for repo in plan["repositories"]:
        lines.extend(
            [
                f"### {repo['repo_id']}",
                "",
                f"- Status: {repo['status']}",
                f"- Repo Name: {repo['repo_name']}",
                f"- Owner: {repo['owner'] or 'unknown'}",
                f"- System Layer: {repo['system_layer']}",
                "- Bounded Context: "
                f"{repo['bounded_context'] or 'unassigned'}",
                f"- Languages: "
                f"{', '.join(repo['languages']) or 'none declared'}",
                f"- Tags: {', '.join(repo['tags']) or 'none'}",
                "- Existing Roots:",
            ]
        )
        if repo["existing_roots"]:
            for root in repo["existing_roots"]:
                lines.append(f"  - {root}")
        else:
            lines.append("  - none")

        lines.append("- Missing Roots:")
        if repo["missing_roots"]:
            for root in repo["missing_roots"]:
                lines.append(f"  - {root}")
        else:
            lines.append("  - none")

        lines.append("- Scan Targets:")
        if repo["scan_targets"]:
            for target in repo["scan_targets"]:
                lines.append(f"  - {target}")
        else:
            lines.append("  - none")

        lines.append("- QMD Targets:")
        for key, value in repo["qmd_targets"].items():
            if isinstance(value, list):
                lines.append(f"  - {key}:")
                for item in value:
                    lines.append(f"    - {item}")
            else:
                lines.append(f"  - {key}: {value}")

        if repo["warnings"]:
            lines.append("- Warnings:")
            for warning in repo["warnings"]:
                lines.append(f"  - {warning}")

        lines.append("")

    lines.extend(["## Next Steps", ""])
    for step in plan["next_steps"]:
        lines.append(f"- {step}")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    configure_logging(stack="py", service="plan-qmd-seeding")
    args = parse_args()
    context_pack_dir = resolve_path(Path.cwd(), args.context_pack_dir)
    manifest_path = resolve_path(context_pack_dir, args.manifest)
    plan_file = resolve_path(context_pack_dir, args.plan_file)

    try:
        plan = build_plan(context_pack_dir, manifest_path)
    except ValueError as exc:
        write_protocol_stderr(str(f"QMD seeding dry run failed: {exc}") + '\n')
        return 1

    if args.write_plan:
        from src.backend.mcp.pack.writer import PackWriter
        from src.backend.mcp.pack_schemas import validate_plan
        plan_model = validate_plan(plan, path=str(plan_file))
        PackWriter(context_pack_dir, plan_file=plan_file).write_plan(plan_model)

    if not args.quiet:
        if args.format == "json":
            write_protocol_stdout(str(json.dumps(plan, indent=2, sort_keys=False)) + '\n')
        else:
            write_protocol_stdout(str(render_markdown(plan)) + '\n')

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
