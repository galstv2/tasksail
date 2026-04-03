from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class RepoSeedResult:
    repo_id: str
    repo_name: str
    status: str
    source_root: str | None
    seeded_records: int
    invalidated_records: int
    warnings: list[str]
    errors: list[str]
    report_files: dict[str, str]
    source_ref: str | None = None
    source_paths: list[str] | None = None
    files_skipped: int = 0
    accumulated_records: list[tuple[Path, dict[str, Any]]] | None = None

    def to_report_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dict excluding internal-only fields."""
        result = dict(self.__dict__)
        result.pop("accumulated_records", None)
        return result


@dataclass
class ParentArchiveResolution:
    record: dict[str, Any]
    record_path: str
    qmd_scope: str
    context_pack_dir: str


@dataclass
class TaskArchiveResolution:
    path: Path
    record: dict[str, Any]


@dataclass
class SeedRuntimeSnapshot:
    latest_run: dict[str, Any] | None
