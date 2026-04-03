"""Capture git diffs from active workspace repos for QA review.

Reads the .code-workspace file to determine which repos are currently
attached, then captures diffs only from those repos.  Falls back to
repo-sources.json when the workspace file has no external folders.
"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

from src.backend.mcp.workspace_context_sync_service import DEFAULT_WORKSPACE_FILE

_EMPTY_SENTINEL = (
    "# No git diff available. Skip this file and scope "
    "your review to the files listed in the assigned slice.\n"
)


def _git_diff(repo_path: Path) -> str:
    """Capture git diff from a repo, including untracked files.

    Uses ``git add -N .`` (intent-to-add) so that new files created by
    agents appear in the diff output even though agents cannot commit.
    """
    # Mark untracked files as intent-to-add so they appear in diffs.
    try:
        subprocess.run(
            ["git", "-C", str(repo_path), "add", "-N", "."],
            capture_output=True,
            timeout=10,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        logger.debug("git add -N failed for %s", repo_path)

    try:
        result = subprocess.run(
            ["git", "-C", str(repo_path), "diff", "HEAD", "--", "."],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return ""


def _load_workspace_folders(repo_root: Path) -> list[Path]:
    """Read folder paths from the .code-workspace file."""
    ws_path = repo_root / DEFAULT_WORKSPACE_FILE
    if not ws_path.exists():
        return []
    try:
        data = json.loads(ws_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.debug("Failed to parse workspace file %s", ws_path)
        return []
    folders: list[Path] = []
    for entry in data.get("folders", []):
        raw = entry.get("path", "")
        if not raw:
            continue
        path = Path(raw)
        if not path.is_absolute():
            path = (repo_root / path).resolve()
        if path.resolve() == repo_root.resolve():
            continue
        if path.is_dir():
            folders.append(path)
    return folders


def _load_repo_sources(
    context_pack_dir: Path,
) -> list[tuple[str, Path]]:
    """Read repo names and paths from qmd/repo-sources.json."""
    manifest_path = context_pack_dir / "qmd" / "repo-sources.json"
    if not manifest_path.exists():
        return []
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.debug("Failed to parse repo-sources manifest %s", manifest_path)
        return []
    repos: list[tuple[str, Path]] = []
    for repo in data.get("repositories", []):
        repo_name = repo.get("repo_name", repo.get("repo_id", "unknown"))
        for local_path in repo.get("local_paths", []):
            path = Path(local_path)
            if path.is_dir():
                repos.append((repo_name, path))
    return repos


def _resolve_repo_entries(
    cp_dir: Path,
    root: Path,
) -> list[tuple[str, Path]]:
    """Resolve active repos: workspace folders → manifest → monolith fallback.

    Excludes the platform repo itself — only external context-pack repos
    where agents make task code changes are included.
    """
    ws_folders = _load_workspace_folders(root)
    if ws_folders:
        return [(f.name, f) for f in ws_folders]

    manifest_repos = _load_repo_sources(cp_dir)
    if manifest_repos:
        # Exclude the platform repo — it's the orchestrator, not a target.
        return [
            (name, path)
            for name, path in manifest_repos
            if path.resolve() != root.resolve()
        ]

    return [(cp_dir.name, cp_dir)]


def _build_header(repo_names: list[str]) -> str:
    """Build a header listing the repos in review scope."""
    lines = ["# Active context-pack repos in review scope:"]
    for name in repo_names:
        lines.append(f"#   - {name}")
    lines.append("#")
    lines.append("")
    return "\n".join(lines)


def capture_code_diff(
    context_pack_dir: str,
    output_path: str,
    repo_root: str | None = None,
) -> tuple[int, list[str]]:
    """Capture git diffs from active workspace repos into one file.

    Returns ``(exit_code, repo_names)`` so the caller can export the
    repo names without a second resolution pass.
    """
    out = Path(output_path)
    cp_dir = Path(context_pack_dir).resolve()
    root = Path(repo_root).resolve() if repo_root else cp_dir

    entries = _resolve_repo_entries(cp_dir, root)
    repo_names = [name for name, _ in entries]
    header = _build_header(repo_names)

    sections: list[str] = []
    for name, folder in entries:
        diff = _git_diff(folder)
        if diff:
            sections.append(f"# --- Repo: {name} ({folder}) ---\n{diff}")

    if sections:
        out.write_text(header + "\n".join(sections), encoding="utf-8")
    else:
        out.write_text(header + _EMPTY_SENTINEL, encoding="utf-8")

    return 0, repo_names
