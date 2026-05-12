from __future__ import annotations

import tempfile
from pathlib import Path

from src.backend.mcp.context_estate.workspace_analysis import analyze_workspace_counts


def test_workspace_counts_accept_v2_local_path_objects() -> None:
    with tempfile.TemporaryDirectory() as temp_root:
        repo_root = Path(temp_root) / "orders-api"
        repo_root.mkdir(parents=True)
        (repo_root / ".git").mkdir()
        (repo_root / "services").mkdir()
        (repo_root / "services" / "routes.py").write_text(
            "print('ok')\n",
            encoding="utf-8",
        )

        counts = analyze_workspace_counts(
            {
                "repositories": [
                    {
                        "repo_id": "orders-api",
                        "local_paths": [
                            {
                                "host": str(repo_root.resolve()),
                                "container": None,
                            }
                        ],
                    }
                ]
            }
        )

        assert counts["repo_count"] == 1
        assert counts["folder_count"] >= 1
        assert counts["file_count"] >= 1
