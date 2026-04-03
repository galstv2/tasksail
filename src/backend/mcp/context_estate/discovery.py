"""Core discovery logic for context estate scanning."""
from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.constants import (
    DEFAULT_REPOSITORY_TYPE,
    DEFAULT_DISTRIBUTED_SCAN_DEPTH,
    DIRECT_FOCUS_TYPES,
    ESTATE_TYPES,
    GROUP_CHILD_TYPES,
    HIGH_SIGNAL_TYPE_ALIASES,
    SKIP_DIR_NAMES,
)
from src.backend.mcp.repo_context_mcp.utils import (
    is_within,
    slugify,
    titleize_segment,
    utc_now,
)
from src.backend.mcp.repo_type_probe import classify_repository_type


_FOCUS_TYPE_TO_REPOSITORY_TYPE: dict[str, str] = {
    "service": "primary",
    "application": "primary",
    "backend": "primary",
    "frontend": "primary",
    "source": "primary",
    "library": "support",
    "package": "support",
    "docs": "support",
    "infrastructure": "support",
    "shared": "support",
    "general": "support",
    "module": "support",
    "domain": "support",
    "component": "support",
}


def resolve_existing_root(root: Path | str) -> Path:
    candidate = Path(root).expanduser()
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(f"Root path does not exist: {candidate}") from exc

    if not resolved.is_dir():
        raise ValueError(f"Root path is not a directory: {resolved}")
    return resolved


def has_git_marker(path: Path) -> bool:
    git_path = path / ".git"
    return git_path.is_dir() or git_path.is_file()


def safe_iterdir(path: Path, warnings: list[str]) -> list[Path]:
    try:
        return sorted(path.iterdir(), key=lambda item: item.name.lower())
    except PermissionError:
        warnings.append(f"Skipped unreadable directory: {path}")
    except OSError as exc:
        warnings.append(
            f"Skipped directory due to filesystem error: {path}: {exc}"
        )
    return []


def normalize_directory_candidate(
    root: Path,
    candidate: Path,
    warnings: list[str],
) -> Path | None:
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError:
        warnings.append(f"Skipped missing path during discovery: {candidate}")
        return None
    except PermissionError:
        warnings.append(
            f"Skipped unreadable path during discovery: {candidate}"
        )
        return None
    except OSError as exc:
        warnings.append(
            f"Skipped path due to filesystem error: {candidate}: {exc}"
        )
        return None

    if not resolved.is_dir():
        return None
    if not is_within(root, resolved):
        warnings.append(
            "Skipped path outside discovery root after normalization: "
            f"{candidate} -> {resolved}"
        )
        return None
    return resolved


def classify_high_signal(name: str) -> str | None:
    return HIGH_SIGNAL_TYPE_ALIASES.get(name.lower())


def build_high_signal_entry(
    root: Path,
    path: Path,
    signal_type: str,
) -> dict[str, str]:
    return {
        "path": str(path),
        "relative_path": path.relative_to(root).as_posix(),
        "signal_type": signal_type,
    }


def collect_root_high_signal_paths(
    root: Path,
    warnings: list[str],
) -> list[dict[str, str]]:
    seen: set[Path] = set()
    results: list[dict[str, str]] = []
    for child in safe_iterdir(root, warnings):
        if child.name in SKIP_DIR_NAMES or child.name.startswith("."):
            continue
        normalized = normalize_directory_candidate(root, child, warnings)
        if normalized is None or normalized in seen:
            continue
        signal_type = classify_high_signal(child.name)
        if signal_type is None:
            continue
        seen.add(normalized)
        results.append(build_high_signal_entry(root, normalized, signal_type))
    return sorted(results, key=lambda item: item["relative_path"])


def collect_repo_high_signal_paths(repo_root: Path) -> list[str]:
    results: list[str] = []
    for child in sorted(
        repo_root.iterdir(),
        key=lambda item: item.name.lower(),
    ):
        if child.name in SKIP_DIR_NAMES or child.name.startswith("."):
            continue
        try:
            if not child.is_dir():
                continue
        except OSError:
            continue
        if classify_high_signal(child.name) is None:
            continue
        results.append(child.resolve().relative_to(repo_root).as_posix())
    return results


def build_repo_candidate(root: Path, repo_root: Path) -> dict[str, Any]:
    relative_path = repo_root.relative_to(root).as_posix()
    high_signal_paths = collect_repo_high_signal_paths(repo_root)
    classification = classify_repository_type(
        repo_root,
        repo_name=repo_root.name,
    )
    return {
        "repo_id": slugify(relative_path.replace("/", "-")),
        "repo_name": titleize_segment(repo_root.name),
        "path": str(repo_root),
        "relative_path": relative_path,
        "high_signal_paths": high_signal_paths,
        "repository_type": classification["repository_type"],
        "classification_confidence": classification["classification_confidence"],
    }


def discover_candidate_repos(
    root: Path,
    warnings: list[str],
    *,
    max_depth: int = DEFAULT_DISTRIBUTED_SCAN_DEPTH,
) -> list[dict[str, Any]]:
    seen_dirs: set[Path] = {root}
    repos: list[dict[str, Any]] = []
    queue: deque[tuple[Path, int]] = deque([(root, 0)])

    while queue:
        current, depth = queue.popleft()
        for child in safe_iterdir(current, warnings):
            if child.name in SKIP_DIR_NAMES or child.name.startswith("."):
                continue
            normalized = normalize_directory_candidate(root, child, warnings)
            if normalized is None or normalized in seen_dirs:
                continue

            relative_depth = len(normalized.relative_to(root).parts)
            if relative_depth > max_depth:
                continue

            seen_dirs.add(normalized)
            if has_git_marker(normalized):
                repos.append(build_repo_candidate(root, normalized))
                continue

            if depth + 1 < max_depth:
                queue.append((normalized, depth + 1))

    repos.sort(key=lambda item: item["relative_path"])
    return repos


