"""Typed data models for context estate discovery, manifest, and bootstrap."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Discovery models
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class HighSignalEntry:
    """A high-signal directory detected during estate discovery."""

    path: str
    relative_path: str
    signal_type: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HighSignalEntry:
        return cls(**{k: data[k] for k in cls.__slots__})


@dataclass(slots=True)
class RepoCandidate:
    """A git repository discovered during estate scanning."""

    repo_id: str
    repo_name: str
    path: str
    relative_path: str
    high_signal_paths: list[str] = field(default_factory=list)
    repository_type: str = ""
    classification_confidence: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RepoCandidate:
        return cls(
            repo_id=data["repo_id"],
            repo_name=data["repo_name"],
            path=data["path"],
            relative_path=data["relative_path"],
            high_signal_paths=list(data.get("high_signal_paths", [])),
            repository_type=data.get("repository_type", ""),
            classification_confidence=data.get("classification_confidence", ""),
        )


@dataclass(slots=True)
class FocusArea:
    """A focusable area within a monolith repository."""

    focus_id: str
    focus_name: str
    focus_type: str
    path: str
    relative_path: str
    group: str = ""

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if not d["group"]:
            d.pop("group")
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FocusArea:
        return cls(
            focus_id=data["focus_id"],
            focus_name=data["focus_name"],
            focus_type=data["focus_type"],
            path=data["path"],
            relative_path=data["relative_path"],
            group=data.get("group", ""),
        )


@dataclass(slots=True)
class DiscoveryPayload:
    """Result of an estate discovery scan."""

    estate_type: str
    discovery_mode: str
    root_path: str
    candidate_repos: list[dict[str, Any]] = field(default_factory=list)
    candidate_focus_areas: list[dict[str, Any]] = field(default_factory=list)
    high_signal_paths: list[dict[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    discovered_at: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DiscoveryPayload:
        return cls(
            estate_type=data["estate_type"],
            discovery_mode=data["discovery_mode"],
            root_path=data["root_path"],
            candidate_repos=list(data.get("candidate_repos", [])),
            candidate_focus_areas=list(data.get("candidate_focus_areas", [])),
            high_signal_paths=list(data.get("high_signal_paths", [])),
            warnings=list(data.get("warnings", [])),
            discovered_at=data.get("discovered_at", ""),
        )


# ---------------------------------------------------------------------------
# Classification model (for repo_type_probe)
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class ClassificationResult:
    """Result of repository type classification."""

    repository_type: str
    classification_confidence: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ClassificationResult:
        return cls(**{k: data[k] for k in cls.__slots__})


# ---------------------------------------------------------------------------
# Bootstrap result model
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class BootstrapResult:
    """Result of a context pack bootstrap operation."""

    context_pack_id: str
    display_name: str
    estate_type: str
    default_scope_mode: str
    context_pack_dir: str
    discovery_root: str
    discovery_mode: str
    bootstrap_answers_path: str
    draft_path: str
    manifest_path: str
    warnings: list[str] = field(default_factory=list)
    repository_count: int = 0
    focus_target_count: int = 0
    primary_working_repo_ids: list[str] = field(default_factory=list)
    primary_focus_area_ids: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BootstrapResult:
        return cls(
            context_pack_id=data["context_pack_id"],
            display_name=data["display_name"],
            estate_type=data["estate_type"],
            default_scope_mode=data["default_scope_mode"],
            context_pack_dir=data["context_pack_dir"],
            discovery_root=data["discovery_root"],
            discovery_mode=data["discovery_mode"],
            bootstrap_answers_path=data["bootstrap_answers_path"],
            draft_path=data["draft_path"],
            manifest_path=data["manifest_path"],
            warnings=list(data.get("warnings", [])),
            repository_count=data.get("repository_count", 0),
            focus_target_count=data.get("focus_target_count", 0),
            primary_working_repo_ids=list(
                data.get("primary_working_repo_ids", [])
            ),
            primary_focus_area_ids=list(
                data.get("primary_focus_area_ids", [])
            ),
        )
