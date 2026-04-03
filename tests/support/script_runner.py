from __future__ import annotations

import os
from pathlib import Path
import subprocess
from typing import Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]


def build_env(
    *,
    env: dict[str, str] | None = None,
    python_path_entries: Sequence[str] = (),
) -> dict[str, str]:
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)

    if python_path_entries:
        existing = merged_env.get("PYTHONPATH", "")
        prefix = os.pathsep.join(python_path_entries)
        merged_env["PYTHONPATH"] = (
            prefix if not existing else f"{prefix}{os.pathsep}{existing}"
        )

    return merged_env


def run_script(
    workspace: Path,
    script_relative_path: str,
    *args: str,
    env: dict[str, str] | None = None,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    if script_relative_path.endswith(".ts"):
        # TypeScript files live in the repo, not the temp workspace.
        # Resolve from the real repo root and run via npx tsx.
        script_path = REPO_ROOT / script_relative_path
        cmd: list[str] = ["npx", "tsx", str(script_path), *args]
    elif script_relative_path.endswith(".py"):
        script_path = workspace / script_relative_path
        cmd = ["python3", str(script_path), *args]
    else:
        script_path = workspace / script_relative_path
        cmd = [str(script_path), *args]
    return subprocess.run(
        cmd,
        cwd=workspace,
        text=True,
        capture_output=True,
        env=build_env(env=env),
        check=check,
    )


def run_bash(
    workspace: Path,
    command: str,
    *,
    env: dict[str, str] | None = None,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-lc", command],
        cwd=workspace,
        text=True,
        capture_output=True,
        env=build_env(env=env),
        check=check,
    )