def classify_focus_area_repository_type(focus_type: str) -> str:
    return _FOCUS_TYPE_TO_REPOSITORY_TYPE.get(
        focus_type,
        DEFAULT_REPOSITORY_TYPE,
    )


def build_focus_area(
    root: Path,
    focus_root: Path,
    *,
    focus_type: str,
    group: str | None = None,
) -> dict[str, str]:
    relative_path = focus_root.relative_to(root).as_posix()
    entry = {
        "focus_id": slugify(relative_path.replace("/", "-")),
        "focus_name": titleize_segment(focus_root.name),
        "focus_type": focus_type,
        "path": str(focus_root),
        "relative_path": relative_path,
        "repository_type": classify_focus_area_repository_type(focus_type),
    }
    if group:
        entry["group"] = group
    return entry


def discover_candidate_focus_areas(
    root: Path,
    warnings: list[str],
) -> list[dict[str, str]]:
    seen_paths: set[Path] = set()
    focus_areas: list[dict[str, str]] = []
    generic_top_level_dirs: list[Path] = []

    for child in safe_iterdir(root, warnings):
        if child.name in SKIP_DIR_NAMES or child.name.startswith("."):
            continue
        normalized = normalize_directory_candidate(root, child, warnings)
        if normalized is None or normalized in seen_paths:
            continue
        seen_paths.add(normalized)
        generic_top_level_dirs.append(normalized)

        child_name = child.name.lower()
        if child_name in GROUP_CHILD_TYPES:
            group_children = [
                grandchild
                for grandchild in safe_iterdir(normalized, warnings)
                if not grandchild.name.startswith(".")
                and grandchild.name not in SKIP_DIR_NAMES
            ]
            nested_added = False
            for grandchild in group_children:
                nested_normalized = normalize_directory_candidate(
                    root,
                    grandchild,
                    warnings,
                )
                if (
                    nested_normalized is None
                    or nested_normalized in seen_paths
                ):
                    continue
                seen_paths.add(nested_normalized)
                nested_added = True
                focus_areas.append(
                    build_focus_area(
                        root,
                        nested_normalized,
                        focus_type=GROUP_CHILD_TYPES[child_name],
                        group=child_name,
                    )
                )
            if not nested_added:
                focus_areas.append(
                    build_focus_area(
                        root,
                        normalized,
                        focus_type=GROUP_CHILD_TYPES[child_name],
                        group=child_name,
                    )
                )
            continue

        focus_type = DIRECT_FOCUS_TYPES.get(child_name)
        if focus_type is not None:
            focus_areas.append(
                build_focus_area(root, normalized, focus_type=focus_type)
            )

    if not focus_areas:
        for directory in generic_top_level_dirs:
            focus_areas.append(
                build_focus_area(root, directory, focus_type="general")
            )

    focus_areas.sort(key=lambda item: item["relative_path"])
    return focus_areas


def discover_estate(root: Path | str, mode: str = "auto") -> dict[str, Any]:
    if mode not in {"auto", *ESTATE_TYPES}:
        raise ValueError(f"Unsupported discovery mode: {mode}")

    resolved_root = resolve_existing_root(root)
    warnings: list[str] = []
    auto_scan_warnings: list[str] = []
    distributed_candidates: list[dict[str, Any]] = []
    if mode == "auto":
        distributed_candidates = discover_candidate_repos(
            resolved_root,
            auto_scan_warnings,
        )

    if mode == "auto":
        if has_git_marker(resolved_root):
            estate_type = "monolith"
        elif distributed_candidates:
            estate_type = "distributed"
        else:
            estate_type = "monolith"
    else:
        estate_type = mode

    if mode == "auto" and estate_type == "monolith" and distributed_candidates:
        warnings.append(
            "Discovery root is itself a git repo; treating it as a monolith "
            "root instead of a distributed estate root."
        )

    candidate_repos: list[dict[str, Any]] = []
    candidate_focus_areas: list[dict[str, str]] = []

    if estate_type == "distributed":
        warnings.extend(auto_scan_warnings)
        candidate_repos = distributed_candidates or discover_candidate_repos(
            resolved_root,
            warnings,
        )
        if has_git_marker(resolved_root):
            warnings.append(
                "Distributed mode was requested for a git repo root; only "
                "nested repositories are considered candidates."
            )
        if not candidate_repos:
            warnings.append(
                "No candidate git repositories were discovered under the "
                "provided root."
            )
    else:
        candidate_focus_areas = discover_candidate_focus_areas(
            resolved_root,
            warnings,
        )
        if not candidate_focus_areas:
            warnings.append(
                "No candidate focus areas were discovered under the provided "
                "root."
            )

    high_signal_paths = collect_root_high_signal_paths(resolved_root, warnings)

    return {
        "estate_type": estate_type,
        "discovery_mode": estate_type if mode == "auto" else mode,
        "root_path": str(resolved_root),
        "candidate_repos": candidate_repos,
        "candidate_focus_areas": candidate_focus_areas,
        "high_signal_paths": high_signal_paths,
        "warnings": warnings,
        "discovered_at": utc_now(),
    }
