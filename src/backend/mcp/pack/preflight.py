"""PackPreflightValidator — pre-creation validation for context pack creation.

Runs every precondition check against a `PackPreflightRequest` and returns a
structured `PreflightResult` the renderer can use to surface field-scoped
errors. The validator is non-short-circuiting: it accumulates all errors and
warnings so the renderer can render aggregated UI in one pass.
"""
from __future__ import annotations

import dataclasses
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from src.backend.mcp.pack_schemas.answers import BootstrapAnswers

CreationOrigin = Literal["existing", "new"]

# Allowed creation-time slug shape. Reject leading/trailing dashes and cap at 64.
CONTEXT_PACK_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")

# Windows-reserved device names; rejected case-insensitively at creation time.
# Legacy packs on disk are tolerated — the validator runs only at creation.
_RESERVED_NAMES: frozenset[str] = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{i}" for i in range(1, 10)}
    | {f"lpt{i}" for i in range(1, 10)}
)

# Exact-match scary paths (root mounts, naked tilde, drive roots).
_SCARY_EXACT: frozenset[str] = frozenset({
    "/", "~", "~/", "C:\\", "C:\\\\",
    "/Users", "/home", "/Volumes",
})

# Hard prefix matches — any subpath under these is scary.
_SCARY_PREFIXES: tuple[str, ...] = (
    "/etc", "/System", "/Windows",
    "/Program Files", "/Program Files (x86)",
)

# Prefix matches with carve-outs. Each entry: (scary_prefix, (safe_subprefix, ...)).
_SCARY_PARTIAL: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("/usr", ("/usr/local",)),
    ("/var", ("/var/folders",)),
    ("/Library", ("/Library/Caches",)),
)

# /tmp depth gate: total path components must be > _TMP_MIN_PARTS to clear.
# Path('/tmp/foo/bar').parts == ('/', 'tmp', 'foo', 'bar') → len 4, OK.
# Path('/tmp/foo').parts → len 3, scary.
_TMP_PREFIX = "/tmp"
_TMP_MIN_PARTS = 3

# Minimum supported Python (matches repo guidance): Python 3.12 is preferred and
# is the compatibility floor. Compatible newer versions (>3.12) also pass; this
# is a minimum check, not an exact-version requirement.
PYTHON_MIN_VERSION: tuple[int, int] = (3, 12)


@dataclass(slots=True)
class PreflightError:
    code: str
    field: str | None
    message: str
    details: dict[str, Any] = dataclasses.field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "field": self.field,
            "message": self.message,
            "details": self.details,
        }


@dataclass(slots=True)
class PreflightResult:
    ok: bool
    errors: list[PreflightError] = dataclasses.field(default_factory=list)
    warnings: list[PreflightError] = dataclasses.field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
        }


@dataclass(slots=True)
class PackPreflightRequest:
    context_pack_dir: Path
    discovery_root: Path
    creation_origin: CreationOrigin
    confirm_overwrite: bool
    allow_scary_path: bool
    bootstrap_answers: BootstrapAnswers
    raw_bootstrap_answers: dict[str, Any]


# Path classification helpers for risky filesystem locations.

def _is_scary_path(path: str) -> tuple[bool, str | None]:
    """Return (is_scary, reason) for the given path string.

    `reason` is a short tag for the audit trail; surfaced via `details.reason`.
    Normalizes backslashes to forward slashes before prefix matching so
    Windows-style paths (e.g. C:\\Windows) classify alongside their POSIX
    equivalents (/Windows).
    """
    forward = path.replace("\\", "/")
    normalized = forward.rstrip("/") if forward != "/" else forward
    if path in _SCARY_EXACT or forward in _SCARY_EXACT or normalized in _SCARY_EXACT:
        return True, "system-root"
    if path.startswith("~"):
        return True, "home-shorthand"

    # Strip a leading Windows drive letter ("C:") so the prefix list can be
    # expressed once in POSIX form. e.g. "C:/Windows/System32" → "/Windows/System32".
    drive_stripped = forward
    if len(forward) >= 2 and forward[1] == ":":
        drive_stripped = forward[2:] or "/"

    for prefix in _SCARY_PREFIXES:
        if drive_stripped == prefix or drive_stripped.startswith(prefix + "/"):
            return True, f"under {prefix}"

    for prefix, safe_subprefixes in _SCARY_PARTIAL:
        if drive_stripped == prefix or drive_stripped.startswith(prefix + "/"):
            if any(drive_stripped == s or drive_stripped.startswith(s + "/") for s in safe_subprefixes):
                continue
            return True, f"under {prefix}"

    if drive_stripped == _TMP_PREFIX or drive_stripped.startswith(_TMP_PREFIX + "/"):
        if len(Path(drive_stripped).parts) <= _TMP_MIN_PARTS:
            return True, "shallow /tmp"

    return False, None


