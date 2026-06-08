"""Core discovery logic for context estate scanning."""
from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Any

from src.backend.mcp.context_estate.constants import (
    ALLOWED_DISCOVERY_MODES,
    DEFAULT_DISTRIBUTED_SCAN_DEPTH,
    DEFAULT_REPOSITORY_TYPE,
    DIRECT_FOCUS_TYPES,
    GROUP_CHILD_TYPES,
    HIGH_SIGNAL_TYPE_ALIASES,
    SKIP_DIR_NAMES,
)
from src.backend.mcp.probes.repo_category_probe import classify_repo_category
from src.backend.mcp.repo_context_mcp.utils import (
    is_within,
    slugify,
    titleize_segment,
    utc_now,
)

_FOCUS_TYPE_TO_REPO_CATEGORY: dict[str, str] = {
    "service": "service",
    "application": "application",
    "backend": "service",
    "frontend": "frontend",
    "source": "service",
    "library": "library",
    "package": "library",
    "docs": "documentation",
    "infrastructure": "infrastructure",
    "shared": "library",
    "general": "unknown",
    "module": "library",
    "domain": "service",
    "component": "frontend",
}

# Backward-compat mapping: repo_category → repo_focus (primary/support)
_REPO_CATEGORY_TO_REPO_FOCUS: dict[str, str] = {
    "service": "primary",
    "application": "primary",
    "frontend": "primary",
    "library": "support",
    "data": "support",
    "documentation": "support",
    "infrastructure": "support",
    "tool": "support",
    "unknown": "support",
}

_REPO_CATEGORY_TO_SYSTEM_LAYER: dict[str, str] = {
    "service": "backend",
    "application": "backend",
    "frontend": "frontend",
    "library": "shared",
    "data": "database",
    "documentation": "documents",
    "infrastructure": "infrastructure",
    "tool": "shared",
    "unknown": "backend",
}


def resolve_existing_root(
    root: Path | str,
    *,
    allow_missing: bool = False,
) -> Path:
    candidate = Path(root).expanduser()
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        if allow_missing:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate.resolve()
        raise ValueError(f"Root path does not exist: {candidate}") from exc

    if not resolved.is_dir():
        raise ValueError(f"Root path is not a directory: {resolved}")
    return resolved


def has_git_marker(path: Path) -> bool:
    git_path = path / ".git"
    return git_path.is_dir() or git_path.is_file()


def is_within_git_worktree(path: Path) -> bool:
    """True if ``path`` or any ancestor has a top-level Git marker.

    Distinct from ``has_git_marker`` (repository-ROOT detection): an
    existing-source selection may be a subtree of a larger repo (e.g. a monorepo
    subdirectory) whose ``.git`` lives in an ancestor. Used only for
    selected-root eligibility; candidate-repo discovery still uses
    ``has_git_marker`` so distinct nested repos remain detectable.
    """
    current = path
    while True:
        if has_git_marker(current):
            return True
        parent = current.parent
        if parent == current:
            return False
        current = parent


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


def collect_repo_high_signal_paths(
    repo_root: Path, warnings: list[str] | None = None
) -> list[str]:
    if warnings is None:
        warnings = []
    results: list[str] = []
    for child in safe_iterdir(repo_root, warnings):
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


