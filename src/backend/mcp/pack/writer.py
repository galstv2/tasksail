"""PackWriter — single authority for writing manifest, bootstrap answers, and seed plan.

Every write is atomic (temp-file + os.replace via pack_io.write_text_atomic).
Authorship flags (repo_focus_authored, repo_category_authored) are enforced
in update_manifest so probe-driven reseeds cannot overwrite operator choices.
"""
from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

from src.backend.mcp.pack_schemas import (
    BootstrapAnswers,
    ManifestRepositoryV2,
    RepoSourcesManifestV2,
    SeedPlan,
    canonicalize,
    dump_answers,
    dump_manifest_v2,
    dump_plan,
    validate_answers,
    validate_manifest_v2,
    validate_plan,
)
from src.backend.mcp.pack_schemas.upgrade import upgrade_v1_to_v2
from src.backend.mcp.probes.path_resolution import load_mount_config, resolve_container_path
from src.backend.scripts.python.lib.locking import acquire_file_lock, release_file_lock

from .constants import MANIFEST_VERSION_V2
from .io import write_text_atomic

logger = logging.getLogger(__name__)

_DEFAULT_MANIFEST_RELPATH = "qmd/repo-sources.json"
_DEFAULT_ANSWERS_RELPATH = "qmd/bootstrap/bootstrap-answers.json"
_DEFAULT_PLAN_RELPATH = "qmd/bootstrap/seed-plan.json"
_LOCK_TIMEOUT_S = 10.0
_LOCK_POLL_S = 0.05


class PackWriterContended(Exception):
    """Raised when the per-pack lock cannot be acquired within the timeout."""


