from __future__ import annotations

import argparse
import json
import os
from typing import Any, Callable

from src.backend.scripts.python.lib.protocol_output import write_protocol_stdout

from ..services import (
    RESEED_IN_PROGRESS_ERROR_CODE,
    ReseedAlreadyInProgressError,
)
from ..utils import ensure_non_empty_string


class RepoContextCli:
    def __init__(
        self,
        *,
        default_host: str,
        default_port: int,
        default_manifest: str,
        default_plan_file: str,
        execute_seed_run: Callable[..., dict[str, Any]],
        load_context_pack_conventions_summary: Callable[..., dict[str, Any]],
        build_carry_forward_summary: Callable[..., dict[str, Any]],
        build_task_lineage_summary: Callable[..., dict[str, Any]],
        load_behavior_correction_memo_summary: Callable[..., dict[str, Any]],
        render_context_pack_conventions_summary: Callable[
            [dict[str, Any]],
            str,
        ],
        render_behavior_correction_memo: Callable[[dict[str, Any]], str],
        render_run_markdown: Callable[[dict[str, Any]], str],
    ) -> None:
        self.default_host = default_host
        self.default_port = default_port
        self.default_manifest = default_manifest
        self.default_plan_file = default_plan_file
        self.execute_seed_run = execute_seed_run
        self.load_context_pack_conventions_summary = (
            load_context_pack_conventions_summary
        )
        self.build_carry_forward_summary = build_carry_forward_summary
        self.build_task_lineage_summary = build_task_lineage_summary
        self.load_behavior_correction_memo_summary = (
            load_behavior_correction_memo_summary
        )
        self.render_context_pack_conventions_summary = (
            render_context_pack_conventions_summary
        )
        self.render_behavior_correction_memo = (
            render_behavior_correction_memo
        )
        self.render_run_markdown = render_run_markdown

    def parse_args(self, argv: list[str] | None = None) -> argparse.Namespace:
        parser = argparse.ArgumentParser(
            description="Repo-context MCP runtime"
        )
        parser.set_defaults(
            command="serve",
            host=self.default_host,
            port=self.default_port,
        )
        subparsers = parser.add_subparsers(dest="command")

        serve_parser = subparsers.add_parser(
            "serve",
            help="Run the HTTP server",
        )
        serve_parser.set_defaults(command="serve")
        serve_parser.add_argument("--host", default=self.default_host)
        serve_parser.add_argument(
            "--port",
            type=int,
            default=self.default_port,
        )

        seed_parser = subparsers.add_parser(
            "seed",
            help="Run live QMD seeding once",
            epilog=(
                "Exit codes: 0 = success or completed-with-blocked-repos; "
                "1 = seed run produced overall_status=failed; "
                "2 = another reseed is already in progress (structured "
                "JSON conflict on stdout)."
            ),
            formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        seed_parser.add_argument(
            "--context-pack-dir",
            default=os.getenv("ACTIVE_CONTEXT_PACK_DIR", ""),
            help="Path to the active context-pack directory.",
        )
        seed_parser.add_argument("--manifest", default=self.default_manifest)
        seed_parser.add_argument("--plan-file", default=self.default_plan_file)
        seed_parser.add_argument(
            "--plan-mode",
            choices=("prefer-plan", "require-plan", "manifest-only"),
            default="prefer-plan",
            help="Whether to prefer or require an approved dry-run plan.",
        )
        seed_parser.add_argument(
            "--format",
            choices=("json", "markdown"),
            default="markdown",
            help="Output format for the final run report.",
        )
        seed_parser.add_argument(
            "--no-write-report",
            action="store_true",
            help="Do not persist the run report under the QMD scope.",
        )

        conventions_parser = subparsers.add_parser(
            "conventions",
            help="Read the active context-pack conventions memo.",
        )
        conventions_parser.add_argument(
            "--context-pack-dir",
            default=os.getenv("ACTIVE_CONTEXT_PACK_DIR", ""),
            help="Path to the active context-pack directory.",
        )
        conventions_parser.add_argument(
            "--format",
            choices=("json", "markdown"),
            default="markdown",
            help="Output format for the conventions summary.",
        )

        corrections_parser = subparsers.add_parser(
            "corrections",
            help="Read the active context-pack behavior correction memo.",
        )
        corrections_parser.add_argument(
            "--context-pack-dir",
            default=os.getenv("ACTIVE_CONTEXT_PACK_DIR", ""),
            help="Path to the active context-pack directory.",
        )
        corrections_parser.add_argument(
            "--format",
            choices=("json", "markdown"),
            default="markdown",
            help="Output format for the corrections summary.",
        )

        carry_forward_parser = subparsers.add_parser(
            "carry-forward",
            help=(
                "Resolve a parent task archive and generate a compact "
                "child-task "
                "carry-forward summary"
            ),
        )
        carry_forward_parser.add_argument(
            "--context-pack-dir",
            default=os.getenv("ACTIVE_CONTEXT_PACK_DIR", ""),
            help="Path to the active context-pack directory.",
        )
        carry_forward_parser.add_argument(
            "--parent-qmd-scope",
            required=True,
            help="Scoped QMD root containing the parent task archive.",
        )
        carry_forward_parser.add_argument(
            "--parent-qmd-record-id",
            default="",
            help="Exact parent task-archive record ID.",
        )
        carry_forward_parser.add_argument(
            "--parent-task-id",
            default="",
            help="Parent task ID used for scoped fallback lookup.",
        )
        carry_forward_parser.add_argument(
            "--format",
            choices=("json", "markdown"),
            default="markdown",
            help="Output format for the carry-forward summary.",
        )

        lineage_parser = subparsers.add_parser(
            "lineage",
            help=(
                "Inspect parent, sibling, and root-lineage relationships for "
                "task-archive records"
            ),
        )
        lineage_parser.add_argument(
            "--context-pack-dir",
            default=os.getenv("ACTIVE_CONTEXT_PACK_DIR", ""),
            help="Path to the active context-pack directory.",
        )
        lineage_parser.add_argument(
            "--qmd-scope",
            required=True,
            help="Scoped QMD root containing the lineage tree.",
        )
        lineage_parser.add_argument(
            "--task-id",
            default="",
            help=(
                "Task ID whose immediate parent, siblings, and direct "
                "children "
                "should be resolved."
            ),
        )
        lineage_parser.add_argument(
            "--root-task-id",
            default="",
            help=(
                "Root task ID whose broader lineage history should be "
                "resolved."
            ),
        )
        lineage_parser.add_argument(
            "--format",
            choices=("json", "markdown"),
            default="markdown",
            help="Output format for the lineage summary.",
        )

        return parser.parse_args(argv)

    def run(
        self,
        argv: list[str] | None,
        run_server: Callable[[str, int], int],
    ) -> int:
        args = self.parse_args(argv)
        command = args.command or "serve"

        if command == "serve":
            return run_server(args.host, args.port)

        if command == "seed":
            return self._run_seed(args)

        if command == "conventions":
            return self._run_conventions(args)

        if command == "corrections":
            return self._run_corrections(args)

        if command == "carry-forward":
            return self._run_carry_forward(args)

        if command == "lineage":
            return self._run_lineage(args)

        raise ValueError(f"Unsupported command: {command}")

    def _run_seed(self, args: argparse.Namespace) -> int:
        context_pack_dir = ensure_non_empty_string(
            args.context_pack_dir,
            "context_pack_dir",
        )
        try:
            report = self.execute_seed_run(
                context_pack_dir=context_pack_dir,
                manifest=args.manifest,
                plan_file=args.plan_file,
                plan_mode=args.plan_mode,
                write_report=not args.no_write_report,
            )
        except ReseedAlreadyInProgressError as exc:
            write_protocol_stdout(str(json.dumps({
                "error": RESEED_IN_PROGRESS_ERROR_CODE,
                "message": str(exc),
                "pid": exc.pid,
                "host": exc.host,
                "started_at": exc.started_at,
                "same_host": exc.same_host,
                "stale_after_seconds": exc.stale_after_seconds,
            }, indent=2, sort_keys=False)) + '\n')
            return 2
        if args.format == "json":
            write_protocol_stdout(str(json.dumps(report, indent=2, sort_keys=False)) + '\n')
        else:
            write_protocol_stdout(str(self.render_run_markdown(report)) + '\n')
        return (
            0
            if report["overall_status"]
            in {"success", "completed-with-blocked-repos"}
            else 1
        )

    def _run_conventions(self, args: argparse.Namespace) -> int:
        context_pack_dir = ensure_non_empty_string(
            args.context_pack_dir,
            "context_pack_dir",
        )
        summary = self.load_context_pack_conventions_summary(
            context_pack_dir=context_pack_dir,
        )
        if args.format == "json":
            write_protocol_stdout(str(json.dumps(summary, indent=2, sort_keys=False)) + '\n')
        else:
            write_protocol_stdout(str(self.render_context_pack_conventions_summary(summary)) + '\n')
        return 0

    def _run_corrections(self, args: argparse.Namespace) -> int:
        context_pack_dir = ensure_non_empty_string(
            args.context_pack_dir,
            "context_pack_dir",
        )
        summary = self.load_behavior_correction_memo_summary(
            context_pack_dir=context_pack_dir,
        )
        if args.format == "json":
            write_protocol_stdout(str(json.dumps(summary, indent=2, sort_keys=False)) + '\n')
        else:
            write_protocol_stdout(str(self.render_behavior_correction_memo(summary)) + '\n')
        return 0

    def _run_carry_forward(self, args: argparse.Namespace) -> int:
        context_pack_dir = ensure_non_empty_string(
            args.context_pack_dir,
            "context_pack_dir",
        )
        summary = self.build_carry_forward_summary(
            context_pack_dir=context_pack_dir,
            parent_qmd_scope=args.parent_qmd_scope,
            parent_qmd_record_id=args.parent_qmd_record_id.strip() or None,
            parent_task_id=args.parent_task_id.strip() or None,
        )
        if args.format == "json":
            write_protocol_stdout(str(json.dumps(summary, indent=2, sort_keys=False)) + '\n')
        else:
            write_protocol_stdout(str(summary["rendered_summary_markdown"]) + '\n')
        return 0

    def _run_lineage(self, args: argparse.Namespace) -> int:
        context_pack_dir = ensure_non_empty_string(
            args.context_pack_dir,
            "context_pack_dir",
        )
        summary = self.build_task_lineage_summary(
            context_pack_dir=context_pack_dir,
            qmd_scope=args.qmd_scope,
            task_id=args.task_id.strip() or None,
            root_task_id=args.root_task_id.strip() or None,
        )
        if args.format == "json":
            write_protocol_stdout(str(json.dumps(summary, indent=2, sort_keys=False)) + '\n')
        else:
            write_protocol_stdout(str(summary["rendered_summary_markdown"]) + '\n')
        return 0
