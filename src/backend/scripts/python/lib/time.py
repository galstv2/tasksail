"""Time and timestamp helpers shared across platform scripts."""
from __future__ import annotations

from datetime import datetime, timezone


def current_utc_timestamp() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso8601_utc(value: str) -> datetime | None:
    """Parse an ISO-8601 UTC timestamp, returning ``None`` on failure."""
    text = value.strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(
            text.replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except ValueError:
        return None


def compute_runtime_age_seconds(
    last_updated_at: str,
    *,
    now: datetime | None = None,
) -> int | None:
    """Seconds elapsed since *last_updated_at*.  Returns ``None`` when
    the timestamp cannot be parsed.
    """
    updated_at = parse_iso8601_utc(last_updated_at)
    if updated_at is None:
        return None
    current_time = now or datetime.now(timezone.utc)
    return max(0, int((current_time - updated_at).total_seconds()))
