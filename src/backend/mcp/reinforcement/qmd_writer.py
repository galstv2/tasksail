"""QMD-native reward memory writer.

Emits per-agent cumulative reward markdown to
``AgentWorkSpace/qmd/global/reinforcement/agent-rewards/<agent-id>.md`` and patches task
archive markdown with a ``## Reward Received`` managed section.
"""
from __future__ import annotations

from pathlib import Path

from src.backend.scripts.python.lib.io import atomic_write_json, atomic_write_text
from src.backend.scripts.python.lib.locking import acquire_file_lock, release_file_lock
from src.backend.scripts.python.lib.time import current_utc_timestamp

from .models import AgentRewardMemory, SettlementRecord
from .paths import agent_rewards_dir, migrate_legacy_agent_reward_sidecars


class QmdRewardWriter:
    """Write reward memory into QMD-native file layout.

    Parameters
    ----------
    repo_root:
        Repository root.  Per-agent files are written under
        ``{repo_root}/AgentWorkSpace/qmd/global/reinforcement/agent-rewards/``.
    """

    def __init__(self, repo_root: Path) -> None:
        self._repo_root = Path(repo_root)
        migrate_legacy_agent_reward_sidecars(self._repo_root)
        self._agent_rewards_dir = agent_rewards_dir(self._repo_root)

    @property
    def agent_rewards_dir(self) -> Path:
        return self._agent_rewards_dir

    # ------------------------------------------------------------------
    # Per-agent reward memory
    # ------------------------------------------------------------------
    def write_agent_reward(
        self,
        reward: AgentRewardMemory,
        *,
        _dir_exists: bool = False,
    ) -> Path:
        """Emit (replace-in-place) a single agent's reward memory markdown
        and a JSON sidecar with the full structured data."""
        if not _dir_exists:
            self._agent_rewards_dir.mkdir(parents=True, exist_ok=True)
        md_path = self._agent_rewards_dir / f"{reward.agent_id}.md"
        atomic_write_text(md_path, _render_agent_reward_md(reward))
        # Per-agent JSON sidecar — launch-time renderer reads this instead
        # of the shared agent-rewards.json to avoid cross-agent data exposure.
        json_path = self._agent_rewards_dir / f"{reward.agent_id}.json"
        atomic_write_json(json_path, reward.as_dict())
        return md_path

    def write_agent_rewards(
        self,
        rewards: list[AgentRewardMemory],
    ) -> list[Path]:
        """Emit reward memory for multiple agents."""
        self._agent_rewards_dir.mkdir(parents=True, exist_ok=True)
        return [self.write_agent_reward(r, _dir_exists=True) for r in rewards]

    # ------------------------------------------------------------------
    # Task archive patching
    # ------------------------------------------------------------------
    def patch_task_archive_md(  # Archive-index lock: held (precedence 5)
        self,
        archive_md_path: Path,
        settlement: SettlementRecord,
    ) -> None:
        """Add or replace ``## Reward Received`` in a task archive markdown.

        The section is appended if absent, or replaced in place if it
        already exists.

        Lock ordering: archive-index lock (precedence 5) is acquired here.
        No higher-precedence lock (queue, counter) is held by any caller of
        this method — it is invoked post-promotion in file-task-archive.py
        after all queue and counter locks have been released.
        """
        # archive_md_path lives at <scope_dir>/archive/tasks/<year>/<name>.md
        scope_dir = archive_md_path.parents[3]
        index_lock_path = scope_dir / ".indexes.lock"
        lock_fd = acquire_file_lock(index_lock_path)
        try:
            try:
                content = archive_md_path.read_text(encoding="utf-8")
            except FileNotFoundError:
                return
            section = _render_reward_received_section(settlement)
            content = _replace_managed_section(
                content, "## Reward Received", section,
            )
            atomic_write_text(archive_md_path, content)
        finally:
            release_file_lock(lock_fd)


# ── Rendering helpers ────────────────────────────────────────────────────


def _render_agent_reward_md(reward: AgentRewardMemory) -> str:
    """Render a concise per-agent reward memory document."""
    lines = [
        f"# Reward Memory — {reward.agent_id}",
        "",
        f"- Role: {reward.role}",
        f"- Multiplier: {reward.multiplier:.2f}x",
        f"- Lifetime Reward: {reward.lifetime_reward:,}",
        f"- Updated: {current_utc_timestamp()}",
        "",
    ]
    return "\n".join(lines)


def _render_reward_received_section(
    settlement: SettlementRecord,
) -> str:
    """Render the ``## Reward Received`` managed section content."""
    total = sum(settlement.per_agent_rewards.values())
    lines = [
        f"- Settlement: {settlement.settlement_id}",
        f"- Trigger: {settlement.trigger}",
        f"- Settled At: {settlement.settled_at}",
        f"- Aggregate Task Reward: {total:,}",
    ]
    per_agent = sorted(settlement.per_agent_rewards.items())
    for agent_id, amount in per_agent:
        lines.append(f"  - {agent_id}: {amount:,}")
    return "\n".join(lines)


def _replace_managed_section(
    content: str,
    heading: str,
    new_body: str,
) -> str:
    """Replace or append a managed markdown section.

    A managed section starts with *heading* (e.g. ``## Reward Received``)
    and ends at the next ``## `` heading or end-of-file.
    """
    marker = heading + "\n"
    start = content.find(marker)
    if start == -1:
        # Append at end
        if not content.endswith("\n"):
            content += "\n"
        return content + f"\n{heading}\n\n{new_body}\n"
    # Find end of section (next ## heading or EOF)
    body_start = start + len(marker)
    next_heading = content.find("\n## ", body_start)
    if next_heading == -1:
        end = len(content)
    else:
        end = next_heading
    return content[:body_start] + f"\n{new_body}\n" + content[end:]
