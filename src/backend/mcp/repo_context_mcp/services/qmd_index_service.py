from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from .archive_service import TaskArchiveService
from ..utils import (
    normalize_optional_string,
    normalize_string_list,
    resolve_path,
    resolve_path_within,
    utc_now,
)

if TYPE_CHECKING:
    from .lineage_service import LineageService


class QmdIndexService:
    def __init__(
        self,
        *,
        workspace_root: Path | None = None,
        archive_service: TaskArchiveService | None = None,
        now: Callable[[], str] | None = None,
        global_retrospective_root: str | None = None,
        glopml_retrospective_root: str = "qmd/global/retrospectives",
    ) -> None:
        retrospective_root = (
            global_retrospective_root
            if global_retrospective_root is not None
            else glopml_retrospective_root
        )
        self.workspace_root = workspace_root or Path.cwd()
        self.archive_service = archive_service or TaskArchiveService(
            workspace_root=self.workspace_root,
            global_retrospective_root=retrospective_root,
        )
        self.now = now or utc_now
        self._glopml_retro_root = retrospective_root
        self._descriptor_cache: dict[str, list[dict[str, Any]]] = {}
        self._lineage_service: LineageService | None = None

    def set_lineage_service(self, lineage_service: LineageService) -> None:
        """Wire the lineage service after construction (breaks circular init)."""
        self._lineage_service = lineage_service

    def invalidate_archive_cache(self, scope_dir: Path | None = None) -> None:
        resolved = self._resolve_scope_dir(scope_dir) if scope_dir is not None else None
        self.archive_service.invalidate_cache(resolved)
        self.invalidate_descriptor_cache(scope_dir)

    def warm_and_merge_records(
        self,
        scope_dir: Path,
        records: list[tuple[Path, dict[str, Any]]],
    ) -> None:
        """Warm the record cache and merge freshly-written records."""
        self.archive_service.iter_task_archive_records(scope_dir)
        self.archive_service.merge_written_records(scope_dir, records)

    def invalidate_descriptor_cache(self, scope_dir: Path | None = None) -> None:
        """Clear the task descriptor cache without invalidating file-level records.

        Use after operations that do not modify task-archive or
        task-retrospective records (e.g., live seeding).
        """
        if scope_dir is None:
            self._descriptor_cache.clear()
        else:
            resolved = self._resolve_scope_dir(scope_dir)
            self._descriptor_cache.pop(str(resolved), None)
        if self._lineage_service is not None:
            self._lineage_service.invalidate_cache(scope_dir)

    def _glopml_retrospective_root(self, repo_root: Path) -> Path:
        return resolve_path_within(
            repo_root,
            self._glopml_retro_root,
            "glopml_retrospective_root",
        )

    def build_context_pack_index(
        self,
        *,
        scope_dir: Path,
        repository_entries: list[dict[str, Any]] | None = None,
        task_entries: list[dict[str, Any]] | None = None,
        lineage_entries: list[dict[str, Any]] | None = None,
        latest_seed_run_path: str | None = None,
    ) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        repositories = repository_entries or []
        tasks = task_entries
        if tasks is None:
            tasks = self.build_glopml_task_index(
                scope_dir=resolved_scope_dir,
            )["tasks"]

        lineage = lineage_entries
        if lineage is None:
            lineage = self.build_top_level_lineage_index(
                scope_dir=resolved_scope_dir,
            )["lineage_roots"]

        seeded_count = 0
        blocked_count = 0
        stale_count = 0
        for repo in repositories:
            seed_status = normalize_optional_string(
                repo.get("seed_status") or repo.get("status")
            )
            if seed_status == "seeded":
                seeded_count += 1
            elif seed_status == "blocked":
                blocked_count += 1
            elif seed_status in {"stale", "needs-review"}:
                stale_count += 1

        scope_display = self._display_scope(resolved_scope_dir)
        conventions_summary_path = (
            f"{scope_display}/canonical/context-pack/codepmse-conventions.md"
        )
        conventions_summary_record_path = (
            f"{conventions_summary_path}.record.json"
        )
        conventions_markdown_path = (
            resolved_scope_dir
            / "canonical"
            / "context-pack"
            / "codepmse-conventions.md"
        )
        conventions_record_path = (
            resolved_scope_dir
            / "canonical"
            / "context-pack"
            / "codepmse-conventions.md.record.json"
        )
        conventions_summary_exists = (
            conventions_markdown_path.exists()
            or conventions_record_path.exists()
        )
        if conventions_summary_exists:
            conventions_summary_status = "available"
        elif seeded_count == 0:
            conventions_summary_status = "deferred"
        else:
            conventions_summary_status = "missing"

        return {
            "schema_version": "qmd-index/v1",
            "index_type": "context-pack-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": scope_display,
            "repository_count": len(repositories),
            "seeded_repository_count": seeded_count,
            "blocked_repository_count": blocked_count,
            "stale_repository_count": stale_count,
            "task_count": len(tasks),
            "lineage_root_count": len(lineage),
            "repositories_index_path": (
                f"{scope_display}/indexes/repositories.json"
            ),
            "tasks_index_path": f"{scope_display}/indexes/tasks.json",
            "lineage_index_path": f"{scope_display}/indexes/lineage.json",
            "conventions_summary_path": conventions_summary_path,
            "conventions_summary_record_path": conventions_summary_record_path,
            "conventions_summary_status": conventions_summary_status,
            "latest_seed_run_path": latest_seed_run_path or "",
        }

    def build_repository_index(
        self,
        *,
        scope_dir: Path,
        repositories: list[dict[str, Any]],
    ) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        scope_display = self._display_scope(resolved_scope_dir)
        normalized_entries: list[dict[str, Any]] = []

        for repo in repositories:
            repo_name = normalize_optional_string(
                repo.get("repo_name") or repo.get("repo_id")
            )
            repo_id = normalize_optional_string(
                repo.get("repo_id") or repo_name
            )
            if not repo_id:
                continue

            bounded_context = normalize_optional_string(
                repo.get("bounded_context")
            )
            system_layer = (
                normalize_optional_string(repo.get("system_layer"))
                or "shared"
            )
            estate_paths = [
                f"{scope_display}/estate/{system_layer}/{repo_id}/"
            ]
            for language in normalize_string_list(repo.get("languages")):
                estate_paths.append(
                    f"{scope_display}/estate/languages/{language}/{repo_id}/"
                )
            if bounded_context:
                estate_paths.append(
                    f"{scope_display}/estate/contexts/"
                    f"{bounded_context}/{repo_id}/"
                )

            service_name = normalize_optional_string(
                repo.get("service_name") or repo_name
            )
            if service_name:
                estate_paths.append(
                    f"{scope_display}/estate/services/"
                    f"{service_name}/{repo_id}/"
                )

            canonical_summary_paths = [
                f"{scope_display}/canonical/repos/{repo_id}/repo-summary.md"
            ]
            if bounded_context:
                canonical_summary_paths.append(
                    f"{scope_display}/canonical/contexts/"
                    f"{bounded_context}/repo-{repo_id}.md"
                )

            normalized_entries.append(
                {
                    "repo_id": repo_id,
                    "repo_name": repo_name or repo_id,
                    "system_layer": system_layer,
                    "languages": normalize_string_list(
                        repo.get("languages")
                    ),
                    "bounded_context": bounded_context,
                    "service_name": service_name,
                    "seed_status": normalize_optional_string(
                        repo.get("seed_status") or repo.get("status")
                    ),
                    "local_root": self._resolve_local_root(repo),
                    "estate_paths": estate_paths,
                    "canonical_summary_paths": canonical_summary_paths,
                    "archive_index_path": (
                        f"{scope_display}/archive/indexes/by-repo/"
                        f"{repo_id}/tasks.json"
                    ),
                    "last_seeded_at": normalize_optional_string(
                        repo.get("last_seeded_at") or repo.get("indexed_at")
                    ),
                }
            )

        normalized_entries.sort(
            key=lambda item: (item["system_layer"], item["repo_name"])
        )
        return {
            "schema_version": "qmd-index/v1",
            "index_type": "repository-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": scope_display,
            "repositories": normalized_entries,
        }

    def build_glopml_task_index(self, *, scope_dir: Path) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        tasks = sorted(
            self.task_descriptors(resolved_scope_dir),
            key=lambda item: (item["repo_name"], item["task_id"]),
        )
        return {
            "schema_version": "qmd-index/v1",
            "index_type": "task-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": self._display_scope(resolved_scope_dir),
            "tasks": tasks,
        }

    def build_global_task_index(self, *, scope_dir: Path) -> dict[str, Any]:
        return self.build_glopml_task_index(scope_dir=scope_dir)

    def build_top_level_lineage_index(
        self,
        *,
        scope_dir: Path,
    ) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        tasks = self.task_descriptors(resolved_scope_dir)
        by_root: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for task in tasks:
            by_root[task["root_task_id"]].append(task)

        lineage_roots: list[dict[str, Any]] = []
        for root_task_id, entries in sorted(by_root.items()):
            entries.sort(
                key=lambda item: (item["child_depth"], item["task_id"])
            )
            root_entry = next(
                (
                    entry
                    for entry in entries
                    if entry["task_id"] == root_task_id
                ),
                entries[0],
            )
            child_task_count = len(
                [
                    entry
                    for entry in entries
                    if entry["lineage_role"] == "child"
                ]
            )
            lineage_roots.append(
                {
                    "root_task_id": root_task_id,
                    "root_record_id": root_entry["record_id"],
                    "root_archive_path": root_entry["archive_path"],
                    "task_count": len(entries),
                    "child_task_count": child_task_count,
                    "latest_task_id": entries[-1]["task_id"],
                    "latest_task_path": entries[-1]["archive_path"],
                    "tasks": entries,
                }
            )

        return {
            "schema_version": "qmd-index/v1",
            "index_type": "lineage-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": self._display_scope(resolved_scope_dir),
            "lineage_roots": lineage_roots,
        }

    def build_repo_task_index(
        self,
        *,
        scope_dir: Path,
        repo_name: str,
    ) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        normalized_repo_name = normalize_optional_string(repo_name)
        tasks = [
            task
            for task in self.task_descriptors(resolved_scope_dir)
            if task["repo_name"] == normalized_repo_name
        ]
        tasks.sort(key=lambda item: item["task_id"])
        return {
            "schema_version": "qmd-index/v1",
            "index_type": "repo-task-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": self._display_scope(resolved_scope_dir),
            "repo_name": normalized_repo_name,
            "tasks": tasks,
        }

    def build_root_lineage_index(
        self,
        *,
        scope_dir: Path,
        root_task_id: str,
    ) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        normalized_root_task_id = normalize_optional_string(root_task_id)
        tasks = [
            task
            for task in self.task_descriptors(resolved_scope_dir)
            if task["root_task_id"] == normalized_root_task_id
        ]
        if not tasks:
            raise ValueError(
                "No lineage records matched root_task_id "
                f"'{normalized_root_task_id}'"
            )
        tasks.sort(key=lambda item: (item["child_depth"], item["task_id"]))

        direct_children = [
            task
            for task in tasks
            if task["parent_task_id"] == normalized_root_task_id
        ]
        descendants = [
            task
            for task in tasks
            if task["task_id"] != normalized_root_task_id
            and task not in direct_children
        ]
        open_followup_refs = self._unique_strings(
            value
            for task in tasks
            for value in normalize_string_list(task.get("followup_refs"))
        )

        return {
            "schema_version": "qmd-index/v1",
            "index_type": "root-lineage-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": self._display_scope(resolved_scope_dir),
            "root_task_id": normalized_root_task_id,
            "tasks": tasks,
            "direct_children": direct_children,
            "descendants": descendants,
            "open_followup_refs": open_followup_refs,
            "latest_task_id": tasks[-1]["task_id"],
            "latest_task_path": tasks[-1]["archive_path"],
        }

    def build_parent_children_index(
        self,
        *,
        scope_dir: Path,
        parent_task_id: str,
    ) -> dict[str, Any]:
        resolved_scope_dir = self._resolve_scope_dir(scope_dir)
        normalized_parent_task_id = normalize_optional_string(parent_task_id)
        tasks = self.task_descriptors(resolved_scope_dir)
        parent_matches = [
            task
            for task in tasks
            if task["task_id"] == normalized_parent_task_id
        ]
        if not parent_matches:
            raise ValueError(
                "No lineage records matched parent_task_id "
                f"'{normalized_parent_task_id}'"
            )
        if len(parent_matches) > 1:
            raise ValueError(
                f"Ambiguous parent task_id '{normalized_parent_task_id}' "
                "in the requested scope"
            )
        children = [
            task
            for task in tasks
            if task["parent_task_id"] == normalized_parent_task_id
        ]
        children.sort(key=lambda item: (item["child_depth"], item["task_id"]))
        parent_record = parent_matches[0]
        return {
            "schema_version": "qmd-index/v1",
            "index_type": "parent-children-index",
            "generated_at": self.now(),
            "context_pack_id": resolved_scope_dir.name,
            "qmd_scope_root": self._display_scope(resolved_scope_dir),
            "parent_task_id": normalized_parent_task_id,
            "parent_record_id": parent_record["record_id"],
            "parent_record_path": parent_record["archive_path"],
            "children": children,
        }

    def build_retrospective_history_index(
        self,
        *,
        repo_root: Path,
    ) -> dict[str, Any]:
        resolved_root = resolve_path_within(
            self.workspace_root,
            str(repo_root),
            "repo_root",
        )
        records = (
            self.archive_service.iter_glopml_retrospective_history_records(
                resolved_root
            )
        )
        retrospectives = [
            self.archive_service.glopml_retrospective_descriptor(path, record)
            for path, record in records
        ]
        retrospectives.sort(
            key=lambda item: (item["indexed_at"], item["task_id"])
        )
        return {
            "schema_version": "qmd-index/v1",
            "index_type": "retrospective-history-index",
            "generated_at": self.now(),
            "glopml_retrospective_root": self._display_scope(
                self._glopml_retrospective_root(resolved_root)
            ),
            "retrospectives": retrospectives,
        }

    def build_retrospective_action_items_index(
        self,
        *,
        repo_root: Path,
    ) -> dict[str, Any]:
        resolved_root = resolve_path_within(
            self.workspace_root,
            str(repo_root),
            "repo_root",
        )
        records = (
            self.archive_service.iter_glopml_retrospective_history_records(
                resolved_root
            )
        )
        grouped: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"task_ids": [], "history_paths": []}
        )
        for path, record in records:
            task_id = normalize_optional_string(record.get("task_id"))
            for item in normalize_string_list(record.get("action_items")):
                grouped[item]["task_ids"].append(task_id)
                grouped[item]["history_paths"].append(str(path))

        action_items = []
        for item, data in sorted(grouped.items()):
            task_ids = self._unique_strings(data["task_ids"])
            history_paths = self._unique_strings(data["history_paths"])
            action_items.append(
                {
                    "action_item": item,
                    "task_ids": task_ids,
                    "history_paths": history_paths,
                    "count": len(task_ids),
                }
            )
        action_items.sort(
            key=lambda item: (-item["count"], item["action_item"])
        )

        return {
            "schema_version": "qmd-index/v1",
            "index_type": "retrospective-action-items-index",
            "generated_at": self.now(),
            "glopml_retrospective_root": self._display_scope(
                self._glopml_retrospective_root(resolved_root)
            ),
            "action_items": action_items,
        }

    def build_retrospective_theme_index(
        self,
        *,
        repo_root: Path,
    ) -> dict[str, Any]:
        resolved_root = resolve_path_within(
            self.workspace_root,
            str(repo_root),
            "repo_root",
        )
        records = (
            self.archive_service.iter_glopml_retrospective_history_records(
                resolved_root
            )
        )
        categories = {
            "strength": "what_went_well",
            "bottleneck": "what_could_have_gone_better",
            "learning": "reusable_team_learnings",
            "anti-pattern": "anti_patterns",
        }
        grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
        for _path, record in records:
            task_id = normalize_optional_string(record.get("task_id"))
            for category, field_name in categories.items():
                for item in normalize_string_list(record.get(field_name)):
                    grouped[(category, item)].append(task_id)

        themes = []
        for (category, item), task_ids in sorted(grouped.items()):
            normalized_task_ids = self._unique_strings(task_ids)
            themes.append(
                {
                    "category": category,
                    "theme": item,
                    "task_ids": normalized_task_ids,
                    "count": len(normalized_task_ids),
                }
            )
        themes.sort(
            key=lambda item: (
                -item["count"],
                item["category"],
                item["theme"],
            )
        )

        return {
            "schema_version": "qmd-index/v1",
            "index_type": "retrospective-theme-index",
            "generated_at": self.now(),
            "glopml_retrospective_root": self._display_scope(
                self._glopml_retrospective_root(resolved_root)
            ),
            "themes": themes,
        }

    def _resolve_scope_dir(self, scope_dir: Path) -> Path:
        if scope_dir.is_absolute():
            return resolve_path(self.workspace_root, str(scope_dir))

        return resolve_path_within(
            self.workspace_root,
            str(scope_dir),
            "scope_dir",
        )

    def _display_scope(self, scope_dir: Path) -> str:
        scope_parts = scope_dir.as_posix().split("/")
        if "qmd" in scope_parts:
            qmd_index = scope_parts.index("qmd")
            return "/".join(scope_parts[qmd_index:])
        try:
            return scope_dir.resolve().relative_to(
                self.workspace_root.resolve()
            ).as_posix()
        except ValueError:
            return scope_dir.as_posix()

    def task_descriptors(self, scope_dir: Path) -> list[dict[str, Any]]:  # noqa: DOC
        """Return cached task descriptors. Callers MUST NOT mutate the list."""
        key = str(scope_dir)
        cached = self._descriptor_cache.get(key)
        if cached is not None:
            return cached
        archive_records = self.archive_service.iter_task_archive_records(
            scope_dir
        )
        descriptors = [
            self.archive_service.task_archive_descriptor(path, record)
            for path, record in archive_records
        ]
        self._descriptor_cache[key] = descriptors
        return descriptors

    @staticmethod
    def _resolve_local_root(repo: dict[str, Any]) -> str:
        direct = normalize_optional_string(repo.get("local_root"))
        if direct:
            return direct
        existing_roots = normalize_string_list(repo.get("existing_roots"))
        return existing_roots[0] if existing_roots else ""

    @staticmethod
    def _unique_strings(values: Any) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for value in values:
            normalized = normalize_optional_string(value)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
        return ordered
