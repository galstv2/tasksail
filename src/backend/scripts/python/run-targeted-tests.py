#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from lib.protocol_output import write_protocol_stdout

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MANIFEST_PATH = REPO_ROOT / "tests" / "test_manifest.json"
logger = logging.getLogger(__name__)


class ManifestError(ValueError):
    """Raised when the targeted test manifest or selection is invalid."""


@dataclass(frozen=True)
class PathRule:
    raw_pattern: str
    normalized_pattern: str
    is_prefix: bool
    domains: tuple[str, ...]


@dataclass(frozen=True)
class TargetedTestManifest:
    lanes: dict[str, tuple[str, ...]]
    domains: dict[str, tuple[str, ...]]
    path_rules: tuple[PathRule, ...]


@dataclass(frozen=True)
class SelectionResolution:
    modules: tuple[str, ...]
    changed_path_domains: tuple[str, ...]


def _ordered_unique(values: Iterable[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(values))


def _normalize_relative_path(raw_path: str) -> str:
    normalized = raw_path.replace("\\", "/").strip()
    if not normalized:
        raise ManifestError("Path values must not be empty.")

    parts: list[str] = []
    for part in normalized.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            raise ManifestError(
                f"Path '{raw_path}' escapes the workspace root contract."
            )
        parts.append(part)

    if not parts:
        raise ManifestError("Path values must not normalize to an empty path.")

    return "/".join(parts)


def normalize_changed_path(raw_path: str, *, workspace_root: Path) -> str:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        resolved = candidate.resolve()
        try:
            return resolved.relative_to(workspace_root.resolve()).as_posix()
        except ValueError as exc:
            raise ManifestError(
                "Changed path "
                f"'{raw_path}' is outside workspace root "
                f"'{workspace_root}'."
            ) from exc

    return _normalize_relative_path(raw_path)


def discover_test_modules(workspace_root: Path) -> tuple[str, ...]:
    tests_root = workspace_root / "tests"
    if not tests_root.exists():
        return ()

    modules: list[str] = []
    for test_path in sorted(tests_root.rglob("test_*.py")):
        if "__pycache__" in test_path.parts:
            continue
        relative_path = test_path.relative_to(workspace_root).with_suffix("")
        modules.append(".".join(relative_path.parts))
    return tuple(modules)


def _validate_module_list(
    *,
    section_name: str,
    entry_name: str,
    modules: object,
    available_modules: set[str],
) -> tuple[str, ...]:
    if not isinstance(modules, list) or not modules:
        raise ManifestError(
            f"{section_name} entry '{entry_name}' must be "
            "a non-empty list of test modules."
        )

    normalized_modules: list[str] = []
    for module_name in modules:
        if not isinstance(module_name, str) or not module_name.strip():
            raise ManifestError(
                f"{section_name} entry '{entry_name}' contains "
                "an invalid test module name."
            )
        module_name = module_name.strip()
        if available_modules and module_name not in available_modules:
            raise ManifestError(
                f"{section_name} entry '{entry_name}' references "
                f"unknown test module '{module_name}'."
            )
        normalized_modules.append(module_name)

    return _ordered_unique(normalized_modules)


def load_manifest(
    manifest_path: Path | str = DEFAULT_MANIFEST_PATH,
    *,
    workspace_root: Path = REPO_ROOT,
) -> TargetedTestManifest:
    manifest_file = Path(manifest_path)
    try:
        payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ManifestError(
            f"Manifest file not found: {manifest_file}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(
            f"Manifest file '{manifest_file}' is not valid JSON: {exc.msg}"
        ) from exc

    if not isinstance(payload, dict):
        raise ManifestError("Manifest root must be a JSON object.")

    lanes_payload = payload.get("lanes")
    domains_payload = payload.get("domains")
    path_rules_payload = payload.get("path_rules")

    if not isinstance(lanes_payload, dict) or not lanes_payload:
        raise ManifestError("Manifest must define a non-empty 'lanes' object.")
    if not isinstance(domains_payload, dict) or not domains_payload:
        raise ManifestError(
            "Manifest must define a non-empty 'domains' object."
        )
    if not isinstance(path_rules_payload, dict):
        raise ManifestError("Manifest must define a 'path_rules' object.")

    available_modules = set(discover_test_modules(workspace_root))

    lanes = {
        lane_name: _validate_module_list(
            section_name="Lane",
            entry_name=lane_name,
            modules=modules,
            available_modules=available_modules,
        )
        for lane_name, modules in lanes_payload.items()
    }
    domains = {
        domain_name: _validate_module_list(
            section_name="Domain",
            entry_name=domain_name,
            modules=modules,
            available_modules=available_modules,
        )
        for domain_name, modules in domains_payload.items()
    }

    normalized_rules: list[PathRule] = []
    for raw_pattern, raw_domains in path_rules_payload.items():
        if not isinstance(raw_pattern, str) or not raw_pattern.strip():
            raise ManifestError("Path rule keys must be non-empty strings.")
        if not isinstance(raw_domains, list) or not raw_domains:
            raise ManifestError(
                f"Path rule '{raw_pattern}' must map to "
                "a non-empty list of domains."
            )
        is_prefix = raw_pattern.endswith("/")
        normalized_pattern = _normalize_relative_path(raw_pattern)
        if is_prefix:
            normalized_pattern = f"{normalized_pattern}/"

        domains_for_rule: list[str] = []
        for domain_name in raw_domains:
            if not isinstance(domain_name, str) or not domain_name.strip():
                raise ManifestError(
                    f"Path rule '{raw_pattern}' contains an invalid "
                    "domain name."
                )
            if domain_name not in domains:
                raise ManifestError(
                    f"Path rule '{raw_pattern}' references unknown "
                    f"domain '{domain_name}'."
                )
            domains_for_rule.append(domain_name)

        normalized_rules.append(
            PathRule(
                raw_pattern=raw_pattern,
                normalized_pattern=normalized_pattern,
                is_prefix=is_prefix,
                domains=_ordered_unique(domains_for_rule),
            )
        )

    return TargetedTestManifest(
        lanes=lanes,
        domains=domains,
        path_rules=tuple(normalized_rules),
    )


def infer_domains_from_changed_paths(
    changed_paths: Sequence[str],
    manifest: TargetedTestManifest,
    *,
    workspace_root: Path,
) -> tuple[str, ...]:
    matched_domains: list[str] = []
    for raw_path in changed_paths:
        normalized_path = normalize_changed_path(
            raw_path,
            workspace_root=workspace_root,
        )
        for rule in manifest.path_rules:
            if rule.is_prefix:
                if normalized_path.startswith(rule.normalized_pattern):
                    matched_domains.extend(rule.domains)
            elif normalized_path == rule.normalized_pattern:
                matched_domains.extend(rule.domains)
    return _ordered_unique(matched_domains)


def resolve_modules(
    manifest: TargetedTestManifest,
    *,
    lanes: Sequence[str] = (),
    domains: Sequence[str] = (),
    changed_paths: Sequence[str] = (),
    explicit_modules: Sequence[str] = (),
    workspace_root: Path = REPO_ROOT,
) -> SelectionResolution:
    if not any((lanes, domains, changed_paths, explicit_modules)):
        raise ManifestError(
            "At least one selector is required: --lane, --domain, "
            "--changed-path, or --module."
        )

    resolved_modules: list[str] = []

    for lane_name in lanes:
        if lane_name not in manifest.lanes:
            raise ManifestError(f"Unknown lane '{lane_name}'.")
        resolved_modules.extend(manifest.lanes[lane_name])

    for domain_name in domains:
        if domain_name not in manifest.domains:
            raise ManifestError(f"Unknown domain '{domain_name}'.")
        resolved_modules.extend(manifest.domains[domain_name])

    changed_path_domains = infer_domains_from_changed_paths(
        changed_paths,
        manifest,
        workspace_root=workspace_root,
    )
    for domain_name in changed_path_domains:
        resolved_modules.extend(manifest.domains[domain_name])

    for module_name in explicit_modules:
        if not isinstance(module_name, str) or not module_name.strip():
            raise ManifestError(
                "Explicit module names must be non-empty strings."
            )
        resolved_modules.append(module_name.strip())

    modules = _ordered_unique(resolved_modules)
    if not modules:
        raise ManifestError(
            "No test modules were selected by the provided selectors."
        )

    return SelectionResolution(
        modules=modules,
        changed_path_domains=changed_path_domains,
    )


def run_modules(
    modules: Sequence[str],
    *,
    workspace_root: Path,
    verbosity: int = 2,
) -> int:
    workspace_root_str = str(workspace_root)
    if workspace_root_str not in sys.path:
        sys.path.insert(0, workspace_root_str)

    test_paths: list[str] = []
    for module in modules:
        module_path = workspace_root / Path(*module.split(".")).with_suffix(".py")
        if not module_path.is_file():
            raise ManifestError(
                f"Selected test module '{module}' does not resolve to a file "
                f"under workspace root '{workspace_root}'."
            )
        test_paths.append(str(module_path))

    args = [sys.executable, "-m", "pytest", *test_paths]
    if verbosity <= 1:
        args.append("-q")
    completed = subprocess.run(args, cwd=workspace_root)
    return completed.returncode


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run targeted pytest modules using a manifest of lanes, "
            "domains, and changed-path rules."
        )
    )
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_MANIFEST_PATH),
        help="Path to the targeted test manifest JSON file.",
    )
    parser.add_argument(
        "--workspace-root",
        default=str(REPO_ROOT),
        help=(
            "Workspace root used for module discovery and changed-path "
            "normalization."
        ),
    )
    parser.add_argument(
        "--lane",
        action="append",
        default=[],
        help="Manifest lane name to execute. Can be provided multiple times.",
    )
    parser.add_argument(
        "--domain",
        action="append",
        default=[],
        help=(
            "Manifest domain name to execute. Can be provided multiple "
            "times."
        ),
    )
    parser.add_argument(
        "--changed-path",
        action="append",
        default=[],
        help=(
            "Changed workspace-relative path used to infer domains. Can be "
            "provided multiple times."
        ),
    )
    parser.add_argument(
        "--module",
        action="append",
        default=[],
        help=(
            "Explicit unittest module to execute. Can be provided multiple "
            "times."
        ),
    )
    parser.add_argument(
        "--resolve-only",
        action="store_true",
        help="Resolve selected modules without executing them.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format for resolved module listings.",
    )
    parser.add_argument(
        "--verbosity",
        type=int,
        default=2,
        help="Verbosity level passed to unittest.TextTestRunner.",
    )
    return parser


