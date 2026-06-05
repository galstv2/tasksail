"""Reinforcement engine data models and constants."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Schema versions
# ---------------------------------------------------------------------------
SCHEMA_VERSION_TASK_LEDGER = "1.0"
SCHEMA_VERSION_AGENT_REWARDS = "1.0"
SCHEMA_VERSION_SETTLEMENTS = "1.0"
SCHEMA_VERSION_FEEDBACK_EVENTS = "1.0"
SCHEMA_VERSION_REALIGNMENT_SESSIONS = "1.0"
SCHEMA_VERSION_GLOBAL_REALIGNMENT_DOC = "1.0"

# ---------------------------------------------------------------------------
# Difficulty → base reward
# ---------------------------------------------------------------------------
DIFFICULTY_REWARDS: dict[str, int] = {
    "easy": 1000,
    "medium": 2000,
    "hard": 3000,
}

def _load_agent_roles() -> dict[str, str]:
    """Load agent roles from registry.json (single source of truth)."""
    from src.backend.scripts.python.lib.registry import agent_roles
    return agent_roles()


AGENT_ROLES: dict[str, str] = _load_agent_roles()


def _load_agent_reward_multipliers() -> dict[str, float]:
    """Load reward multipliers from registry.json (single source of truth)."""
    from src.backend.scripts.python.lib.registry import agent_reward_multipliers
    return agent_reward_multipliers()


AGENT_REWARD_MULTIPLIERS: dict[str, float] = _load_agent_reward_multipliers()

# Settlement constants
SETTLEMENT_STREAK_THRESHOLD = 10
CHILD_TASK_MULTIPLIER = 0.5


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class TaskLedgerEntry:
    task_id: str
    parent_task_id: str
    is_child: bool
    difficulty: str
    base_reward: int
    effective_reward: int
    settlement_status: str  # "unrewarded" | "rewarded"
    quality_outcome: str  # "success" | "error"
    feedback_id: str
    settlement_id: str
    realignment_id: str
    created_at: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskLedgerEntry:
        return cls(**{k: data[k] for k in cls.__slots__})


@dataclass(slots=True)
class AgentRewardMemory:
    agent_id: str
    role: str
    multiplier: float
    lifetime_reward: int
    unrewarded_task_count: int
    unrewarded_reward_total: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentRewardMemory:
        return cls(**{k: data[k] for k in cls.__slots__})


@dataclass(slots=True)
class SettlementRecord:
    settlement_id: str
    trigger: str  # "streak" | "five_star"
    tasks_included: list[str]
    per_agent_rewards: dict[str, int]
    settled_at: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SettlementRecord:
        return cls(
            settlement_id=data["settlement_id"],
            trigger=data["trigger"],
            tasks_included=list(data["tasks_included"]),
            per_agent_rewards=dict(data["per_agent_rewards"]),
            settled_at=data["settled_at"],
        )


@dataclass(slots=True)
class FeedbackEvent:
    feedback_id: str
    task_id: str
    feedback_type: str  # "none" | "positive" | "negative"
    star_rating: int | None
    comment: str
    created_at: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FeedbackEvent:
        return cls(**{k: data[k] for k in cls.__slots__})


@dataclass(slots=True)
class RealignmentSession:
    realignment_id: str
    trigger_task_id: str
    trigger_feedback_id: str
    participating_agents: list[str]
    failure_analysis: str
    root_cause: str
    corrective_actions: list[str]
    status: str  # "open" | "reviewed" | "archived" | "error"
    meeting_notes: str
    created_at: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RealignmentSession:
        return cls(
            realignment_id=data["realignment_id"],
            trigger_task_id=data["trigger_task_id"],
            trigger_feedback_id=data["trigger_feedback_id"],
            participating_agents=list(data["participating_agents"]),
            failure_analysis=data["failure_analysis"],
            root_cause=data["root_cause"],
            corrective_actions=list(data["corrective_actions"]),
            status=data["status"],
            meeting_notes=data["meeting_notes"],
            created_at=data["created_at"],
        )


@dataclass(slots=True)
class GlobalRealignmentDocument:
    standing_expectations: list[str] = field(default_factory=list)
    lessons_learned: list[str] = field(default_factory=list)
    behavioral_guidance: list[str] = field(default_factory=list)
    fairness_framing: list[str] = field(default_factory=list)
    version: int = 0
    updated_at: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GlobalRealignmentDocument:
        return cls(
            standing_expectations=list(data.get("standing_expectations", [])),
            lessons_learned=list(data.get("lessons_learned", [])),
            behavioral_guidance=list(data.get("behavioral_guidance", [])),
            fairness_framing=list(data.get("fairness_framing", [])),
            version=data.get("version", 0),
            updated_at=data.get("updated_at", ""),
        )