def _is_same_or_within_path(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


class PackPreflightValidator:
    """Aggregates preflight checks into a single non-short-circuiting pass."""

    def __init__(self, request: PackPreflightRequest) -> None:
        self._request = request
        self._errors: list[PreflightError] = []
        self._warnings: list[PreflightError] = []

    def run(self) -> PreflightResult:
        # Order is presentation-only; checks do not depend on each other.
        self._check_slug()
        self._check_paths()
        self._check_collision()
        self._check_scary_path()
        self._check_tools()
        return PreflightResult(
            ok=len(self._errors) == 0,
            errors=self._errors,
            warnings=self._warnings,
        )

    # Validate context-pack slug and reserved device names.
    def _check_slug(self) -> None:
        slug = self._request.bootstrap_answers.context_pack_id
        if not slug or not CONTEXT_PACK_ID_PATTERN.match(slug):
            self._errors.append(PreflightError(
                code="context-pack-id-invalid",
                field="bootstrapAnswers.contextPackId",
                message=(
                    "contextPackId must match /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/."
                ),
                details={"reason": "slug-format", "value": slug},
            ))
            return
        if slug.lower() in _RESERVED_NAMES:
            self._errors.append(PreflightError(
                code="context-pack-id-invalid",
                field="bootstrapAnswers.contextPackId",
                message=(
                    f"contextPackId {slug!r} is a Windows-reserved device name."
                ),
                details={"reason": "reserved-name", "value": slug},
            ))

    # Validate selected paths exist and are writable.
    def _check_paths(self) -> None:
        repos = self._request.bootstrap_answers.repositories
        is_new = self._request.creation_origin == "new"

        for index, repo in enumerate(repos):
            repo_root = Path(repo.repo_root)
            field_path = f"bootstrapAnswers.repositories[{index}].repoRoot"
            if is_new:
                parent = repo_root.parent
                if not parent.is_dir() or not os.access(parent, os.W_OK):
                    self._errors.append(PreflightError(
                        code="parent-not-writable",
                        field=field_path,
                        message=(
                            f"Parent of {repo_root} is missing or not writable."
                        ),
                        details={"path": str(repo_root), "parent": str(parent)},
                    ))
            else:
                if not repo_root.is_dir():
                    self._errors.append(PreflightError(
                        code="path-not-found",
                        field=field_path,
                        message=(
                            f"repoRoot does not exist or is not a directory: "
                            f"{repo_root}"
                        ),
                        details={"path": str(repo_root)},
                    ))
                elif not os.access(repo_root, os.R_OK):
                    self._errors.append(PreflightError(
                        code="path-not-readable",
                        field=field_path,
                        message=(
                            f"repoRoot is not readable by the current process: "
                            f"{repo_root}"
                        ),
                        details={"path": str(repo_root)},
                    ))

        # contextPackDir parent must always exist + be writable. The pack dir
        # itself is created by mkdir(recursive=True). For existing-source
        # discovery, the renderer defaults to a sibling `contextpacks/<pack-id>`
        # folder; allow that generated parent to be created when its grandparent
        # is writable.
        ctx_dir = self._request.context_pack_dir
        ctx_parent = ctx_dir.parent
        parent_ready = ctx_parent.is_dir() and os.access(ctx_parent, os.W_OK)
        generated_contextpacks_parent_ready = (
            not ctx_parent.exists()
            and ctx_parent.name == "contextpacks"
            and ctx_parent.parent.is_dir()
            and os.access(ctx_parent.parent, os.W_OK)
        )
        if not parent_ready and not generated_contextpacks_parent_ready:
            self._errors.append(PreflightError(
                code="context-pack-parent-not-writable",
                field="contextPackDir",
                message=(
                    f"Parent of contextPackDir is missing or not writable: "
                    f"{ctx_parent}"
                ),
                details={"path": str(ctx_dir), "parent": str(ctx_parent)},
            ))

        if not is_new:
            for index, repo in enumerate(repos):
                repo_root = Path(repo.repo_root)
                if _is_same_or_within_path(ctx_dir, repo_root):
                    self._errors.append(PreflightError(
                        code="context-pack-dir-inside-repository-root",
                        field="contextPackDir",
                        message=(
                            "contextPackDir must be outside selected repository "
                            "roots for existing-source context packs."
                        ),
                        details={
                            "contextPackDir": str(ctx_dir),
                            "repoRoot": str(repo_root),
                            "repositoryIndex": index,
                        },
                    ))
                    break

    # Detect existing context-pack directories.
    def _check_collision(self) -> None:
        ctx_dir = self._request.context_pack_dir
        if not ctx_dir.exists():
            return
        if not ctx_dir.is_dir():
            self._errors.append(PreflightError(
                code="context-pack-dir-not-empty",
                field="contextPackDir",
                message=(
                    f"contextPackDir exists but is not a directory: {ctx_dir}"
                ),
                details={"path": str(ctx_dir)},
            ))
            return

        pack_indicators = (
            ctx_dir / "qmd" / "repo-sources.json",
            ctx_dir / "qmd" / "bootstrap" / "bootstrap-answers.json",
        )
        existing_pack_files = [str(p) for p in pack_indicators if p.is_file()]

        if existing_pack_files:
            if self._request.confirm_overwrite:
                self._warnings.append(PreflightError(
                    code="pack-overwrite-confirmed",
                    field="contextPackDir",
                    message=(
                        "Existing pack will be overwritten "
                        "(confirmOverwrite=true)."
                    ),
                    details={"existing_files": existing_pack_files},
                ))
            else:
                self._errors.append(PreflightError(
                    code="pack-already-exists",
                    field="contextPackDir",
                    message=(
                        f"A context pack already exists at {ctx_dir}. "
                        "Resubmit with confirmOverwrite=true to overwrite."
                    ),
                    details={"existing_files": existing_pack_files},
                ))
            return

        # Directory exists but no pack indicators — flag if it has any contents
        # so the operator can investigate before we mkdir into it.
        try:
            has_children = any(ctx_dir.iterdir())
        except OSError:
            has_children = False
        if has_children:
            self._warnings.append(PreflightError(
                code="context-pack-dir-not-empty",
                field="contextPackDir",
                message=(
                    f"contextPackDir exists and contains unrelated files: "
                    f"{ctx_dir}"
                ),
                details={"path": str(ctx_dir)},
            ))

    # Reject risky filesystem locations unless explicitly allowed.
    def _check_scary_path(self) -> None:
        ctx_dir_str = str(self._request.context_pack_dir)
        is_scary, reason = _is_scary_path(ctx_dir_str)
        if not is_scary:
            return
        if self._request.allow_scary_path:
            self._warnings.append(PreflightError(
                code="scary-path-confirmed",
                field="contextPackDir",
                message=(
                    f"contextPackDir resolves to a system-critical location "
                    f"({reason}); allowScaryPath=true accepted."
                ),
                details={"path": ctx_dir_str, "reason": reason},
            ))
        else:
            self._errors.append(PreflightError(
                code="scary-path",
                field="contextPackDir",
                message=(
                    f"Refusing to create a context pack at a system-critical "
                    f"location ({reason}). Resubmit with allowScaryPath=true "
                    f"to override."
                ),
                details={"path": ctx_dir_str, "reason": reason},
            ))

    # Validate required local tools.
    def _check_tools(self) -> None:
        actual = (sys.version_info.major, sys.version_info.minor)
        if actual < PYTHON_MIN_VERSION:
            min_str = ".".join(str(v) for v in PYTHON_MIN_VERSION)
            actual_str = f"{actual[0]}.{actual[1]}"
            self._errors.append(PreflightError(
                code="python-version-too-old",
                field=None,
                message=(
                    f"Python {min_str}+ is required; running {actual_str}."
                ),
                details={"minimum": min_str, "actual": actual_str},
            ))

        if self._request.creation_origin != "new":
            return

        git_path = shutil.which("git")
        if git_path is None:
            self._errors.append(PreflightError(
                code="git-unavailable",
                field=None,
                message=(
                    "git was not found on PATH. New-flow creation requires git."
                ),
                details={},
            ))
            return

        try:
            completed = subprocess.run(
                [git_path, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            self._errors.append(PreflightError(
                code="git-broken",
                field=None,
                message=f"git --version failed to launch: {exc}",
                details={"error": str(exc)},
            ))
            return

        if completed.returncode != 0:
            self._errors.append(PreflightError(
                code="git-broken",
                field=None,
                message=(
                    f"git --version exited non-zero ({completed.returncode}): "
                    f"{completed.stderr.strip()}"
                ),
                details={
                    "returncode": completed.returncode,
                    "stderr": completed.stderr.strip(),
                },
            ))


def run_preflight(request: PackPreflightRequest) -> PreflightResult:
    """Convenience wrapper for one-shot preflight evaluation."""
    return PackPreflightValidator(request).run()
