from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
REPO_ROOT = SCRIPT_DIR.parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from lib.role_agent.corrections_cmds import cmd_render_corrections_context  # noqa: E402
from lib.role_agent.tests_md_append import (  # noqa: E402
    cmd_check_parallel_tests_md_section,
    cmd_write_parallel_tests_md_stub,
)
from lib.role_agent.reinforcement_cmds import cmd_render_reinforcement_context  # noqa: E402
from lib.role_agent.code_diff import capture_code_diff  # noqa: E402
from lib.role_agent.json_cmds import cmd_print_json_array_lines  # noqa: E402
from lib.role_agent.metadata import cmd_resolve_agent_metadata  # noqa: E402
from lib.role_agent.external_mcp import (  # noqa: E402
    LaunchContext,
    load_validated_external_mcp,
    prepare_launch_context,
    select_servers_for_agent,
)
from lib.role_agent.external_mcp.loader import ExternalMcpLoadError  # noqa: E402


def _cmd_capture_code_diff(args: argparse.Namespace) -> int:
    exit_code, repo_names = capture_code_diff(
        args.context_pack_dir, args.output_path, args.repo_root,
    )
    # Print repo names so the shell script can export them without
    # a second subprocess invocation.
    print(",".join(repo_names))
    return exit_code


def _cmd_task_counter_position(args: argparse.Namespace) -> int:
    from lib.counters.task_completion_counter import TaskCompletionCounter
    root_dir = args.root_dir.resolve()
    pack_dir_str = str(args.context_pack_dir).strip()
    pack_dir = Path(pack_dir_str).resolve() if pack_dir_str else None
    counter = TaskCompletionCounter.from_context_pack_dir(root_dir, pack_dir)
    print(f"{counter.cycle_position()} {str(counter.is_retrospective_required()).lower()}")
    return 0


def _launch_context_payload(context: LaunchContext) -> dict[str, object]:
    return {
        "status": context.status,
        "reason": context.reason,
        "injectionEnabled": context.injection_enabled,
        "envExports": context.env_exports(),
        "selectedServerIds": [
            str(server.get("id", "?")) for server in context.selected_servers
        ],
        "excludedServerIds": [str(server_id) for server_id in context.excluded_servers],
    }


def _cmd_prepare_external_mcp_launch_context(args: argparse.Namespace) -> int:
    repo_root = Path(args.repo_root).resolve()

    try:
        registry = load_validated_external_mcp(repo_root)
        servers = select_servers_for_agent(
            registry.get("external_servers", []), args.agent_id,
        )
        context = prepare_launch_context(repo_root, args.agent_id, servers)
    except ExternalMcpLoadError as exc:
        context = LaunchContext(
            status="malformed",
            reason=str(exc),
            injection_enabled=False,
        )
    except Exception as exc:
        print(
            f"[external-mcp] Unexpected error preparing launch context: {exc}",
            file=sys.stderr,
        )
        return 1

    print(json.dumps(_launch_context_payload(context)))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    metadata_parser = subparsers.add_parser("resolve-agent-metadata")
    metadata_parser.add_argument("registry_path", type=Path)
    metadata_parser.add_argument("agent_id")
    metadata_parser.set_defaults(func=cmd_resolve_agent_metadata)

    json_array_parser = subparsers.add_parser("print-json-array-lines")
    json_array_parser.add_argument("json_payload")
    json_array_parser.set_defaults(func=cmd_print_json_array_lines)

    counter_parser = subparsers.add_parser("task-counter-position")
    counter_parser.add_argument("root_dir", type=Path)
    counter_parser.add_argument("context_pack_dir", nargs="?", default="")
    counter_parser.set_defaults(func=_cmd_task_counter_position)

    corrections_ctx_parser = subparsers.add_parser("render-corrections-context")
    corrections_ctx_parser.add_argument("summary_json", type=Path)
    corrections_ctx_parser.add_argument("output_path", type=Path)
    corrections_ctx_parser.add_argument("export_path", type=Path)
    corrections_ctx_parser.set_defaults(func=cmd_render_corrections_context)

    par_tests_check = subparsers.add_parser("check-parallel-tests-md-section")
    par_tests_check.add_argument("root_dir", type=Path)
    par_tests_check.add_argument("instance_id")
    par_tests_check.set_defaults(func=cmd_check_parallel_tests_md_section)

    par_tests_stub = subparsers.add_parser("write-parallel-tests-md-stub")
    par_tests_stub.add_argument("root_dir", type=Path)
    par_tests_stub.add_argument("instance_id")
    par_tests_stub.add_argument("slice_id")
    par_tests_stub.add_argument("slice_path")
    par_tests_stub.set_defaults(func=cmd_write_parallel_tests_md_stub)

    reinforcement_parser = subparsers.add_parser("render-reinforcement-context")
    reinforcement_parser.add_argument("context_pack_dir", type=Path)
    reinforcement_parser.add_argument("agent_id")
    reinforcement_parser.add_argument("output_path", type=Path)
    reinforcement_parser.add_argument("export_path", type=Path)
    reinforcement_parser.add_argument(
        "--repo-root", dest="repo_root",
        default=str(Path(__file__).resolve().parents[4]),
    )
    reinforcement_parser.set_defaults(func=cmd_render_reinforcement_context)

    diff_parser = subparsers.add_parser("capture-code-diff")
    diff_parser.add_argument("context_pack_dir")
    diff_parser.add_argument("output_path")
    diff_parser.add_argument("--repo-root", default=None)
    diff_parser.set_defaults(func=_cmd_capture_code_diff)

    external_mcp_parser = subparsers.add_parser("prepare-external-mcp-launch-context")
    external_mcp_parser.add_argument("agent_id")
    external_mcp_parser.add_argument(
        "--repo-root", dest="repo_root",
        default=str(Path(__file__).resolve().parents[4]),
    )
    external_mcp_parser.set_defaults(func=_cmd_prepare_external_mcp_launch_context)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
