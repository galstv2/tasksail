from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from src.backend.mcp.context_estate_manifest import resolve_manifest_path
from src.backend.mcp.repo_context_mcp.utils import (
    ALLOWED_SCOPE_MODES,
    ensure_non_empty_string,
    load_json,
    normalize_optional_string,
    resolve_path_within,
    unique_preserving_order,
    utc_now,
    write_json_atomic,
)
from src.backend.mcp.workspace_context_sync_resolution import (
    resolve_distributed_repo_selection,
    resolve_monolith_focus_selection,
)
from src.backend.mcp.workspace_context_sync_workspace import (
    WorkspaceFolderEntry,
    build_sync_preview,
    dedupe_paths,
    load_workspace_entries,
    normalize_any_path,
    resolve_manifest_target_path,
)

SYNC_STATE_VERSION = 1
DEFAULT_WORKSPACE_FILE = "tasksail.code-workspace"
DEFAULT_STATE_FILE = ".platform-state/workspace-context-sync.json"


class WorkspaceContextSyncService:
    def __init__(
        self,
        *,
        workspace_root: Path,
        workspace_file: str = DEFAULT_WORKSPACE_FILE,
        state_file: str = DEFAULT_STATE_FILE,
        now: Callable[[], str] | None = None,
    ) -> None:
        self.workspace_root = workspace_root.resolve()
        self.workspace_file = resolve_path_within(
            self.workspace_root,
            workspace_file,
            "workspace_file",
        )
        self.state_file = resolve_path_within(
            self.workspace_root,
            state_file,
            "state_file",
        )
        self.now = now or utc_now

    def load_workspace(self) -> dict[str, Any]:
        payload = load_json(self.workspace_file)
        folders = payload.get("folders")
        if not isinstance(folders, list):
            raise ValueError("Workspace file must include a folders list")
        return payload

    def load_sync_state(self) -> dict[str, Any]:
        if not self.state_file.exists():
            return {
                "version": SYNC_STATE_VERSION,
                "workspace_file": str(self.workspace_file),
                "active_context_pack_dir": "",
                "active_context_pack_id": "",
                "scope_mode": "",
                "selected_repo_ids": [],
                "selected_focus_ids": [],
                "managed_folders": [],
                "last_synced_at": "",
                "status": "idle",
            }
        state = load_json(self.state_file)
        managed_folders = state.get("managed_folders")
        selected_repo_ids = state.get("selected_repo_ids")
        selected_focus_ids = state.get("selected_focus_ids")
        if not isinstance(managed_folders, list):
            raise ValueError(
                "Workspace sync state managed_folders must be a list"
            )
        return {
            "version": int(state.get("version") or SYNC_STATE_VERSION),
            "workspace_file": str(
                state.get("workspace_file") or str(self.workspace_file)
            ),
            "active_context_pack_dir": normalize_optional_string(
                state.get("active_context_pack_dir")
            ),
            "active_context_pack_id": normalize_optional_string(
                state.get("active_context_pack_id")
            ),
            "scope_mode": normalize_optional_string(state.get("scope_mode")),
            "selected_repo_ids": [
                ensure_non_empty_string(item, "selected_repo_ids")
                for item in (selected_repo_ids or [])
                if str(item).strip()
            ]
            if isinstance(selected_repo_ids, list)
            else [],
            "selected_focus_ids": [
                ensure_non_empty_string(item, "selected_focus_ids")
                for item in (selected_focus_ids or [])
                if str(item).strip()
            ]
            if isinstance(selected_focus_ids, list)
            else [],
            "managed_folders": [
                normalize_any_path(Path(str(item))).as_posix()
                for item in managed_folders
                if str(item).strip()
            ],
            "last_synced_at": normalize_optional_string(
                state.get("last_synced_at")
            ),
            "status": normalize_optional_string(state.get("status")) or "idle",
        }

    def resolve_context_pack_targets(
        self,
        context_pack_dir: Path,
        *,
        selected_repo_ids: list[str] | None = None,
        selected_focus_ids: list[str] | None = None,
        scope_mode: str = "focused",
        include_context_pack_root: bool = True,
    ) -> dict[str, Any]:
        if scope_mode not in ALLOWED_SCOPE_MODES:
            raise ValueError(
                "scope_mode must be focused"
            )

        resolved_context_pack_dir = context_pack_dir.resolve(strict=True)
        manifest_path = resolve_manifest_path(resolved_context_pack_dir)
        manifest = load_json(manifest_path)
        context_pack_id = ensure_non_empty_string(
            manifest.get("context_pack_id") or resolved_context_pack_dir.name,
            "context_pack_id",
        )
        repositories = manifest.get("repositories")
        if not isinstance(repositories, list) or not repositories:
            raise ValueError("Manifest requires a non-empty repositories list")

        estate_type = normalize_optional_string(manifest.get("estate_type"))
        manifest_default_scope_mode = (
            normalize_optional_string(manifest.get("default_scope_mode"))
            or "focused"
        )
        warnings: list[str] = []
        selected_repo_order = unique_preserving_order(selected_repo_ids or [])
        selected_repo_set = set(selected_repo_order)
        known_repo_ids = {
            ensure_non_empty_string(repo.get("repo_id"), "repo_id")
            for repo in repositories
            if isinstance(repo, dict)
        }
        unknown_selected_repo_ids = sorted(selected_repo_set - known_repo_ids)
        if unknown_selected_repo_ids:
            raise ValueError(
                "Selected repo ids are not declared in the manifest: "
                + ", ".join(unknown_selected_repo_ids)
            )

        effective_selected_repo_ids = selected_repo_order
        effective_selected_focus_ids = unique_preserving_order(
            selected_focus_ids or []
        )
        repos_to_attach = set(known_repo_ids)
        focus_area_by_id: dict[str, dict[str, Any]] = {}
        if estate_type == "distributed-platform":
            (
                effective_selected_repo_ids,
                repos_to_attach,
            ) = resolve_distributed_repo_selection(
                repositories,
                selected_repo_order=selected_repo_order,
                primary_working_repo_ids=unique_preserving_order(
                    [str(item) for item in manifest.get(
                        "primary_working_repo_ids",
                        [],
                    )]
                ),
            )
        elif estate_type in {"monolith", "monolith-platform"}:
            effective_selected_focus_ids, focus_area_by_id = (
                resolve_monolith_focus_selection(
                    manifest,
                    selected_focus_ids=effective_selected_focus_ids,
                )
            )

        target_paths: list[Path] = []
        if include_context_pack_root:
            target_paths.append(resolved_context_pack_dir)

        monolith_focus_scoped = False
        if (
            estate_type in {"monolith", "monolith-platform"}
            and effective_selected_focus_ids
        ):
            mono_repo_entry = repositories[0]
            if isinstance(mono_repo_entry, dict):
                local_paths = mono_repo_entry.get("local_paths")
                if isinstance(local_paths, list) and local_paths:
                    resolved_root = resolve_manifest_target_path(
                        resolved_context_pack_dir,
                        str(local_paths[0]),
                    )
                    if resolved_root is not None:
                        for focus_id in effective_selected_focus_ids:
                            area = focus_area_by_id.get(focus_id)
                            rel_path = (
                                area.get("relative_path", "")
                                if area else ""
                            )
                            if not rel_path:
                                continue
                            focus_abs = resolved_root / rel_path
                            if focus_abs.exists():
                                target_paths.append(focus_abs)
                                monolith_focus_scoped = True
                            else:
                                warnings.append(
                                    f"Focus area '{focus_id}' path "
                                    f"missing on disk: {focus_abs}"
                                )

        if not monolith_focus_scoped:
            for raw_repo in repositories:
                if not isinstance(raw_repo, dict):
                    raise ValueError(
                        "Manifest repository entries must be JSON objects"
                    )
                repo_id = ensure_non_empty_string(
                    raw_repo.get("repo_id"),
                    "repo_id",
                )
                if repo_id not in repos_to_attach:
                    continue
                local_paths = raw_repo.get("local_paths")
                if not isinstance(local_paths, list) or not local_paths:
                    raise ValueError(
                        f"Manifest repository '{repo_id}' requires local_paths"
                    )
                for local_path in local_paths:
                    resolved_target = resolve_manifest_target_path(
                        resolved_context_pack_dir,
                        str(local_path),
                    )
                    if resolved_target is None:
                        warnings.append(
                            "Manifest path for repo "
                            f"'{repo_id}' is missing on disk: {local_path}"
                        )
                        continue
                    target_paths.append(resolved_target)

        deduped_targets = dedupe_paths(target_paths)
        return {
            "context_pack_id": context_pack_id,
            "estate_type": estate_type,
            "manifest_path": str(manifest_path),
            "scope_mode": scope_mode,
            "default_scope_mode": manifest_default_scope_mode,
            "selected_repo_ids": effective_selected_repo_ids,
            "selected_focus_ids": effective_selected_focus_ids,
            "target_folders": [path.as_posix() for path in deduped_targets],
            "warnings": warnings,
        }

    def preview_sync(
        self,
        context_pack_dir: Path,
        *,
        selected_repo_ids: list[str] | None = None,
        selected_focus_ids: list[str] | None = None,
        scope_mode: str = "focused",
    ) -> dict[str, Any]:
        target_info = self.resolve_context_pack_targets(
            context_pack_dir,
            selected_repo_ids=selected_repo_ids,
            selected_focus_ids=selected_focus_ids,
            scope_mode=scope_mode,
        )
        workspace_payload = self.load_workspace()
        workspace_entries = load_workspace_entries(
            workspace_payload, self.workspace_file
        )
        state = self.load_sync_state()
        preview = build_sync_preview(
            workspace_entries=workspace_entries,
            state=state,
            target_folder_paths=[
                Path(path) for path in target_info["target_folders"]
            ],
        )
        return {
            "action": "preview",
            "workspace_file": str(self.workspace_file),
            "state_file": str(self.state_file),
            "context_pack_id": target_info["context_pack_id"],
            "context_pack_dir": str(context_pack_dir.resolve()),
            "scope_mode": target_info["scope_mode"],
            "selected_repo_ids": target_info["selected_repo_ids"],
            "selected_focus_ids": target_info["selected_focus_ids"],
            "target_folders": target_info["target_folders"],
            "folders_to_add": preview["folders_to_add"],
            "folders_to_remove": preview["folders_to_remove"],
            "managed_folders": preview["managed_folders"],
            "warnings": target_info["warnings"],
        }

    def apply_sync(
        self,
        context_pack_dir: Path,
        *,
        selected_repo_ids: list[str] | None = None,
        selected_focus_ids: list[str] | None = None,
        scope_mode: str = "focused",
    ) -> dict[str, Any]:
        preview = self.preview_sync(
            context_pack_dir,
            selected_repo_ids=selected_repo_ids,
            selected_focus_ids=selected_focus_ids,
            scope_mode=scope_mode,
        )
        workspace_payload = self.load_workspace()
        workspace_entries = load_workspace_entries(
            workspace_payload, self.workspace_file
        )
        state = self.load_sync_state()
        preview_model = build_sync_preview(
            workspace_entries=workspace_entries,
            state=state,
            target_folder_paths=[
                Path(path) for path in preview["target_folders"]
            ],
        )

        updated_payload = dict(workspace_payload)
        updated_payload["folders"] = preview_model["result_folders"]
        write_json_atomic(self.workspace_file, updated_payload)

        next_state = {
            "version": SYNC_STATE_VERSION,
            "workspace_file": str(self.workspace_file),
            "active_context_pack_dir": str(context_pack_dir.resolve()),
            "active_context_pack_id": preview["context_pack_id"],
            "scope_mode": preview["scope_mode"],
            "selected_repo_ids": preview["selected_repo_ids"],
            "selected_focus_ids": preview["selected_focus_ids"],
            "managed_folders": preview_model["managed_folders"],
            "last_synced_at": self.now(),
            "status": "success",
        }
        write_json_atomic(self.state_file, next_state)

        return {
            **preview,
            "action": "apply",
            "last_synced_at": next_state["last_synced_at"],
            "status": next_state["status"],
        }

    def clear_context_pack_workspace(self) -> dict[str, Any]:
        workspace_payload = self.load_workspace()
        workspace_entries = load_workspace_entries(
            workspace_payload, self.workspace_file
        )
        state = self.load_sync_state()
        preview_model = build_sync_preview(
            workspace_entries=workspace_entries,
            state=state,
            target_folder_paths=[],
        )
        updated_payload = dict(workspace_payload)
        updated_payload["folders"] = preview_model["result_folders"]
        write_json_atomic(self.workspace_file, updated_payload)

        next_state = {
            "version": SYNC_STATE_VERSION,
            "workspace_file": str(self.workspace_file),
            "active_context_pack_dir": "",
            "active_context_pack_id": "",
            "scope_mode": "",
            "selected_repo_ids": [],
            "selected_focus_ids": [],
            "managed_folders": [],
            "last_synced_at": self.now(),
            "status": "cleared",
        }
        write_json_atomic(self.state_file, next_state)

        return {
            "action": "clear",
            "workspace_file": str(self.workspace_file),
            "state_file": str(self.state_file),
            "scope_mode": "",
            "selected_repo_ids": [],
            "selected_focus_ids": [],
            "folders_to_add": [],
            "folders_to_remove": preview_model["folders_to_remove"],
            "managed_folders": [],
            "last_synced_at": next_state["last_synced_at"],
            "status": next_state["status"],
        }

    def _resolve_manifest_target_path(
        self,
        context_pack_dir: Path,
        raw_path: str,
    ) -> Path | None:
        """Backward-compat wrapper; delegates to module-level function."""
        return resolve_manifest_target_path(context_pack_dir, raw_path)

    def inspect_sync_health(self) -> dict[str, Any]:
        workspace_payload = self.load_workspace()
        workspace_entries = load_workspace_entries(
            workspace_payload, self.workspace_file
        )
        state = self.load_sync_state()

        workspace_paths = {
            entry.normalized_path for entry in workspace_entries
        }
        managed_folders = unique_preserving_order(
            [str(item) for item in state.get("managed_folders", [])]
        )
        attached_managed_folders = [
            path for path in managed_folders if path in workspace_paths
        ]
        missing_managed_folders = [
            path for path in managed_folders if path not in workspace_paths
        ]

        state_status = normalize_optional_string(state.get("status")) or "idle"
        has_active_pack = bool(state.get("active_context_pack_dir"))
        drift_detected = has_active_pack and bool(missing_managed_folders)
        if state_status in {"workspace-sync-failed", "activation-failed"}:
            effective_status = state_status
        elif has_active_pack and drift_detected:
            effective_status = "active-dirty-workspace"
        elif has_active_pack:
            effective_status = "active"
        elif state_status == "cleared":
            effective_status = "cleared"
        else:
            effective_status = "idle"

        return {
            "active_context_pack_dir": state.get("active_context_pack_dir")
            or "",
            "active_context_pack_id": state.get("active_context_pack_id")
            or "",
            "scope_mode": state.get("scope_mode") or "",
            "selected_repo_ids": state.get("selected_repo_ids") or [],
            "selected_focus_ids": state.get("selected_focus_ids") or [],
            "managed_folders": managed_folders,
            "attached_managed_folders": attached_managed_folders,
            "missing_managed_folders": missing_managed_folders,
            "status": effective_status,
            "state_status": state_status,
            "drift_detected": drift_detected,
            "restore_available": (
                has_active_pack and effective_status != "active"
            ),
            "last_synced_at": state.get("last_synced_at") or "",
        }
