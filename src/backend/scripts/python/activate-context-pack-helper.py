#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from lib.protocol_output import write_protocol_stdout

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
_REPO_ROOT = SCRIPT_DIR.parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from lib.context_pack_bootstrap_answers import (  # noqa: E402
    normalize_repo_entry,
    prompt,
    prompt_int,
    prompt_repo_entry,
    slugify,
)
from lib.logging_config import bind, configure_logging  # noqa: E402

logger = bind(
    logging.getLogger(__name__),
    module="scripts/python/activate-context-pack-helper",
)

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

    write_protocol_stdout(str(owner) + '\n')


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
        write_protocol_stdout(str("Bootstrap questionnaire: answer these structured prompts so the platform can create the context pack correctly.") + '\n')
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
    write_protocol_stdout(str(str(output_path)) + '\n')


def cmd_extract_json_field(args: argparse.Namespace) -> None:
    path = Path(args.file_path)
    field = args.field_name

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception(
            "context_pack_activation.extract_json_field.failed",
            extra={"file_path": str(path), "field_name": field},
        )
        raise SystemExit(1)

    value = payload.get(field, "")
    if value is None:
        value = ""

    write_protocol_stdout(str(value) + '\n')


def cmd_parse_seed_status(args: argparse.Namespace) -> None:
    payload = json.loads(args.seed_output)
    write_protocol_stdout(str(payload.get("overall_status", "unknown")) + '\n')


def cmd_extract_json_stdin_field(args: argparse.Namespace) -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        logger.exception(
            "context_pack_activation.extract_json_stdin_field.failed",
            extra={"field_name": args.field_name},
        )
        raise SystemExit(1)

    default = args.default if args.default is not None else ""
    value = payload.get(args.field_name, default)
    if value is None:
        value = default

    write_protocol_stdout(str(value) + '\n')


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

    write_protocol_stdout(str(json.dumps(payload, indent=2)) + '\n')


def main() -> None:
    configure_logging(stack="py", service="activate-context-pack-helper")
    parser = argparse.ArgumentParser(
        description="Helper subcommands for context-pack activation and workspace sync.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    sp_infer = subparsers.add_parser(
        "infer-git-remote-owner",
        help="Parse a git remote URL and print the owner/org.",
    )
    sp_infer.add_argument("remote_url", help="The git remote URL to parse.")
    sp_infer.set_defaults(func=cmd_infer_git_remote_owner)

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

    sp_extract = subparsers.add_parser(
        "extract-json-field",
        help="Read a JSON file and print a top-level field value.",
    )
    sp_extract.add_argument("file_path", help="Path to the JSON file.")
    sp_extract.add_argument("field_name", help="Top-level field name to extract.")
    sp_extract.set_defaults(func=cmd_extract_json_field)

    sp_seed = subparsers.add_parser(
        "parse-seed-status",
        help="Parse QMD seed output JSON and print the overall_status.",
    )
    sp_seed.add_argument("seed_output", help="The seed output JSON string.")
    sp_seed.set_defaults(func=cmd_parse_seed_status)

    sp_stdin = subparsers.add_parser(
        "extract-json-stdin-field",
        help="Read JSON from stdin and print a field value.",
    )
    sp_stdin.add_argument("field_name", help="Top-level field name to extract.")
    sp_stdin.add_argument("--default", default=None, help="Default value if field is missing (default: empty string).")
    sp_stdin.set_defaults(func=cmd_extract_json_stdin_field)

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