def build_repo_candidate(
    root: Path, repo_root: Path, warnings: list[str]
) -> dict[str, Any]:
    relative_path = repo_root.relative_to(root).as_posix()
    high_signal_paths = collect_repo_high_signal_paths(repo_root, warnings)
    repo_category, repo_category_confidence = classify_repo_category(repo_root)
    return {
        "repo_id": slugify(relative_path.replace("/", "-")),
        "repo_name": titleize_segment(repo_root.name),
        "path": str(repo_root),
        "relative_path": relative_path,
        "high_signal_paths": high_signal_paths,
        "repo_category": repo_category,
        "repo_category_confidence": repo_category_confidence,
        "suggested_system_layer": (
            _REPO_CATEGORY_TO_SYSTEM_LAYER.get(repo_category) or "backend"
        ),
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
                repos.append(build_repo_candidate(root, normalized, warnings))
                continue

            if depth + 1 < max_depth:
                queue.append((normalized, depth + 1))

    repos.sort(key=lambda item: item["relative_path"])
    return repos


def build_missing_git_repo_warning(root: Path, candidate: Path) -> dict[str, str]:
    repo_name = candidate.name
    return {
        "repo_name": repo_name,
        "path": str(candidate),
        "relative_path": candidate.relative_to(root).as_posix(),
        "message": (
            f"repo {repo_name} does not have .git folder, if you would like it "
            "part of this context pack please initialize git in this repo."
        ),
    }


def collect_missing_git_repo_warnings(
    root: Path,
    discovered_repos: list[dict[str, Any]],
    warnings: list[str],
    *,
    max_depth: int = DEFAULT_DISTRIBUTED_SCAN_DEPTH,
) -> list[dict[str, str]]:
    """Collect repo-like folders skipped because they lack a top-level Git marker.

    Mirrors ``discover_candidate_repos`` traversal (same skip names, hidden
    filter, path-escape normalization, and max-depth boundary). Folders that
    contain a discovered Git repo below them, and folders whose name is a
    recognized grouping folder (``GROUP_CHILD_TYPES``), are descended into rather
    than warned on, so their repo-like children are surfaced instead. Any other
    non-Git repo-like leaf is warned once and not descended.
    """
    discovered_paths: set[Path] = set()
    for repo in discovered_repos:
        repo_path = repo.get("path")
        if not isinstance(repo_path, str):
            continue
        try:
            discovered_paths.add(Path(repo_path).resolve())
        except OSError:
            continue

    grouping_dirs: set[Path] = set()
    for repo_path in discovered_paths:
        for parent in repo_path.parents:
            if parent == root or not is_within(root, parent):
                break
            grouping_dirs.add(parent)

    skipped: list[dict[str, str]] = []
    seen_dirs: set[Path] = {root}
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
            if has_git_marker(normalized) or normalized in discovered_paths:
                continue

            is_grouping_folder = (
                normalized in grouping_dirs
                or normalized.name.lower() in GROUP_CHILD_TYPES
            )
            if is_grouping_folder:
                if depth + 1 < max_depth:
                    queue.append((normalized, depth + 1))
                continue

            skipped.append(build_missing_git_repo_warning(root, normalized))

    skipped.sort(key=lambda item: item["relative_path"])
    return skipped


def classify_focus_area_repo_category(focus_type: str) -> str:
    """Return the repo_category for a given focus_type (v2 field)."""
    return _FOCUS_TYPE_TO_REPO_CATEGORY.get(focus_type, "unknown")


def classify_focus_area_repository_type(focus_type: str) -> str:
    """Return the legacy repository_type for a given focus_type.

    Deprecated: prefer classify_focus_area_repo_category for v2 data.
    Kept for backward compat with callers that still read repository_type.
    """
    category = classify_focus_area_repo_category(focus_type)
    # dict.get with a str default returns str; explicit fallback guards Pyright.
    return _REPO_CATEGORY_TO_REPO_FOCUS.get(category) or DEFAULT_REPOSITORY_TYPE


_ROOT_CATEGORY_PRECEDENCE = (
    "service",
    "application",
    "frontend",
    "data",
    "infrastructure",
    "library",
    "tool",
    "documentation",
)


def _most_frequent_focus_category(focus_categories: list[str]) -> str:
    """Return the most frequent (dominant) focus-area category.

    Single bounded pass over the already-discovered, finite focus-area list —
    NOT a recursive walk. Counts each non-unknown category and returns the most
    common one; ties are broken deterministically by _ROOT_CATEGORY_PRECEDENCE.
    Returns 'unknown' when there is no usable signal.
    """
    counts: dict[str, int] = {}
    for category in focus_categories:
        if category and category != "unknown":
            counts[category] = counts.get(category, 0) + 1
    if not counts:
        return "unknown"
    max_count = max(counts.values())
    for category in _ROOT_CATEGORY_PRECEDENCE:
        if counts.get(category, 0) == max_count:
            return category
    # Defensive: a valid category absent from the precedence tuple still wins if
    # it is the most frequent, rather than being silently discarded.
    return max(counts, key=lambda category: counts[category])


def resolve_monolith_root_category(
    root: Path, focus_areas: list[dict[str, Any]]
) -> tuple[str, str]:
    """Resolve a monolith root's category from its focus areas (single pass).

    Focus-area discovery runs first; the root's category is then the MOST
    FREQUENT (dominant) focus-area category — the most common kind among the
    monorepo's folders, ties broken by precedence. Only when there is no usable
    focus-area signal does it fall back to a direct, bounded probe of the root.
    No folder recursion; `focus_areas` is finite, so this terminates
    unconditionally.
    """
    dominant = _most_frequent_focus_category(
        [str(area.get("focus_category", "")) for area in focus_areas]
    )
    if dominant != "unknown":
        return dominant, "medium"
    return classify_repo_category(root)


def build_focus_area(
    root: Path,
    focus_root: Path,
    *,
    focus_type: str,
    group: str | None = None,
) -> dict[str, str]:
    relative_path = focus_root.relative_to(root).as_posix()
    focus_category = classify_focus_area_repo_category(focus_type)
    if focus_category == "unknown":
        # The folder-name/type heuristic was inconclusive, so classify by the
        # folder's CONTENTS — the same probe distributed repos use. This lets a
        # generically-named monolith folder that actually contains a service,
        # library, frontend, etc. be recognized instead of defaulting to
        # 'unknown'.
        probed_category, _confidence = classify_repo_category(focus_root)
        focus_category = probed_category
    entry = {
        "focus_id": slugify(relative_path.replace("/", "-")),
        "focus_name": titleize_segment(focus_root.name),
        "focus_type": focus_type,
        "path": str(focus_root),
        "relative_path": relative_path,
        "focus_category": focus_category,
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


def _canonical_scan_kind(mode: str) -> str:
    """Strip -platform suffix to get the binary scan branch ('distributed' | 'monolith')."""
    if mode.startswith("distributed"):
        return "distributed"
    return "monolith"


def discover_estate(
    root: Path | str,
    mode: str = "auto",
    *,
    allow_missing: bool = False,
) -> dict[str, Any]:
    if mode not in ALLOWED_DISCOVERY_MODES:
        raise ValueError(f"Unsupported discovery mode: {mode}")

    resolved_root = resolve_existing_root(root, allow_missing=allow_missing)
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
    skipped_repos_missing_git: list[dict[str, str]] = []
    root_repo_category = "unknown"
    root_repo_category_confidence = "low"

    if _canonical_scan_kind(estate_type) == "distributed":
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
        skipped_repos_missing_git = collect_missing_git_repo_warnings(
            resolved_root,
            candidate_repos,
            warnings,
        )
        warnings.extend(item["message"] for item in skipped_repos_missing_git)
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
        root_repo_category, root_repo_category_confidence = (
            resolve_monolith_root_category(resolved_root, candidate_focus_areas)
        )
        # Existing-source monolith roots are repositories: warn once if the
        # selected root itself lacks a Git marker. The allow_missing helper path
        # (new-project bootstrap) creates an empty root and must not warn.
        if not allow_missing and not is_within_git_worktree(resolved_root):
            root_warning = build_missing_git_repo_warning(
                resolved_root,
                resolved_root,
            )
            skipped_repos_missing_git.append(root_warning)
            warnings.append(root_warning["message"])

    high_signal_paths = collect_root_high_signal_paths(resolved_root, warnings)

    return {
        "estate_type": estate_type,
        "discovery_mode": estate_type if mode == "auto" else mode,
        "root_path": str(resolved_root),
        "candidate_repos": candidate_repos,
        "candidate_focus_areas": candidate_focus_areas,
        "root_repo_category": root_repo_category,
        "root_repo_category_confidence": root_repo_category_confidence,
        "high_signal_paths": high_signal_paths,
        "skipped_repos_missing_git": skipped_repos_missing_git,
        "warnings": warnings,
        "discovered_at": utc_now(),
    }
