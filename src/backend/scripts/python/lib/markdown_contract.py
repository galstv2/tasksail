"""Shared markdown contract loader."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Mapping, Pattern

REQUIRED_SECTION_NAMES = (
    "TASK_LINEAGE",
    "TASK_METADATA",
    "CONTEXT_PACK_BINDING",
    "REVIEW_OUTCOME",
    "DECISION",
    "DIFFICULTY_LEVEL",
    "RECOMMENDED_EXECUTION",
    "CLOSEOUT_OWNER_AGENT_ID",
    "RETROSPECTIVE_REQUIRED",
)
REQUIRED_GROUPS = (
    "headingName",
    "labelName",
    "labelValue",
    "title",
    "fenceMarker",
    "fenceLanguage",
)


@dataclass(frozen=True)
class CompiledMarkdownContract:
    heading: Pattern[str]
    label: Pattern[str]
    title: Pattern[str]
    fence_open: Pattern[str]


@dataclass(frozen=True)
class MarkdownContract:
    version: int
    heading_regex: str
    label_regex: str
    title_regex: str
    fence_open_regex: str
    groups: Mapping[str, int]
    strip_html_comments: bool
    warn_on_duplicate_label: bool
    opaque_fences: bool
    section_names: Mapping[str, str]
    compiled: CompiledMarkdownContract


def default_markdown_contract_path() -> Path:
    return Path(__file__).resolve().parents[5] / "config" / "markdown-contract.default.json"


@lru_cache(maxsize=8)
def load_markdown_contract(contract_path: str | Path | None = None) -> MarkdownContract:
    path = Path(contract_path) if contract_path is not None else default_markdown_contract_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - validation reports path and parser message
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"{path}: invalid <root>")
    _require(data.get("version") == 1, path, "version")
    heading_regex = _string(data.get("headingRegex"), path, "headingRegex")
    label_regex = _string(data.get("labelRegex"), path, "labelRegex")
    title_regex = _string(data.get("titleRegex"), path, "titleRegex")
    fence_open_regex = _string(data.get("fenceOpenRegex"), path, "fenceOpenRegex")
    raw_groups = _mapping(data.get("groups"), path, "groups")
    groups = MappingProxyType({
        key: _positive_int(raw_groups.get(key), path, f"groups.{key}")
        for key in REQUIRED_GROUPS
    })
    raw_names = _mapping(data.get("sectionNames"), path, "sectionNames")
    section_names = MappingProxyType({
        key: _string(raw_names.get(key), path, f"sectionNames.{key}")
        for key in REQUIRED_SECTION_NAMES
    })
    compiled = CompiledMarkdownContract(
        heading=_compile(heading_regex, path, "headingRegex"),
        label=_compile(label_regex, path, "labelRegex"),
        title=_compile(title_regex, path, "titleRegex"),
        fence_open=_compile(fence_open_regex, path, "fenceOpenRegex"),
    )
    _smoke(path, compiled, groups)
    return MarkdownContract(
        version=1,
        heading_regex=heading_regex,
        label_regex=label_regex,
        title_regex=title_regex,
        fence_open_regex=fence_open_regex,
        groups=groups,
        strip_html_comments=data.get("stripHtmlComments") is True,
        warn_on_duplicate_label=data.get("warnOnDuplicateLabel") is True,
        opaque_fences=data.get("opaqueFences") is True,
        section_names=section_names,
        compiled=compiled,
    )


def validate_markdown_contract(contract_path: str | Path | None = None) -> None:
    load_markdown_contract(contract_path)


def _mapping(value: object, path: Path, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{path}: invalid {field}")
    return value


def _string(value: object, path: Path, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{path}: invalid {field}")
    return value


def _positive_int(value: object, path: Path, field: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"{path}: invalid {field}")
    return value


def _require(condition: bool, path: Path, field: str) -> None:
    if not condition:
        raise ValueError(f"{path}: invalid {field}")


def _compile(source: str, path: Path, field: str) -> Pattern[str]:
    try:
        return re.compile(source)
    except re.error as exc:
        raise ValueError(f"{path}: invalid {field}: {exc}") from exc


def _smoke(path: Path, compiled: CompiledMarkdownContract, groups: Mapping[str, int]) -> None:
    if compiled.heading.match("##\tTask Lineage ##").group(groups["headingName"]) != "Task Lineage":
        raise ValueError(f"{path}: invalid headingRegex embedded smoke fixture")
    label = compiled.label.match("- Difficulty Level: Hard <!-- bumped -->")
    if label is None or label.group(groups["labelName"]) != "Difficulty Level" or label.group(groups["labelValue"]) != "Hard <!-- bumped -->":
        raise ValueError(f"{path}: invalid labelRegex embedded smoke fixture")
    if compiled.title.match("# Task Title ##").group(groups["title"]) != "Task Title":
        raise ValueError(f"{path}: invalid titleRegex embedded smoke fixture")
    fence = compiled.fence_open.match("```bash ")
    if fence is None or fence.group(groups["fenceMarker"]) != "```" or fence.group(groups["fenceLanguage"]) != "bash":
        raise ValueError(f"{path}: invalid fenceOpenRegex embedded smoke fixture")
