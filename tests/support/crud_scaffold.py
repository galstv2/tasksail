"""Scaffold for a minimal CRUD app used by the live E2E pipeline test.

Creates a self-contained Python project in a temp directory with an
in-memory CRUD store and passing tests.  Agents are tasked with adding
a ``search(field, value)`` method and corresponding test coverage.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

CRUD_STORE_SOURCE = '''\
"""In-memory CRUD store for the live-test project."""
from __future__ import annotations


class Store:
    """Dictionary-backed item store with auto-incrementing IDs."""

    def __init__(self) -> None:
        self._items: dict[int, dict] = {}
        self._next_id = 1

    def create(self, data: dict) -> dict:
        """Insert a new item and return it with its assigned ``id``."""
        item_id = self._next_id
        self._next_id += 1
        item = {"id": item_id, **data}
        self._items[item_id] = item
        return item

    def get(self, item_id: int) -> dict | None:
        """Return the item with *item_id*, or ``None``."""
        return self._items.get(item_id)

    def list_all(self) -> list[dict]:
        """Return every item in insertion order."""
        return list(self._items.values())

    def update(self, item_id: int, data: dict) -> dict | None:
        """Merge *data* into an existing item.  Returns ``None`` if missing."""
        if item_id not in self._items:
            return None
        self._items[item_id].update(data)
        self._items[item_id]["id"] = item_id
        return self._items[item_id]

    def delete(self, item_id: int) -> bool:
        """Remove an item.  Returns ``True`` if it existed."""
        return self._items.pop(item_id, None) is not None
'''

CRUD_TEST_SOURCE = '''\
"""Tests for the CRUD store."""
from __future__ import annotations

import pytest
from crud import Store


@pytest.fixture
def store() -> Store:
    s = Store()
    s.create({"name": "Alice", "role": "engineer"})
    s.create({"name": "Bob", "role": "designer"})
    s.create({"name": "Carol", "role": "engineer"})
    return s


def test_create(store: Store) -> None:
    item = store.create({"name": "Dave", "role": "manager"})
    assert item["id"] == 4
    assert item["name"] == "Dave"


def test_get(store: Store) -> None:
    assert store.get(1) is not None
    assert store.get(1)["name"] == "Alice"
    assert store.get(99) is None


def test_list_all(store: Store) -> None:
    assert len(store.list_all()) == 3


def test_update(store: Store) -> None:
    updated = store.update(1, {"name": "Alice V2"})
    assert updated is not None
    assert updated["name"] == "Alice V2"
    assert updated["id"] == 1
    assert store.update(99, {"name": "X"}) is None


def test_delete(store: Store) -> None:
    assert store.delete(1) is True
    assert store.delete(1) is False
    assert len(store.list_all()) == 2
'''


def create_crud_scaffold(parent_dir: Path) -> Path:
    """Write the CRUD app files into *parent_dir*/crud-app and return the path.

    Initializes a git repo with an initial commit so that ``git diff HEAD``
    can capture changes made by agents during the pipeline.
    """
    app_dir = parent_dir / "crud-app"
    app_dir.mkdir(parents=True, exist_ok=True)
    (app_dir / ".gitignore").write_text(
        "\n".join([
            "__pycache__/",
            "*.py[cod]",
            "*$py.class",
            "*.so",
            ".pytest_cache/",
            "*.egg-info/",
            "dist/",
            "build/",
            ".eggs/",
            "*.egg",
            ".env",
            ".venv/",
            "venv/",
            "htmlcov/",
            ".coverage",
            ".mypy_cache/",
            ".ruff_cache/",
            "",
        ]),
        encoding="utf-8",
    )
    (app_dir / "crud.py").write_text(CRUD_STORE_SOURCE, encoding="utf-8")
    (app_dir / "test_crud.py").write_text(CRUD_TEST_SOURCE, encoding="utf-8")
    # Initialize git so QA's code-changes.diff can capture agent modifications.
    subprocess.run(
        ["git", "init"], cwd=app_dir,
        capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "add", "."], cwd=app_dir,
        capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Initial CRUD scaffold"],
        cwd=app_dir, capture_output=True, check=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@test",
             "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@test"},
    )
    return app_dir


def create_context_pack_with_crud(
    base_dir: Path,
    repo_root: Path,
) -> tuple[Path, Path]:
    """Create a context pack containing the platform repo and a CRUD app.

    Returns ``(context_pack_dir, crud_app_dir)``.
    """
    pack_dir = base_dir / "live-test-context-pack"
    crud_dir = create_crud_scaffold(pack_dir)

    (pack_dir / "qmd").mkdir(parents=True, exist_ok=True)
    manifest = {
        "manifest_version": "qmd-repo-sources/v1",
        "manifest_status": "approved",
        "context_pack_id": "live-test",
        "display_name": "Live Test Pack",
        "estate_type": "distributed-platform",
        "qmd_scope_root": "qmd/context-packs/live-test",
        "default_scope_mode": "focused",
        "primary_working_repo_ids": ["crud-app"],
        "repositories": [
            {
                "repo_id": "platform",
                "repo_name": "tasksail",
                "local_paths": [str(repo_root)],
                "system_layer": "backend",
            },
            {
                "repo_id": "crud-app",
                "repo_name": "Live Test CRUD App",
                "local_paths": [str(crud_dir)],
                "system_layer": "backend",
                "default_focusable": True,
                "activation_priority": 100,
            },
        ],
    }
    (pack_dir / "qmd" / "repo-sources.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8",
    )
    return pack_dir, crud_dir
