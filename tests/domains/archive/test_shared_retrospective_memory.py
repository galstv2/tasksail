"""Shared retrospective memory synthesis tests."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
SCRIPTS_PYTHON = REPO_ROOT / "src" / "backend" / "scripts" / "python"
if str(SCRIPTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PYTHON))

from lib.archive.shared_memory import build_shared_retrospective_memory


def _write_history_record(
    repo_root: Path,
    ordinal: int,
    *,
    task_id: str | None = None,
    template_noise: bool = False,
) -> None:
    task_id = task_id or f"TASK-{ordinal:02d}"
    year = "2026"
    history_dir = (
        repo_root
        / "AgentWorkSpace"
        / "qmd"
        / "global"
        / "retrospectives"
        / "history"
        / year
    )
    history_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "record_type": "global-retrospective-entry",
        "task_id": task_id,
        "task_title": f"Task {ordinal}",
        "indexed_at": f"2026-01-{ordinal:02d}T00:00:00Z",
        "what_went_well": [f"Stable validation pattern {ordinal}."],
        "what_could_have_gone_better": [f"Validation setup gap {ordinal}."],
        "action_items": [f"Tighten validation setup {ordinal}."],
        "reusable_team_learnings": [f"Keep validation commands portable {ordinal}."],
        "anti_patterns": [f"Do not rely on hidden environment state {ordinal}."],
    }
    if template_noise:
        payload["what_went_well"].append(
            "<!-- CYCLE-LEVEL SECTION. Populate ONLY when Retrospective Required is true. -->"
        )
        payload["anti_patterns"].append(
            "Retrospective Required is false. Leave this section completely empty."
        )
    record_path = history_dir / f"task-{ordinal:02d}.md.record.json"
    record_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def test_shared_memory_uses_latest_ten_records_and_stays_concise(
    tmp_path: Path,
) -> None:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    for ordinal in range(1, 13):
        _write_history_record(
            repo_root,
            ordinal,
            template_noise=ordinal in (11, 12),
        )

    markdown, payload, _markdown_path, _record_path = (
        build_shared_retrospective_memory(repo_root)
    )

    assert payload["memory_policy_version"] == "rolling-last-10-global-tasks/v2"
    assert payload["rolling_window_size"] == 10
    assert payload["synthesized_from_task_ids"] == [
        f"TASK-{ordinal:02d}" for ordinal in range(3, 13)
    ]
    assert "TASK-01" not in payload["synthesized_from_task_ids"]
    assert "## Contributing Tasks" not in markdown
    assert "## Audit Trail" not in markdown
    assert "(seen in " not in markdown
    assert "CYCLE-LEVEL SECTION" not in markdown
    assert "Retrospective Required" not in markdown
    assert "Task IDs are stored in the sidecar record" in markdown


def test_shared_memory_preserves_existing_between_ten_task_boundaries(
    tmp_path: Path,
) -> None:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    for ordinal in range(1, 12):
        _write_history_record(repo_root, ordinal)

    markdown_path = (
        repo_root
        / "AgentWorkSpace"
        / "qmd"
        / "global"
        / "retrospectives"
        / "shared-retrospective-memory.md"
    )
    record_path = markdown_path.with_name(
        "shared-retrospective-memory.md.record.json"
    )
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("# Existing Memory\n", encoding="utf-8")
    record_path.write_text(
        json.dumps(
            {
                "record_type": "global-retrospective-memory",
                "memory_policy_version": "rolling-last-10-global-tasks/v2",
                "synthesized_from_task_ids": ["TASK-01"],
            }
        ),
        encoding="utf-8",
    )

    markdown, payload, _markdown_path, _record_path = (
        build_shared_retrospective_memory(repo_root)
    )

    assert markdown == "# Existing Memory\n"
    assert payload["synthesized_from_task_ids"] == ["TASK-01"]


def test_shared_memory_regenerates_existing_memory_on_ten_task_boundary(
    tmp_path: Path,
) -> None:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    for ordinal in range(1, 21):
        _write_history_record(repo_root, ordinal)

    markdown_path = (
        repo_root
        / "AgentWorkSpace"
        / "qmd"
        / "global"
        / "retrospectives"
        / "shared-retrospective-memory.md"
    )
    record_path = markdown_path.with_name(
        "shared-retrospective-memory.md.record.json"
    )
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("# Existing Memory\n", encoding="utf-8")
    record_path.write_text(
        json.dumps(
            {
                "record_type": "global-retrospective-memory",
                "memory_policy_version": "rolling-last-10-global-tasks/v2",
                "synthesized_from_task_ids": ["TASK-01"],
            }
        ),
        encoding="utf-8",
    )

    markdown, payload, _markdown_path, _record_path = (
        build_shared_retrospective_memory(repo_root)
    )

    assert markdown != "# Existing Memory\n"
    assert payload["synthesized_from_task_ids"] == [
        f"TASK-{ordinal:02d}" for ordinal in range(11, 21)
    ]
