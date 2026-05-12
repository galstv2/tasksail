"""Capture git diffs from per-task worktrees for QA review.

Diff scope is derived exclusively from the per-task .task.json sidecar's
contextPackBinding.repoBindings[]. Each binding represents one activated
worktree in Ron's review scope.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

CaptureStatus = Literal[
    "captured",
    "clean",
    "skipped-non-git",
    "missing-worktree",
    "git-probe-failed",
    "intent-to-add-failed",
    "invalid-base-commit",
    "diff-failed",
]

_FATAL_STATUSES: frozenset[CaptureStatus] = frozenset(
    {
        "missing-worktree",
        "git-probe-failed",
        "intent-to-add-failed",
        "invalid-base-commit",
        "diff-failed",
    }
)


@dataclass(frozen=True)
class DiffBinding:
    repo_slug: str
    original_root: Path | None
    worktree_root: Path
    worktree_branch: str
    base_commit_sha: str


@dataclass(frozen=True)
class CaptureOutcome:
    binding: DiffBinding
    status: CaptureStatus
    base_label: str
    diff: str = ""
    detail: str = ""


class SidecarCaptureError(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _resolve_task_sidecar_path(repo_root: Path, task_id: str) -> Path:
    return repo_root / "AgentWorkSpace" / "tasks" / task_id / ".task.json"


def _load_sidecar(sidecar_path: Path) -> dict[str, object]:
    if not sidecar_path.exists():
        raise SidecarCaptureError("missing-sidecar", f"task sidecar missing at {sidecar_path}")
    try:
        data = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SidecarCaptureError(
            "malformed-json",
            f"failed to parse task sidecar {sidecar_path}: {exc}",
        ) from exc
    except OSError as exc:
        raise SidecarCaptureError(
            "unreadable-sidecar",
            f"failed to read task sidecar {sidecar_path}: {exc}",
        ) from exc
    if not isinstance(data, dict):
        raise SidecarCaptureError("non-object-sidecar", "task sidecar JSON must be an object")
    return data


def _derive_display_slug(worktree_root: Path, seen: dict[str, int]) -> str:
    base_slug = worktree_root.name or "worktree"
    seen_count = seen.get(base_slug, 0) + 1
    seen[base_slug] = seen_count
    return base_slug if seen_count == 1 else f"{base_slug}-{seen_count}"


def _load_repo_bindings(repo_root: Path, task_id: str) -> list[DiffBinding]:
    sidecar_path = _resolve_task_sidecar_path(repo_root, task_id)
    data = _load_sidecar(sidecar_path)

    binding_root = data.get("contextPackBinding")
    if not isinstance(binding_root, dict):
        raise SidecarCaptureError(
            "missing-contextPackBinding",
            "task sidecar is missing contextPackBinding object",
        )
    bindings = binding_root.get("repoBindings")
    if not isinstance(bindings, list):
        raise SidecarCaptureError(
            "invalid-repoBindings",
            "contextPackBinding.repoBindings must be an array",
        )
    if len(bindings) == 0:
        raise SidecarCaptureError(
            "empty-repoBindings",
            "contextPackBinding.repoBindings must contain at least one binding",
        )

    seen_slugs: dict[str, int] = {}
    entries: list[DiffBinding] = []
    for index, binding in enumerate(bindings):
        if not isinstance(binding, dict):
            raise SidecarCaptureError(
                "malformed-binding",
                f"repoBindings[{index}] must be an object",
            )
        worktree_root_raw = binding.get("worktreeRoot")
        if not isinstance(worktree_root_raw, str) or not worktree_root_raw.strip():
            raise SidecarCaptureError(
                "malformed-binding",
                f"repoBindings[{index}].worktreeRoot must be a non-empty string",
            )
        worktree_root = Path(worktree_root_raw.strip())
        original_root_raw = binding.get("originalRoot")
        original_root = (
            Path(original_root_raw.strip())
            if isinstance(original_root_raw, str) and original_root_raw.strip()
            else None
        )
        worktree_branch_raw = binding.get("worktreeBranch")
        base_commit_raw = binding.get("baseCommitSha")
        entries.append(
            DiffBinding(
                repo_slug=_derive_display_slug(worktree_root, seen_slugs),
                original_root=original_root,
                worktree_root=worktree_root,
                worktree_branch=worktree_branch_raw.strip()
                if isinstance(worktree_branch_raw, str)
                else "",
                base_commit_sha=base_commit_raw.strip()
                if isinstance(base_commit_raw, str)
                else "",
            )
        )
    return entries


def _git_run(
    args: list[str],
    *,
    timeout: int,
    text: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        capture_output=True,
        text=text,
        timeout=timeout,
    )


def _process_detail(result: subprocess.CompletedProcess[str]) -> str:
    output = (result.stderr or result.stdout or "").strip()
    if output:
        return output
    return f"command exited with code {result.returncode}"


def _exception_detail(exc: BaseException) -> str:
    if isinstance(exc, subprocess.TimeoutExpired):
        return f"command timed out after {exc.timeout} seconds"
    return str(exc) or exc.__class__.__name__


def _capture_binding(binding: DiffBinding) -> CaptureOutcome:
    base_label = binding.base_commit_sha or "HEAD"
    if not binding.worktree_root.is_dir():
        return CaptureOutcome(
            binding=binding,
            status="missing-worktree",
            base_label=base_label,
            detail="worktreeRoot does not exist or is not a directory",
        )

    try:
        probe = _git_run(
            ["git", "-C", str(binding.worktree_root), "rev-parse", "--is-inside-work-tree"],
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return CaptureOutcome(
            binding=binding,
            status="git-probe-failed",
            base_label=base_label,
            detail=_exception_detail(exc),
        )
    if probe.returncode != 0:
        return CaptureOutcome(
            binding=binding,
            status="skipped-non-git",
            base_label=base_label,
            detail=_process_detail(probe),
        )

    try:
        intent_to_add = _git_run(
            ["git", "-C", str(binding.worktree_root), "add", "-N", "."],
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return CaptureOutcome(
            binding=binding,
            status="intent-to-add-failed",
            base_label=base_label,
            detail=_exception_detail(exc),
        )
    if intent_to_add.returncode != 0:
        return CaptureOutcome(
            binding=binding,
            status="intent-to-add-failed",
            base_label=base_label,
            detail=_process_detail(intent_to_add),
        )

    if binding.base_commit_sha:
        try:
            base_check = _git_run(
                [
                    "git",
                    "-C",
                    str(binding.worktree_root),
                    "cat-file",
                    "-e",
                    f"{binding.base_commit_sha}^{{commit}}",
                ],
                timeout=10,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            return CaptureOutcome(
                binding=binding,
                status="invalid-base-commit",
                base_label=base_label,
                detail=_exception_detail(exc),
            )
        if base_check.returncode != 0:
            return CaptureOutcome(
                binding=binding,
                status="invalid-base-commit",
                base_label=base_label,
                detail=_process_detail(base_check),
            )

    try:
        diff = _git_run(
            ["git", "-C", str(binding.worktree_root), "diff", base_label, "--", "."],
            timeout=30,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return CaptureOutcome(
            binding=binding,
            status="diff-failed",
            base_label=base_label,
            detail=_exception_detail(exc),
        )
    if diff.returncode != 0:
        return CaptureOutcome(
            binding=binding,
            status="diff-failed",
            base_label=base_label,
            detail=_process_detail(diff),
        )
    if not diff.stdout.strip():
        return CaptureOutcome(binding=binding, status="clean", base_label=base_label)
    return CaptureOutcome(
        binding=binding,
        status="captured",
        base_label=base_label,
        diff=diff.stdout,
    )


def _build_header(task_id: str, outcomes: list[CaptureOutcome]) -> str:
    lines = [
        "# QA code diff capture",
        f"# Task ID: {task_id}",
        f"# Source: AgentWorkSpace/tasks/{task_id}/.task.json contextPackBinding.repoBindings",
        "# Diff basis: baseCommitSha when available, HEAD only when baseCommitSha is empty",
        "#",
        "# Worktrees in review scope:",
    ]
    for outcome in outcomes:
        binding = outcome.binding
        lines.append(
            f"#   - {binding.repo_slug} | status={outcome.status} | "
            f"base={outcome.base_label} | path={binding.worktree_root}"
        )
    lines.extend(["#", ""])
    return "\n".join(lines)


def _build_sidecar_failure_artifact(task_id: str, error: SidecarCaptureError) -> str:
    return "\n".join(
        [
            "# QA code diff capture",
            f"# Task ID: {task_id}",
            f"# Source: AgentWorkSpace/tasks/{task_id}/.task.json contextPackBinding.repoBindings",
            "# Diff basis: baseCommitSha when available, HEAD only when baseCommitSha is empty",
            "#",
            "# Worktrees in review scope:",
            "#",
            "",
            "# Diff capture failed for one or more bound worktrees.",
            "# Ron must not review this task until the orchestrator can generate a complete diff.",
            f"# ERROR sidecar: {error.code} {error.detail}",
            "",
        ]
    )


def _build_artifact(task_id: str, outcomes: list[CaptureOutcome]) -> str:
    content = [_build_header(task_id, outcomes)]
    failed = [outcome for outcome in outcomes if outcome.status in _FATAL_STATUSES]
    changed = [outcome for outcome in outcomes if outcome.status == "captured"]

    if failed:
        content.append("# Diff capture failed for one or more bound worktrees.")
        content.append("# Ron must not review this task until the orchestrator can generate a complete diff.")
        for outcome in failed:
            detail = outcome.detail or "no additional detail"
            content.append(f"# ERROR {outcome.binding.repo_slug}: {outcome.status} {detail}")
        content.append("")

    for outcome in changed:
        diff = outcome.diff if outcome.diff.endswith("\n") else f"{outcome.diff}\n"
        content.append(f"# --- Worktree: {outcome.binding.repo_slug} ({outcome.binding.worktree_root}) ---")
        content.append(diff.rstrip("\n"))
        content.append("")

    if not changed and not failed:
        content.append("# No git changes detected in bound worktrees.")
        content.append("")

    return "\n".join(content)


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(content)
            handle.flush()
        temp_path.replace(path)
    except OSError:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


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

    try:
        bindings = _load_repo_bindings(root, task_id)
    except SidecarCaptureError as exc:
        logger.warning("QA code diff sidecar capture failed: %s", exc.detail)
        content = _build_sidecar_failure_artifact(task_id, exc)
        try:
            _atomic_write_text(out, content)
        except OSError as write_exc:
            print(
                f"[code-diff] Failed to write diagnostic diff artifact to {out}: {write_exc}",
                file=sys.stderr,
            )
        return 1, []

    outcomes = [_capture_binding(binding) for binding in bindings]
    repo_names = [outcome.binding.repo_slug for outcome in outcomes]
    exit_code = 1 if any(outcome.status in _FATAL_STATUSES for outcome in outcomes) else 0
    content = _build_artifact(task_id, outcomes)
    try:
        _atomic_write_text(out, content)
    except OSError as exc:
        print(f"[code-diff] Failed to write diff artifact to {out}: {exc}", file=sys.stderr)
        return 1, repo_names

    return exit_code, repo_names
