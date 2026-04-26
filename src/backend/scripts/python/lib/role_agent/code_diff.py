"""Capture git diffs from per-task worktrees for QA review.

Diff scope is derived exclusively from the per-task .task.json sidecar's
repoBindings[]. Each binding's worktreeRoot is the directory the agent
edited; running `git diff HEAD -- .` there captures the agent's
uncommitted task changes against baseCommitSha.

The platform workspace file is intentionally not consulted — it tracks
operator IDE folders, not per-task work surfaces.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_EMPTY_SENTINEL = (
    "# No git diff available. Skip this file and scope "
    "your review to the files listed in the assigned slice.\n"
)


def _git_diff(repo_path: Path) -> str:
    """Capture git diff from a worktree, including untracked files.

    Uses `git add -N .` so files the agent created appear in the diff output.
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


def _resolve_task_sidecar_path(repo_root: Path, task_id: str) -> Path:
    return repo_root / "AgentWorkSpace" / "tasks" / task_id / ".task.json"


def _load_repo_bindings(repo_root: Path, task_id: str) -> list[tuple[str, Path]]:
    """Load (repoSlug, worktreeRoot) pairs from the per-task sidecar.

    Returns an empty list when the sidecar is missing, malformed, or has
    no bindings so the caller can write the empty-diff sentinel.
    """
    sidecar_path = _resolve_task_sidecar_path(repo_root, task_id)
    if not sidecar_path.exists():
        logger.warning("task sidecar missing at %s", sidecar_path)
        return []
    try:
        data = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("failed to parse task sidecar %s: %s", sidecar_path, exc)
        return []
    if not isinstance(data, dict):
        return []

    binding_root = data.get("contextPackBinding")
    if not isinstance(binding_root, dict):
        return []
    bindings = binding_root.get("repoBindings")
    if not isinstance(bindings, list):
        return []

    entries: list[tuple[str, Path]] = []
    for binding in bindings:
        if not isinstance(binding, dict):
            continue
        worktree_root = binding.get("worktreeRoot")
        if not isinstance(worktree_root, str) or not worktree_root.strip():
            continue
        path = Path(worktree_root)
        if not path.is_dir():
            logger.warning("worktreeRoot does not exist or is not a directory: %s", path)
            continue
        entries.append((path.name, path))
    return entries


def _build_header(repo_names: list[str]) -> str:
    lines = ["# Active per-task worktrees in review scope:"]
    for name in repo_names:
        lines.append(f"#   - {name}")
    lines.append("#")
    lines.append("")
    return "\n".join(lines)


def capture_code_diff(
    repo_root: str,
    task_id: str,
    output_path: str,
) -> tuple[int, list[str]]:
    """Capture git diffs from per-task worktrees into a single file.

    Returns (exit_code, repo_names) so the dispatch helper can echo
    repo names for downstream env export without a second resolution pass.
    """
    out = Path(output_path)
    root = Path(repo_root).resolve()

    entries = _load_repo_bindings(root, task_id)
    repo_names = [name for name, _ in entries]
    header = _build_header(repo_names)

    sections: list[str] = []
    for name, worktree in entries:
        try:
            diff = _git_diff(worktree)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Skipping worktree diff for %s (%s): %s", name, worktree, exc)
            continue
        if diff:
            sections.append(f"# --- Worktree: {name} ({worktree}) ---\n{diff}")

    content = header + "\n".join(sections) if sections else header + _EMPTY_SENTINEL
    try:
        out.write_text(content, encoding="utf-8")
    except OSError as exc:
        print(f"[code-diff] Failed to write diff artifact to {out}: {exc}", file=sys.stderr)
        return 1, repo_names

    return 0, repo_names
