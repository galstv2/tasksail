#!/usr/bin/env python3
# ruff: noqa: E402
"""File the current task closeout into a QMD task archive.

This is the CLI entrypoint.  All domain logic lives in lib/archive/.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from src.backend.mcp.reinforcement.qmd_writer import QmdRewardWriter

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Ensure lib/ is importable from this script's directory.
_SCRIPTS_PYTHON = Path(__file__).resolve().parent
if str(_SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_PYTHON))

from lib.archive._backend import write_json_via_backend, write_text_via_backend
from lib.archive.correction_memo import CorrectionMemoBuilder
from lib.archive.cycle_summary import CycleSummaryBuilder
from lib.archive.global_history import build_global_history_entry, collect_recent_task_ids
from lib.archive.indexes import write_archive_indexes, write_global_retrospective_indexes
from lib.archive.parent import update_parent_archive
from lib.archive.payload import build_archive_payload
from lib.archive.planner_focus_snapshot import load_or_build_planner_focus_snapshot
from lib.archive.retrospective import build_retrospective_archive
from lib.archive.shared_memory import build_shared_retrospective_memory
from lib.archive.storage import (
    agent_mirror_task_archive_dir,
    agent_mirror_task_archive_json_path,
    agent_mirror_task_archive_markdown_path,
    agent_mirror_task_archive_planner_focus_snapshot_path,
    correction_memo_storage_path,
    previous_correction_memo_path,
    resolve_scope_path,
    shared_memory_storage_path,
    sidecar_record_path,
    task_archive_markdown_path,
    task_archive_planner_focus_snapshot_path,
)
from lib.archive.task_summary import build_task_archive_markdown
from lib.counters.task_completion_counter import TaskCompletionCounter
from lib.io import load_json
from lib.locking import acquire_file_lock, release_file_lock
from lib.text import slugify


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="File the current task closeout into a QMD task archive")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[4]))
    parser.add_argument("--context-pack-dir", required=True)
    parser.add_argument("--qmd-scope", default="")
    parser.add_argument("--format", choices=("json", "text"), default="json")
    parser.add_argument("--resume", action="store_true", default=False, help="Detect and recover from partial archive state (staging directory)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        repo_root = Path(args.repo_root).resolve()
        context_pack_dir = Path(args.context_pack_dir).resolve()
        if not context_pack_dir.exists():
            raise ValueError(f"Context pack directory does not exist: {context_pack_dir}")
        qmd_scope = args.qmd_scope.strip() or f"qmd/context-packs/{context_pack_dir.name}"
        qmd_scope = resolve_scope_path(
            context_pack_dir,
            qmd_scope,
        ).relative_to(context_pack_dir).as_posix()

        payload, record_path, parent_record_path = build_archive_payload(repo_root, context_pack_dir, qmd_scope)

        # --- Staging directory approach ---
        archive_year_dir = record_path.parent.parent
        archive_year_dir.mkdir(parents=True, exist_ok=True)
        staging_dir = archive_year_dir / f".staging-{slugify(payload['task_id'])}"
        staging_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = staging_dir / "manifest.json"

        if args.resume and manifest_path.exists():
            manifest: dict[str, str] = load_json(manifest_path)
            payload = load_json(staging_dir / "archive.json")
        else:
            manifest = {}
            write_json_via_backend(staging_dir / "archive.json", payload)
            manifest["archive"] = "written"
            write_json_via_backend(manifest_path, manifest)

        def _step(name: str, fn: Callable[[], None]) -> None:
            if name in manifest:
                return
            fn()
            manifest[name] = "written"
            write_json_via_backend(manifest_path, manifest)

        try:
            retrospective_markdown, retrospective_payload, retrospective_markdown_path, retrospective_record_path = (
                build_retrospective_archive(
                    repo_root,
                    context_pack_dir,
                    qmd_scope,
                    payload,
                )
            )
            _step("retrospective_md", lambda: write_text_via_backend(retrospective_markdown_path, retrospective_markdown))
            _step("retrospective_record", lambda: write_json_via_backend(retrospective_record_path, retrospective_payload))

            global_history_markdown, global_history_payload, global_history_markdown_path, global_history_record_path = (
                build_global_history_entry(
                    repo_root,
                    retrospective_markdown,
                    retrospective_payload,
                )
            )

            shared_memory_lock_path = shared_memory_storage_path(repo_root).with_suffix('.lock')
            lock_fd = acquire_file_lock(shared_memory_lock_path)
            try:
                _step("global_history_md", lambda: write_text_via_backend(global_history_markdown_path, global_history_markdown))
                _step("global_history_record", lambda: write_json_via_backend(global_history_record_path, global_history_payload))

                # Mirror history entry into agent-facing QMD under context pack.
                _cp_history_year = payload["indexed_at"][:4]
                _cp_history_dir = (
                    repo_root / "AgentWorkSpace" / "qmd" / "context-packs"
                    / context_pack_dir.name / "retrospectives" / "history" / _cp_history_year
                )
                _cp_history_md = _cp_history_dir / global_history_markdown_path.name
                _cp_history_record = _cp_history_dir / global_history_record_path.name
                _step("cp_history_md", lambda: write_text_via_backend(_cp_history_md, global_history_markdown))
                _step("cp_history_record", lambda: write_json_via_backend(_cp_history_record, global_history_payload))

                shared_memory_markdown, shared_memory_payload, shared_memory_markdown_path, shared_memory_record_path = (
                    build_shared_retrospective_memory(repo_root)
                )
                _step("shared_memory_md", lambda: write_text_via_backend(shared_memory_markdown_path, shared_memory_markdown))
                _step("shared_memory_record", lambda: write_json_via_backend(shared_memory_record_path, shared_memory_payload))

                retrospective_index_outputs: dict[str, str] = {}

                def _write_retro_indexes() -> None:
                    nonlocal retrospective_index_outputs
                    retrospective_index_outputs = write_global_retrospective_indexes(repo_root)

                _step("retro_indexes", _write_retro_indexes)
            finally:
                release_file_lock(lock_fd)

            # --- Post-lock staged writes (crash-safe via _step) ---

            def _write_task_summary_md() -> None:
                md = build_task_archive_markdown(payload)
                write_text_via_backend(staging_dir / "archive.md", md)

            _step("task_summary_md", _write_task_summary_md)

            # Agent-facing mirror: agents run with CWD confined to AgentWorkSpace/,
            # so they cannot read the canonical archive that lives under contextpacks/.
            # We copy archive.json + archive.md into the matching nested task archive
            # directory under AgentWorkSpace/qmd/context-packs/<pack>/archive/tasks/.
            #
            # This step (plus the global-history mirror above at lines ~124-133) is the
            # ONLY writer of AgentWorkSpace/qmd/context-packs/. Live seeding does not
            # touch it. There is no watcher or repair pass — if the directory is deleted
            # the mirror stays empty until the next task completes. The mirror's surface
            # is intentionally narrow: archive/tasks/ and retrospectives/history/ get
            # mirrored; estate/, canonical/, indexes/, and operational/ stay
            # canonical-only under contextpacks/<pack>/qmd/context-packs/<pack>/.
            def _write_agent_mirrors() -> None:
                year = payload["indexed_at"][:4]
                mirror_task_dir = agent_mirror_task_archive_dir(
                    repo_root,
                    context_pack_dir.name,
                    year,
                    payload["task_id"],
                )
                mirror_task_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(
                    str(staging_dir / "archive.json"),
                    str(
                        agent_mirror_task_archive_json_path(
                            repo_root,
                            context_pack_dir.name,
                            year,
                            payload["task_id"],
                        )
                    ),
                )
                staged_md = staging_dir / "archive.md"
                if staged_md.exists():
                    shutil.copy2(
                        str(staged_md),
                        str(
                            agent_mirror_task_archive_markdown_path(
                                repo_root,
                                context_pack_dir.name,
                                year,
                                payload["task_id"],
                            )
                        ),
                    )

            _step("agent_mirrors", _write_agent_mirrors)

            def _write_planner_focus_snapshot() -> None:
                try:
                    snapshot_payload, _ = load_or_build_planner_focus_snapshot(
                        repo_root=repo_root,
                        context_pack_dir=context_pack_dir,
                        payload=payload,
                    )
                except Exception as exc:
                    print(
                        f"planner-focus-snapshot: skipped for task={payload['task_id']} reason=build-failed detail={exc}",
                        file=sys.stderr,
                    )
                    return

                year = payload["indexed_at"][:4]
                canonical_snapshot_path = task_archive_planner_focus_snapshot_path(
                    context_pack_dir,
                    qmd_scope,
                    year,
                    payload["task_id"],
                )
                try:
                    write_json_via_backend(canonical_snapshot_path, snapshot_payload)
                except Exception:
                    print(
                        f"planner-focus-snapshot: skipped for task={payload['task_id']} reason=canonical-write-failed",
                        file=sys.stderr,
                    )

                mirror_snapshot_path = agent_mirror_task_archive_planner_focus_snapshot_path(
                    repo_root,
                    context_pack_dir.name,
                    year,
                    payload["task_id"],
                )
                try:
                    write_json_via_backend(mirror_snapshot_path, snapshot_payload)
                except Exception:
                    print(
                        f"planner-focus-snapshot: skipped for task={payload['task_id']} reason=mirror-write-failed",
                        file=sys.stderr,
                    )

            _step("planner_focus_snapshot", _write_planner_focus_snapshot)

            def _write_parent_update() -> None:
                if parent_record_path is not None:
                    update_parent_archive(parent_record_path, payload["task_id"], payload["indexed_at"])

            _step("parent_update", _write_parent_update)

            index_outputs: dict[str, str] = {}

            def _write_archive_indexes() -> None:  # Archive-index lock: held
                nonlocal index_outputs
                index_outputs = write_archive_indexes(
                    context_pack_dir,
                    qmd_scope,
                    payload,
                    parent_record_path=parent_record_path,
                )

            _step("archive_indexes", _write_archive_indexes)

            reinforcement_status = "skipped"
            reinforcement_error = ""
            reinforcement_settlement: dict[str, Any] | None = None
            reinforcement_writer: QmdRewardWriter | None = None

            def _write_reinforcement() -> None:
                nonlocal reinforcement_status, reinforcement_error
                nonlocal reinforcement_settlement, reinforcement_writer
                from src.backend.mcp.reinforcement.engine import ReinforcementEngine
                from src.backend.mcp.reinforcement.persistence import ReinforcementStore
                from src.backend.mcp.reinforcement.qmd_writer import QmdRewardWriter

                r_store = ReinforcementStore(
                    repo_root,
                    legacy_context_pack_dir=context_pack_dir,
                )
                r_writer = QmdRewardWriter(repo_root)
                reinforcement_writer = r_writer
                r_engine = ReinforcementEngine(r_store, qmd_writer=r_writer)
                result = r_engine.record_task_completion(
                    task_id=payload["task_id"],
                    difficulty=payload["difficulty_level"].lower(),
                    parent_task_id=payload.get("parent_task_id", ""),
                    quality_outcome="success",
                )
                status = result.get("status")
                if status in ("recorded", "duplicate"):
                    # "duplicate" is idempotent: entry already in ledger (resume/refile).
                    reinforcement_status = "recorded"
                    if result.get("settlement"):
                        reinforcement_settlement = result["settlement"]
                else:
                    reinforcement_error = str(result)
                    raise ValueError(
                        f"Reinforcement recording failed (status={status}): {result}"
                    )

            _step("reinforcement", _write_reinforcement)

            counter_state: dict[str, Any] = {}
            retrospective_completed = False

            def _write_completion_counter() -> None:
                nonlocal counter_state, retrospective_completed
                counter = TaskCompletionCounter.from_context_pack_dir(
                    repo_root, context_pack_dir,
                )
                counter_state = counter.increment(payload["task_id"])
                retrospective_completed = (
                    counter_state["completed_count"] == 0
                    and counter_state["cycle_count"] > 0
                )

            _step("completion_counter", _write_completion_counter)

            correction_memo_path_str = ""

            def _write_correction_memo() -> None:
                nonlocal correction_memo_path_str
                if not retrospective_completed:
                    return
                cycle_task_ids = counter_state.get("cycle_task_ids", [])
                summary_builder = CycleSummaryBuilder(
                    repo_root, context_pack_dir, qmd_scope,
                )
                cycle_summary = summary_builder.build_cycle_summary(cycle_task_ids)

                recent_tids = collect_recent_task_ids(repo_root, max_entries=30)
                memo_path = correction_memo_storage_path(
                    context_pack_dir, qmd_scope,
                )

                prev_memo_md: str | None = None
                try:
                    prev_memo_md = memo_path.read_text(encoding="utf-8")
                    prev_path = previous_correction_memo_path(
                        context_pack_dir, qmd_scope,
                    )
                    write_text_via_backend(prev_path, prev_memo_md)
                except FileNotFoundError:
                    pass

                memo_builder = CorrectionMemoBuilder()
                memo_md, memo_payload = memo_builder.build_correction_memo(
                    cycle_summary,
                    shared_memory_markdown,
                    context_pack_dir.name,
                    counter_state["cycle_count"],
                    recent_task_ids=recent_tids,
                    previous_memo_markdown=prev_memo_md,
                )
                memo_record_path = sidecar_record_path(memo_path)
                write_text_via_backend(memo_path, memo_md)
                write_json_via_backend(memo_record_path, memo_payload)
                correction_memo_path_str = str(memo_path)

            _step("correction_memo", _write_correction_memo)

        except Exception as exc:
            if not args.resume and staging_dir.exists():
                shutil.rmtree(staging_dir, ignore_errors=True)
            raise ValueError(
                "Archive downstream writes failed. Staging directory cleaned up.\n"
                f"Record path: {record_path}\n"
                f"{exc}"
            ) from exc

        # --- Promotion: the atomic commit ---
        record_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(str(staging_dir / "archive.json"), str(record_path))
        record_md_path = task_archive_markdown_path(
            context_pack_dir,
            qmd_scope,
            payload["indexed_at"][:4],
            payload["task_id"],
        )
        staged_md = staging_dir / "archive.md"
        if staged_md.exists():
            shutil.copy2(str(staged_md), str(record_md_path))
        shutil.rmtree(staging_dir, ignore_errors=True)

        # Patch archive markdown with reward settlement data (if triggered).
        if reinforcement_settlement and reinforcement_writer and record_md_path.exists():
            from src.backend.mcp.reinforcement.models import SettlementRecord
            settlement_obj = SettlementRecord.from_dict(reinforcement_settlement)
            reinforcement_writer.patch_task_archive_md(record_md_path, settlement_obj)

        result = {
            "status": "filed",
            "record_path": str(record_path),
            "record_md_path": str(record_md_path),
            "record_id": payload["record_id"],
            "task_id": payload["task_id"],
            "root_task_id": payload["root_task_id"],
            "parent_task_id": payload["parent_task_id"],
            "followup_refs": payload["followup_refs"],
            "retrospective_markdown_path": str(retrospective_markdown_path),
            "retrospective_record_path": str(retrospective_record_path),
            "global_history_markdown_path": str(global_history_markdown_path),
            "global_history_record_path": str(global_history_record_path),
            "shared_memory_markdown_path": str(shared_memory_markdown_path),
            "shared_memory_record_path": str(shared_memory_record_path),
            "retrospective_index_outputs": retrospective_index_outputs,
            "index_outputs": index_outputs,
            "counter_state": counter_state,
            "retrospective_completed": retrospective_completed,
            "correction_memo_path": correction_memo_path_str,
            "reinforcement_status": reinforcement_status,
            "reinforcement_error": reinforcement_error,
        }
        if args.format == "json":
            print(json.dumps(result, indent=2, sort_keys=False))
        else:
            print(f"Filed task archive: {record_path}")
        return 0
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
