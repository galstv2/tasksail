"""Shared reinforcement QMD path helpers."""
from __future__ import annotations

import shutil
from pathlib import Path

MIGRATABLE_STORE_FILES = (
    "task-ledger.json",
    "agent-rewards.json",
    "settlements.json",
    "feedback-events.json",
    "global-realignment-doc.json",
)


def reinforcement_root(repo_root: Path) -> Path:
    """Canonical reinforcement root."""
    return Path(repo_root) / "AgentWorkSpace" / "qmd" / "global" / "reinforcement"


def reinforcement_store_dir(repo_root: Path) -> Path:
    """Canonical structured reinforcement store directory."""
    return reinforcement_root(repo_root) / "store"


def agent_rewards_dir(repo_root: Path) -> Path:
    """Canonical private per-agent reinforcement sidecar directory."""
    return reinforcement_root(repo_root) / "agent-rewards"


def legacy_reinforcement_store_dir(repo_root: Path) -> Path:
    """Legacy structured reinforcement store directory."""
    return Path(repo_root) / "AgentWorkSpace" / "qmd" / "reinforcement"


def legacy_agent_rewards_dir(repo_root: Path) -> Path:
    """Legacy private per-agent reinforcement sidecar directory."""
    return Path(repo_root) / "AgentWorkSpace" / "qmd" / "global" / "agent-rewards"


def store_file(repo_root: Path, *parts: str) -> Path:
    return reinforcement_store_dir(repo_root).joinpath(*parts)


def resolve_store_file_for_read(repo_root: Path, *parts: str) -> Path:
    """Return canonical store file if present, else legacy file for read-only fallback."""
    canonical = store_file(repo_root, *parts)
    if canonical.exists():
        return canonical
    legacy = legacy_reinforcement_store_dir(repo_root).joinpath(*parts)
    if legacy.exists():
        return legacy
    return canonical


def resolve_agent_reward_file_for_read(repo_root: Path, filename: str) -> Path:
    """Return canonical per-agent sidecar if present, else legacy read-only fallback."""
    canonical = agent_rewards_dir(repo_root) / filename
    if canonical.exists():
        return canonical
    legacy = legacy_agent_rewards_dir(repo_root) / filename
    if legacy.exists():
        return legacy
    return canonical


def migrate_legacy_reinforcement_store(repo_root: Path) -> None:
    """Copy legacy structured store data to canonical store without overwrites."""
    canonical = reinforcement_store_dir(repo_root)
    legacy = legacy_reinforcement_store_dir(repo_root)
    if not legacy.is_dir():
        return
    canonical.mkdir(parents=True, exist_ok=True)
    for name in MIGRATABLE_STORE_FILES:
        src = legacy / name
        dest = canonical / name
        if src.is_file() and not dest.exists():
            shutil.copy2(str(src), str(dest))
    legacy_realignment = legacy / "realignment"
    canonical_realignment = canonical / "realignment"
    if legacy_realignment.is_dir() and not canonical_realignment.exists():
        shutil.copytree(
            str(legacy_realignment),
            str(canonical_realignment),
            dirs_exist_ok=True,
        )


def migrate_legacy_agent_reward_sidecars(repo_root: Path) -> None:
    """Copy legacy per-agent sidecars to canonical sidecar dir when canonical is absent."""
    canonical = agent_rewards_dir(repo_root)
    legacy = legacy_agent_rewards_dir(repo_root)
    if _sidecars_have_canonical_data(canonical) or not legacy.is_dir():
        return
    canonical.mkdir(parents=True, exist_ok=True)
    for src in sorted(legacy.iterdir(), key=lambda p: p.name):
        if src.is_file() and src.suffix in {".json", ".md"}:
            shutil.copy2(str(src), str(canonical / src.name))


def _sidecars_have_canonical_data(canonical: Path) -> bool:
    if not canonical.is_dir():
        return False
    return any(
        child.is_file() and child.suffix in {".json", ".md"}
        for child in canonical.iterdir()
    )
