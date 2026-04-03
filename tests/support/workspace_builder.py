from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]


def ensure_directories(workspace: Path, relative_dirs: Iterable[str]) -> None:
    for relative_dir in relative_dirs:
        (workspace / relative_dir).mkdir(parents=True, exist_ok=True)


def copy_repo_files(
    workspace: Path,
    relative_paths: Iterable[str],
) -> None:
    for relative_path in relative_paths:
        source = REPO_ROOT / relative_path
        target = workspace / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if target.suffix == ".sh":
            target.chmod(0o755)


def copy_repo_tree(
    workspace: Path,
    relative_path: str,
    *,
    destination_relative_path: str | None = None,
) -> Path:
    source = REPO_ROOT / relative_path
    destination = workspace / (destination_relative_path or relative_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, dirs_exist_ok=True)
    return destination


def symlink_repo_tree(
    workspace: Path,
    relative_path: str,
) -> Path:
    """Symlink a repo subtree into the workspace instead of deep-copying.

    This is drastically faster than copytree for large trees (e.g. src/ at
    ~900 MB / 13 k files) that tests only read, never modify.
    """
    source = REPO_ROOT / relative_path
    destination = workspace / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.symlink_to(source)
    return destination


def seed_handoffs_from_templates(workspace: Path) -> None:
    """Copy canonical templates into the handoffs directory."""
    templates_dir = workspace / "AgentWorkSpace" / "templates"
    handoffs_dir = workspace / "AgentWorkSpace" / "handoffs"
    handoffs_dir.mkdir(parents=True, exist_ok=True)
    for entry in templates_dir.iterdir():
        if entry.name == "slice-template.md":
            continue
        shutil.copy2(entry, handoffs_dir / entry.name)


def populate_workspace(
    workspace: Path,
    *,
    relative_dirs: Iterable[str] = (),
    relative_files: Iterable[str] = (),
    tree_paths: Iterable[str] = (),
    symlink_paths: Iterable[str] = (),
) -> Path:
    ensure_directories(workspace, relative_dirs)
    copy_repo_files(workspace, relative_files)
    for tree_path in tree_paths:
        copy_repo_tree(workspace, tree_path)
    for symlink_path in symlink_paths:
        symlink_repo_tree(workspace, symlink_path)
    return workspace


def prepare_workspace(
    test_case: object | None,
    *,
    relative_dirs: Iterable[str] = (),
    relative_files: Iterable[str] = (),
    tree_paths: Iterable[str] = (),
    symlink_paths: Iterable[str] = (),
    root_name: str | None = None,
) -> Path:
    temp_root = Path(tempfile.mkdtemp())
    if test_case is not None and hasattr(test_case, "addCleanup"):
        getattr(test_case, "addCleanup")(
            lambda: shutil.rmtree(temp_root, ignore_errors=True)
        )

    workspace = temp_root / root_name if root_name else temp_root
    workspace.mkdir(parents=True, exist_ok=True)

    return populate_workspace(
        workspace,
        relative_dirs=relative_dirs,
        relative_files=relative_files,
        tree_paths=tree_paths,
        symlink_paths=symlink_paths,
    )
