"""QMD-native reward memory writer.

Emits per-agent cumulative reward markdown to
``AgentWorkSpace/qmd/global/agent-rewards/<agent-id>.md`` and patches task
archive markdown with a ``## Reward Received`` managed section.
"""
from __future__ import annotations

from pathlib import Path

from src.backend.scripts.python.lib.io import atomic_write_json
from src.backend.scripts.python.lib.time import current_utc_timestamp

from .models import AgentRewardMemory, SettlementRecord


class QmdRewardWriter:
    """Write reward memory into QMD-native file layout.

    Parameters
    ----------
    repo_root:
        Repository root.  Per-agent files are written under
        ``{repo_root}/AgentWorkSpace/qmd/global/agent-rewards/``.
    """

    def __init__(self, repo_root: Path) -> None:
        self._repo_root = Path(repo_root)
        self._agent_rewards_dir = (
            self._repo_root / "AgentWorkSpace" / "qmd" / "global" / "agent-rewards"
        )

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
        md_path.write_text(
            _render_agent_reward_md(reward),
            encoding="utf-8",
        )
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
    def patch_task_archive_md(
        self,
        archive_md_path: Path,
        settlement: SettlementRecord,
    ) -> None:
        """Add or replace ``## Reward Received`` in a task archive markdown.

        The section is appended if absent, or replaced in place if it
        already exists.
        """
        try:
            content = archive_md_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return
        section = _render_reward_received_section(settlement)
        content = _replace_managed_section(
            content, "## Reward Received", section,
        )
        archive_md_path.write_text(content, encoding="utf-8")


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
