"""Capture git diffs from active workspace repos for QA review.

Reads the .code-workspace file to determine which repos are currently
attached, then captures diffs only from those repos.  Falls back to
repo-sources.json when the workspace file has no external folders.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
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
    try:
        probe = subprocess.run(
            ["git", "-C", str(repo_path), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        logger.debug("git probe failed for %s", repo_path)
        return ""

    if probe.returncode != 0:
        return ""

    # Mark untracked files as intent-to-add so they appear in diffs.
    try:
        subprocess.run(
            ["git", "-C", str(repo_path), "add", "-N", "."],
            capture_output=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
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
    except (subprocess.SubprocessError, OSError):
        pass
    return ""


def _is_accessible_dir(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        logger.debug("Skipping unreadable directory %s", path)
        return False


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
    if not isinstance(data, dict):
        logger.debug("Workspace file %s did not contain an object payload", ws_path)
        return []
    folders: list[Path] = []
    for entry in data.get("folders", []):
        if not isinstance(entry, dict):
            continue
        raw = entry.get("path", "")
        if not raw:
            continue
        path = Path(raw)
        if not path.is_absolute():
            path = (repo_root / path).resolve()
        if path.resolve() == repo_root.resolve():
            continue
        if _is_accessible_dir(path):
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
    if not isinstance(data, dict):
        logger.debug("Repo-sources manifest %s did not contain an object payload", manifest_path)
        return []
    repos: list[tuple[str, Path]] = []
    for repo in data.get("repositories", []):
        if not isinstance(repo, dict):
            continue
        repo_name = repo.get("repo_name", repo.get("repo_id", "unknown"))
        for local_path in repo.get("local_paths", []):
            if not isinstance(local_path, str):
                continue
            path = Path(local_path)
            if _is_accessible_dir(path):
                repos.append((repo_name, path))
    return repos


def _resolve_repo_entries(
    cp_dir: Path | None,
    root: Path,
) -> list[tuple[str, Path]]:
    """Resolve active repos: workspace folders → manifest → monolith fallback.

    Excludes the platform repo itself — only external context-pack repos
    where agents make task code changes are included.
    """
    ws_folders = _load_workspace_folders(root)
    if ws_folders:
        return [(f.name, f) for f in ws_folders]

    if cp_dir is not None:
        manifest_repos = _load_repo_sources(cp_dir)
        if manifest_repos:
            # Exclude the platform repo — it's the orchestrator, not a target.
            return [
                (name, path)
                for name, path in manifest_repos
                if path.resolve() != root.resolve()
            ]

    return [(root.name, root)]


def _build_header(repo_names: list[str]) -> str:
    """Build a header listing the repos in review scope."""
    lines = ["# Active context-pack repos in review scope:"]
    for name in repo_names:
        lines.append(f"#   - {name}")
    lines.append("#")
    lines.append("")
    return "\n".join(lines)


def capture_code_diff(
    context_pack_dir: str | None,
    output_path: str,
    repo_root: str | None = None,
) -> tuple[int, list[str]]:
    """Capture git diffs from active workspace repos into one file.

    Returns ``(exit_code, repo_names)`` so the caller can export the
    repo names without a second resolution pass.
    """
    out = Path(output_path)
    cp_dir = Path(context_pack_dir).resolve() if context_pack_dir else None
    root = Path(repo_root).resolve() if repo_root else (cp_dir or Path.cwd()).resolve()

    entries = _resolve_repo_entries(cp_dir, root)
    repo_names = [name for name, _ in entries]
    header = _build_header(repo_names)

    sections: list[str] = []
    for name, folder in entries:
        try:
            diff = _git_diff(folder)
        except Exception as exc:  # pragma: no cover - defensive hardening
            logger.warning("Skipping repo diff for %s (%s): %s", name, folder, exc)
            continue
        if diff:
            sections.append(f"# --- Repo: {name} ({folder}) ---\n{diff}")

    content = header + "\n".join(sections) if sections else header + _EMPTY_SENTINEL
    try:
        out.write_text(content, encoding="utf-8")
    except OSError as exc:
        print(
            f"[code-diff] Failed to write diff artifact to {out}: {exc}",
            file=sys.stderr,
        )
        return 1, repo_names

    return 0, repo_names
