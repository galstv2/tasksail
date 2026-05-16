#!/usr/bin/env python3
"""Update repo_focus, repo_category, or primary_focus_area_ids on a context pack manifest.

Invoked from the TS layer (main.contextPackActions.ts) for operator-driven
focus/category mutations. Uses PackWriter so authorship flags are persisted
and the lock is respected.

Exit 0 + JSON stdout on success.
Exit 1 + JSON stderr on failure.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lib.protocol_output import write_protocol_stderr, write_protocol_stdout

_REPO_ROOT = Path(__file__).resolve().parents[4]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.backend.mcp.pack_constants import ALLOWED_REPO_CATEGORIES
from src.backend.mcp.pack_schemas.errors import PackSchemaError
from src.backend.mcp.pack_writer import PackWriter, PackWriterContended
from src.backend.scripts.python.lib.logging_config import configure_logging


def parse_args(argv=None):  # type: ignore[no-untyped-def]
    parser = argparse.ArgumentParser(
        description="Mutate repo_focus, repo_category, or primary_focus_area_ids in a pack manifest."
    )
    parser.add_argument(
        "--context-pack-dir",
        required=True,
        help="Path to the context pack directory.",
    )
    parser.add_argument(
        "--repo-id",
        required=True,
        help="repo_id to target (or focus_id for --primary-focus-area-ids).",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--repo-focus",
        choices=["primary", "support"],
        help="Set repo_focus and repo_focus_authored=True.",
    )
    group.add_argument(
        "--repo-category",
        choices=sorted(ALLOWED_REPO_CATEGORIES),
        help="Set repo_category and repo_category_authored=True.",
    )
    group.add_argument(
        "--primary-focus-area-ids",
        help="Comma-separated focus_ids to set as primary. Overwrites primary_focus_area_ids.",
    )
    return parser.parse_args(argv)


def _ok(repo_id: str, field: str) -> str:
    return json.dumps({"status": "ok", "repo_id": repo_id, "field": field})


def _err(message: str) -> str:
    return json.dumps({"status": "error", "message": message})


def main(argv=None) -> int:  # type: ignore[no-untyped-def]
    configure_logging(stack="py", service="update-pack-manifest")
    args = parse_args(argv)
    context_pack_dir = Path(args.context_pack_dir)
    writer = PackWriter(context_pack_dir)

    try:
        if args.repo_focus is not None:
            target_focus = args.repo_focus

            def mutator_focus(model):  # type: ignore[no-untyped-def]
                for repo in model.repositories or []:
                    if repo.repo_id == args.repo_id:
                        repo.repo_focus = target_focus
                        repo.repo_focus_authored = True
                        return model
                write_protocol_stderr(str(_err(f"repo_id '{args.repo_id}' not found in manifest.")) + '\n')
                raise SystemExit(1)

            writer.update_manifest(mutator_focus, preserve_authored_fields=False)
            write_protocol_stdout(str(_ok(args.repo_id, "repo_focus")) + '\n')

        elif args.repo_category is not None:
            target_category = args.repo_category

            def mutator_category(model):  # type: ignore[no-untyped-def]
                for repo in model.repositories or []:
                    if repo.repo_id == args.repo_id:
                        repo.repo_category = target_category
                        repo.repo_category_authored = True
                        return model
                write_protocol_stderr(str(_err(f"repo_id '{args.repo_id}' not found in manifest.")) + '\n')
                raise SystemExit(1)

            writer.update_manifest(mutator_category, preserve_authored_fields=False)
            write_protocol_stdout(str(_ok(args.repo_id, "repo_category")) + '\n')

        else:
            # --primary-focus-area-ids
            new_ids = [
                fid.strip()
                for fid in (args.primary_focus_area_ids or "").split(",")
                if fid.strip()
            ]

            def mutator_pfa(model):  # type: ignore[no-untyped-def]
                model.primary_focus_area_ids = new_ids
                return model

            writer.update_manifest(mutator_pfa, preserve_authored_fields=False)
            write_protocol_stdout(str(_ok(args.repo_id, "primary_focus_area_ids")) + '\n')

    except PackWriterContended as exc:
        write_protocol_stderr(str(_err(f"Pack writer lock contended: {exc}")) + '\n')
        return 1
    except PackSchemaError as exc:
        write_protocol_stderr(str(_err(f"Schema validation error: {exc}")) + '\n')
        return 1
    except SystemExit as exc:
        return int(exc.code or 1)
    except Exception as exc:
        write_protocol_stderr(str(_err(str(exc))) + '\n')
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