class PackWriter:
    """Atomic writer for the three managed pack JSON files.

    Constructor args:
        context_pack_dir: root of the context pack (e.g. contextpacks/my-pack/)
        manifest_file: override the resolved manifest path (default: qmd/repo-sources.json)
        answers_file: override the resolved answers path
        plan_file: override the resolved plan path
    """

    def __init__(
        self,
        context_pack_dir: Path,
        *,
        manifest_file: Path | str | None = None,
        answers_file: Path | str | None = None,
        plan_file: Path | str | None = None,
    ) -> None:
        self._pack_dir = Path(context_pack_dir).resolve()
        self._manifest_path = self._resolve(manifest_file, _DEFAULT_MANIFEST_RELPATH)
        self._answers_path = self._resolve(answers_file, _DEFAULT_ANSWERS_RELPATH)
        self._plan_path = self._resolve(plan_file, _DEFAULT_PLAN_RELPATH)
        self._lock_path = self._pack_dir / ".pack-writer.lock"

    def _resolve(self, override: Path | str | None, relpath: str) -> Path:
        if override is not None:
            p = Path(override)
            return p if p.is_absolute() else (self._pack_dir / p).resolve()
        return self._pack_dir / relpath

    @contextmanager
    def _locked(self, timeout: float = _LOCK_TIMEOUT_S):  # type: ignore[misc]
        """Acquire the per-pack exclusive lock, raise PackWriterContended on timeout."""
        try:
            fd = acquire_file_lock(
                self._lock_path,
                timeout_seconds=timeout,
                poll_interval=_LOCK_POLL_S,
            )
        except TimeoutError as exc:
            raise PackWriterContended(
                f"Could not acquire pack-writer lock within {timeout}s: {self._lock_path}"
            ) from exc
        try:
            yield
        finally:
            release_file_lock(fd)

    def _serialize(self, payload: dict[str, Any]) -> str:
        """Canonical JSON via shared canonicalize() — byte-identical to TS canonicalizer."""
        return canonicalize(payload) + "\n"

    def _mirror_repo_fields(self, model: RepoSourcesManifestV2) -> None:
        """One-way mirror: repo_focus → repository_type (transitional compat for legacy readers).

        The direction is strictly one-way. v1-era entries with empty repo_focus must be
        normalized via upgrade_v1_to_v2 upstream, not here. A reverse fill would let a
        stale legacy repository_type silently regress R18 on a future write.
        """
        repos = list(model.repositories or [])
        if model.repository is not None:
            repos.append(model.repository)
        for repo in repos:
            repo.repository_type = repo.repo_focus or ""

    def _derive_focus_area_types(self, model: RepoSourcesManifestV2) -> None:
        """Re-derive focusable_areas[].repository_type from primary_focus_area_ids.

        Synthesis rule: if primary_focus_area_ids is empty/missing but focus areas
        have repository_type == 'primary', populate primary_focus_area_ids from those
        focus_ids first (backward-compat guard for pre-upgrade manifests).
        """
        if not model.focusable_areas:
            return

        if not model.primary_focus_area_ids:
            synthesized = [
                fa.focus_id
                for fa in model.focusable_areas
                if fa.repository_type == "primary"
            ]
            if synthesized:
                model.primary_focus_area_ids = synthesized

        primary_set = set(model.primary_focus_area_ids)
        for fa in model.focusable_areas:
            fa.repository_type = "primary" if fa.focus_id in primary_set else "support"

    def _populate_container_paths(self, model: RepoSourcesManifestV2) -> None:
        mount_config = load_mount_config()
        repos = list(model.repositories or [])
        if model.repository is not None:
            repos.append(model.repository)
        for repo in repos:
            for local_path in repo.local_paths:
                local_path.container = resolve_container_path(local_path.host, mount_config)
                if mount_config is not None and local_path.container is None:
                    logger.warning(
                        "pack_writer.outside-mount-host-path",
                        extra={
                            "event": "pack_writer.outside-mount-host-path",
                            "host": local_path.host,
                            "mount_host_dir": mount_config.host_dir,
                            "manifest_path": str(self._manifest_path),
                        },
                    )

    def _enforce_authorship(
        self,
        disk_model: RepoSourcesManifestV2,
        proposed_model: RepoSourcesManifestV2,
    ) -> None:
        """Revert operator-owned fields when automated updates try to change them.

        Mutates proposed_model in place. Covers both repositories list and the
        monolith singular repository field so the guard is symmetric with _mirror_repo_fields.
        """
        disk_repos = list(disk_model.repositories or [])
        if disk_model.repository is not None:
            disk_repos.append(disk_model.repository)
        disk_by_id = {r.repo_id: r for r in disk_repos}

        for repo in proposed_model.repositories or []:
            self._apply_authorship_guard(repo, disk_by_id)
        if proposed_model.repository is not None:
            self._apply_authorship_guard(proposed_model.repository, disk_by_id)

    def _apply_authorship_guard(
        self,
        repo: ManifestRepositoryV2,
        disk_by_id: dict[str, ManifestRepositoryV2],
    ) -> None:
        disk_repo = disk_by_id.get(repo.repo_id)
        if disk_repo is None:
            return
        if repo.repo_focus != disk_repo.repo_focus:
            repo.repo_focus = disk_repo.repo_focus
            logger.debug(
                "Authorship guard: reverted operator-owned repo_focus for %s",
                repo.repo_id,
            )
        if disk_repo.repo_category_authored and repo.repo_category != disk_repo.repo_category:
            repo.repo_category = disk_repo.repo_category
            logger.debug(
                "Authorship guard: reverted repo_category for %s (authored by operator)",
                repo.repo_id,
            )

    def _load_as_v2(self) -> RepoSourcesManifestV2:
        """Load and parse the on-disk manifest, upgrading from v1 if needed."""
        raw = json.loads(self._manifest_path.read_text(encoding="utf-8"))
        if raw.get("manifest_version") == MANIFEST_VERSION_V2:
            return validate_manifest_v2(raw, path=str(self._manifest_path))
        # Legacy v1 manifests load as v2 so update paths share one model.
        upgraded_raw = upgrade_v1_to_v2(raw, repo_roots={})
        return validate_manifest_v2(upgraded_raw, path=str(self._manifest_path))

    def write_manifest(self, manifest: RepoSourcesManifestV2) -> None:
        """Write a manifest model atomically. Applies mirror and focus-area derivation."""
        self._mirror_repo_fields(manifest)
        self._derive_focus_area_types(manifest)
        self._populate_container_paths(manifest)
        dumped = dump_manifest_v2(manifest)
        # Validate the dumped shape before it becomes the disk representation.
        validate_manifest_v2(dumped, path=str(self._manifest_path))
        self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self._manifest_path, self._serialize(dumped))

    def update_manifest(
        self,
        mutator: Callable[[RepoSourcesManifestV2], RepoSourcesManifestV2],
        *,
        preserve_authored_fields: bool = True,
    ) -> None:
        """Read–modify–write the manifest under the per-pack lock.

        The mutator receives a RepoSourcesManifestV2 and must return one.
        Authorship guards are applied after the mutator returns unless the caller
        is the explicit operator-update path.
        """
        import copy
        with self._locked():
            disk_model = self._load_as_v2()
            # Deep-copy so we can compare pre-mutator and post-mutator values
            # even when the mutator modifies the model in place.
            disk_snapshot = copy.deepcopy(disk_model)
            proposed = mutator(disk_model)
            if preserve_authored_fields:
                self._enforce_authorship(disk_snapshot, proposed)
            self.write_manifest(proposed)

    def write_answers(self, answers: BootstrapAnswers) -> None:
        """Write bootstrap answers atomically."""
        dumped = dump_answers(answers)
        validate_answers(dumped, path=str(self._answers_path))
        self._answers_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self._answers_path, self._serialize(dumped))

    def write_plan(self, plan: SeedPlan) -> None:
        """Write seed plan atomically."""
        dumped = dump_plan(plan)
        validate_plan(dumped, path=str(self._plan_path))
        self._plan_path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self._plan_path, self._serialize(dumped))