def emit_resolution(
    resolution: SelectionResolution,
    *,
    output_format: str,
) -> None:
    if output_format == "json":
        write_protocol_stdout(str(json.dumps(
                {
                    "modules": list(resolution.modules),
                    "changed_path_domains": list(
                        resolution.changed_path_domains
                    ),
                },
                indent=2,
            )) + '\n')
        return

    for module_name in resolution.modules:
        write_protocol_stdout(str(module_name) + '\n')


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_argument_parser()
    args = parser.parse_args(argv)

    workspace_root = Path(args.workspace_root).resolve()
    workspace_root_str = str(workspace_root)
    if workspace_root_str not in sys.path:
        sys.path.insert(0, workspace_root_str)
    try:
        from lib.logging_config import configure_logging
    except ModuleNotFoundError:
        configure_logging = None
    if configure_logging is not None:
        configure_logging(stack="py", service="run-targeted-tests")

    try:
        manifest = load_manifest(
            args.manifest,
            workspace_root=workspace_root,
        )
        resolution = resolve_modules(
            manifest,
            lanes=args.lane,
            domains=args.domain,
            changed_paths=args.changed_path,
            explicit_modules=args.module,
            workspace_root=workspace_root,
        )
    except ManifestError as exc:
        logger.error("targeted_tests.selection_failed", extra={"error": str(exc)})
        return 2

    if args.resolve_only:
        emit_resolution(resolution, output_format=args.format)
        return 0

    write_protocol_stdout(str(f"Selected {len(resolution.modules)} test module(s):") + '\n')
    for module_name in resolution.modules:
        write_protocol_stdout(str(f"- {module_name}") + '\n')

    return run_modules(
        resolution.modules,
        workspace_root=workspace_root,
        verbosity=args.verbosity,
    )


if __name__ == "__main__":
    raise SystemExit(main())
