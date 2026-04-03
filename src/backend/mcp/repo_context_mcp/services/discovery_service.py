"""Frontend surface discovery, backend platform detection, and shared
analysis helpers extracted from app.py (slice 01)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..utils import unique_preserving_order

_FRONTEND_CONFIG_FILENAMES = {
    "package.json",
    "angular.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "tailwind.config.js",
    "tailwind.config.ts",
}


def _format_declared_list(values: list[str], fallback: str) -> str:
    return ", ".join(values) if values else fallback


def _collect_declared_values(
    repositories: list[dict[str, Any]],
    field_name: str,
) -> list[str]:
    values: list[str] = []
    for repo in repositories:
        raw_value = repo.get(field_name)
        if isinstance(raw_value, list):
            for item in raw_value:
                cleaned = str(item).strip()
                if cleaned:
                    values.append(cleaned)
            continue
        cleaned = str(raw_value or "").strip()
        if cleaned:
            values.append(cleaned)
    return unique_preserving_order(values)


def _collect_sample_paths(repo: dict[str, Any]) -> list[str]:
    candidate_fields = [
        "source_paths",
        "scan_targets",
        "artifact_samples",
        "document_samples",
    ]
    values: list[str] = []
    for field_name in candidate_fields:
        for item in repo.get(field_name, []) or []:
            cleaned = str(item).strip()
            if cleaned:
                values.append(cleaned)
    return unique_preserving_order(values)


def _find_path_patterns(
    repositories: list[dict[str, Any]],
) -> dict[str, list[str]]:
    top_level_areas: list[str] = []
    test_patterns: list[str] = []
    config_patterns: list[str] = []
    doc_patterns: list[str] = []

    for repo in repositories:
        for source_path in _collect_sample_paths(repo):
            path = Path(source_path)
            if path.parts:
                top_level_areas.append(path.parts[0])

            lowered_parts = {part.lower() for part in path.parts}

            if _is_test_signal_path(source_path):
                test_patterns.append(path.as_posix())

            if path.suffix.lower() in {
                ".yml",
                ".yaml",
                ".json",
                ".toml",
                ".ini",
                ".cfg",
            }:
                config_patterns.append(path.as_posix())

            if path.suffix.lower() == ".md" or "docs" in lowered_parts:
                doc_patterns.append(path.as_posix())

    return {
        "top_level_areas": unique_preserving_order(top_level_areas)[:8],
        "test_patterns": unique_preserving_order(test_patterns)[:6],
        "config_patterns": unique_preserving_order(config_patterns)[:6],
        "doc_patterns": unique_preserving_order(doc_patterns)[:6],
    }


def _is_test_signal_path(source_path: str) -> bool:
    path = Path(source_path)
    lowered_parts = {part.lower() for part in path.parts}
    lowered_name = path.name.lower()
    lowered_path = path.as_posix().lower()
    return (
        "tests" in lowered_parts
        or "test" in lowered_parts
        or lowered_name.startswith("test_")
        or "/__tests__/" in lowered_path
        or lowered_name.endswith("_test.py")
        or lowered_name.endswith(".spec.ts")
        or lowered_name.endswith(".spec.tsx")
    )


def _find_per_repo_test_infrastructure(
    repositories: list[dict[str, Any]],
) -> dict[str, bool]:
    """Return ``{repo_id: has_tests}`` for every repo with an id."""
    result: dict[str, bool] = {}
    for repo in repositories:
        repo_id = str(
            repo.get("repo_id") or repo.get("repo_name") or ""
        ).strip()
        if not repo_id:
            continue
        has_tests = any(
            _is_test_signal_path(p) for p in _collect_sample_paths(repo)
        )
        result[repo_id] = has_tests
    return result


# ---------------------------------------------------------------------------
# Frontend surface discovery
# ---------------------------------------------------------------------------


def _frontend_framework_tags(repo: dict[str, Any]) -> list[str]:
    tags = _collect_declared_values([repo], "tags")
    framework_tags: list[str] = []
    for tag in tags:
        lowered = tag.lower()
        if not lowered.startswith("framework:"):
            continue
        framework = lowered.split(":", 1)[1].strip()
        if framework:
            framework_tags.append(framework)
    return unique_preserving_order(framework_tags)


def _is_frontend_signal_path(path: Path, repo: dict[str, Any]) -> bool:
    lowered_parts = [part.lower() for part in path.parts]
    lowered_name = path.name.lower()
    lowered_path = path.as_posix().lower()
    repo_layer = str(repo.get("system_layer") or "").strip().lower()

    if lowered_name in _FRONTEND_CONFIG_FILENAMES:
        return True

    if path.suffix.lower() in {
        ".tsx",
        ".jsx",
        ".vue",
        ".svelte",
        ".css",
        ".scss",
        ".sass",
        ".less",
        ".html",
    }:
        return True

    if any(
        part in {
            "frontend",
            "web",
            "client",
            "ui",
            "components",
            "component",
            "views",
            "templates",
            "theme",
            "themes",
            "tokens",
            "styles",
            "stories",
            "directives",
        }
        for part in lowered_parts
    ):
        return True

    if any(
        token in lowered_name
        for token in (
            ".controller.",
            ".directive.",
            ".component.",
            ".stories.",
        )
    ):
        return True

    if repo_layer == "frontend" and lowered_parts:
        return lowered_parts[0] not in {"docs", "tests", "test"}

    return "/templates/" in lowered_path or "/components/" in lowered_path


def _infer_frontend_surface_root(path: Path) -> str:
    lowered_parts = [part.lower() for part in path.parts]
    if not lowered_parts:
        return "."

    if len(path.parts) >= 2 and lowered_parts[0] in {"packages", "apps"}:
        return "/".join(path.parts[:2])

    if len(path.parts) >= 3 and lowered_parts[:2] == ["src", "frontend"]:
        if lowered_parts[2] in {
            "components",
            "views",
            "pages",
            "app",
            "lib",
            "shared",
        }:
            return "src/frontend"
        return "/".join(path.parts[:3])

    if lowered_parts[0] in {
        "frontend",
        "web",
        "client",
        "ui",
        "legacy-ui",
        "legacy-app",
        "admin-console",
        "dashboard",
        "portal",
        "console",
    }:
        return path.parts[0]

    if lowered_parts[0] in {"src", "app", "public", "styles"}:
        return "."

    if len(path.parts) >= 2 and lowered_parts[1] in {
        "src",
        "app",
        "components",
        "templates",
        "views",
        "styles",
    }:
        return path.parts[0]

    return "."


def _detect_frontend_surface_frameworks(
    paths: list[str],
    repo_framework_tags: list[str],
) -> list[str]:
    framework_signals: list[str] = []
    for raw_path in paths:
        path = Path(raw_path)
        lowered_name = path.name.lower()
        lowered_path = path.as_posix().lower()
        suffix = path.suffix.lower()

        if suffix in {".tsx", ".jsx"}:
            framework_signals.append("react")
        if suffix == ".vue":
            framework_signals.append("vue")
        if suffix == ".svelte":
            framework_signals.append("svelte")
        if lowered_name.startswith("next.config."):
            framework_signals.extend(["nextjs", "react"])
        if lowered_name == "angular.json" or any(
            lowered_name.endswith(token)
            for token in (
                ".component.ts",
                ".directive.ts",
                ".module.ts",
                ".pipe.ts",
            )
        ):
            framework_signals.append("angular")
        if any(
            token in lowered_name
            for token in (
                ".controller.",
                ".directive.",
                ".factory.",
                ".filter.",
                ".module.",
            )
        ) or "/templates/" in lowered_path or lowered_name.endswith(
            ".tpl.html"
        ):
            framework_signals.append("angularjs")

    if not framework_signals and len(repo_framework_tags) == 1:
        framework_signals.extend(repo_framework_tags)

    return unique_preserving_order(framework_signals)


def _detect_frontend_surface_signal_types(paths: list[str]) -> list[str]:
    signal_types: list[str] = []
    for raw_path in paths:
        lowered_name = Path(raw_path).name.lower()
        lowered_path = raw_path.lower()
        lowered_parts = [part.lower() for part in Path(raw_path).parts]

        if any(
            token in lowered_name
            for token in (
                ".directive.",
                ".controller.",
                ".factory.",
            )
        ) or "directives" in lowered_parts:
            signal_types.append("custom-directive-layer")

        if any(
            part in {"components", "component", "primitives", "ui"}
            for part in lowered_parts
        ):
            signal_types.append("component-or-primitive-layer")

        if any(
            part in {"theme", "themes", "tokens", "styles"}
            for part in lowered_parts
        ) or Path(raw_path).suffix.lower() in {
            ".css",
            ".scss",
            ".sass",
            ".less",
        }:
            signal_types.append("styling-or-theme-layer")

        if "/__tests__/" in lowered_path or lowered_name.endswith(
            (".spec.ts", ".spec.tsx", ".test.ts", ".test.tsx")
        ):
            signal_types.append("ui-test-layer")

        if ".stories." in lowered_name or "stories" in lowered_parts:
            signal_types.append("storybook-or-story-layer")

        if any(part in {"templates", "views"} for part in lowered_parts):
            signal_types.append("template-or-view-layer")

    return unique_preserving_order(signal_types)


def discover_frontend_surfaces(
    repositories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    surfaces: list[dict[str, Any]] = []

    for repo in repositories:
        repo_paths = [
            path for path in _collect_sample_paths(repo)
            if _is_frontend_signal_path(Path(path), repo)
        ]
        if not repo_paths:
            continue

        grouped_paths: dict[str, list[str]] = {}
        for path in repo_paths:
            surface_root = _infer_frontend_surface_root(Path(path))
            grouped_paths.setdefault(surface_root, []).append(path)

        repo_framework_tags = _frontend_framework_tags(repo)
        for surface_root, grouped in sorted(grouped_paths.items()):
            unique_paths = unique_preserving_order(grouped)
            framework_signals = _detect_frontend_surface_frameworks(
                unique_paths,
                repo_framework_tags,
            )
            signal_types = _detect_frontend_surface_signal_types(unique_paths)
            warnings: list[str] = []
            if len(repo_framework_tags) > 1 and not framework_signals:
                warnings.append(
                    "Framework signals are mixed or incomplete for this "
                    "frontend surface."
                )
            elif not framework_signals:
                warnings.append(
                    "No explicit frontend framework signals were identified "
                    "for this bounded surface."
                )

            confidence = "low"
            if framework_signals and signal_types:
                confidence = "high"
            elif framework_signals or len(signal_types) >= 2:
                confidence = "medium"

            surfaces.append(
                {
                    "repo_id": str(
                        repo.get("repo_id")
                        or repo.get("repo_name")
                        or "unknown"
                    ),
                    "repo_name": str(
                        repo.get("repo_name")
                        or repo.get("repo_id")
                        or "unknown"
                    ),
                    "surface_root": surface_root,
                    "framework_signals": framework_signals,
                    "signal_types": signal_types,
                    "confidence": confidence,
                    "source_paths": [
                        path
                        for path in unique_paths
                        if Path(path).suffix.lower() != ".md"
                    ],
                    "config_paths": [
                        path
                        for path in unique_paths
                        if Path(path).name.lower()
                        in _FRONTEND_CONFIG_FILENAMES
                    ],
                    "doc_paths": [
                        path
                        for path in unique_paths
                        if Path(path).suffix.lower() == ".md"
                    ],
                    "warnings": warnings,
                }
            )

    return surfaces


# ---------------------------------------------------------------------------
# UI standards rendering
# ---------------------------------------------------------------------------


def _format_ui_surface_root(surface_root: str) -> str:
    return f"{surface_root}/" if surface_root != "." else "repo-root"


def _format_ui_framework_signal(signal: str) -> str:
    labels = {
        "angularjs": "AngularJS",
        "angular": "Angular",
        "react": "React",
        "vue": "Vue",
        "svelte": "Svelte",
        "nextjs": "Next.js",
    }
    return labels.get(signal, signal)


def _format_ui_signal_type(signal_type: str) -> str:
    labels = {
        "custom-directive-layer": "custom directives or controller helpers",
        "component-or-primitive-layer": (
            "component or primitive layers"
        ),
        "styling-or-theme-layer": "styling, theme, or token layers",
        "ui-test-layer": "UI test colocations",
        "storybook-or-story-layer": "storybook or story surfaces",
        "template-or-view-layer": "template or view layers",
    }
    return labels.get(signal_type, signal_type.replace("-", " "))


def _surface_guidance(surface: dict[str, Any]) -> str:
    signal_types = set(surface.get("signal_types") or [])
    surface_root = _format_ui_surface_root(str(surface.get("surface_root") or "."))
    if "custom-directive-layer" in signal_types:
        return (
            "Project-defined directives, controllers, or template helpers "
            "appear to carry the primary working standard for this surface. "
            f"Prefer those local abstractions over generic framework defaults when changing {surface_root}."
        )
    if "component-or-primitive-layer" in signal_types:
        return (
            "Project-defined components or UI primitives appear to carry the "
            "primary working standard for this surface. Prefer those local "
            f"abstractions when changing {surface_root}."
        )
    if surface.get("framework_signals"):
        return (
            f"Follow the bounded frontend conventions observed within {surface_root} "
            "rather than assuming pack-wide UI rules."
        )
    return (
        f"Frontend evidence exists for {surface_root}, but the framework and local "
        "UI standards remain partial. Stay path-local and avoid importing "
        "unrelated UI conventions into this surface."
    )


def _build_ui_standards_lines(
    repositories: list[dict[str, Any]],
) -> list[str]:
    surfaces = discover_frontend_surfaces(repositories)
    if not surfaces:
        return []

    surface_repo_ids = unique_preserving_order(
        [str(surface.get("repo_id") or "unknown") for surface in surfaces]
    )
    framework_signals = unique_preserving_order(
        [
            _format_ui_framework_signal(signal)
            for surface in surfaces
            for signal in (surface.get("framework_signals") or [])
        ]
    )

    lines = [
        "## UI Standards Signals",
        "",
        (
            f"- Frontend evidence exists in {len(surfaces)} bounded surface(s) "
            f"across {len(surface_repo_ids)} repositor"
            + ("y." if len(surface_repo_ids) == 1 else "ies.")
        ),
        (
            "- UI standards should be followed per surface root rather than "
            "merged across the whole repo."
        ),
    ]

    if framework_signals:
        lines.append(
            "- Observed frontend framework signals: "
            + ", ".join(framework_signals)
            + "."
        )
    lines.append("")

    for surface in surfaces:
        surface_root = _format_ui_surface_root(
            str(surface.get("surface_root") or ".")
        )
        framework_labels = [
            _format_ui_framework_signal(signal)
            for signal in (surface.get("framework_signals") or [])
        ]
        signal_types = [
            _format_ui_signal_type(signal_type)
            for signal_type in (surface.get("signal_types") or [])
        ]
        confidence = str(surface.get("confidence") or "unknown")
        repo_name = str(surface.get("repo_name") or surface.get("repo_id") or "unknown")

        lines.extend(
            [
                f"### Surface: {surface_root}",
                "",
                f"- Repository: {repo_name}.",
                (
                    "- Framework signals: "
                    + _format_declared_list(
                        framework_labels,
                        "frontend surface detected but framework signals are mixed or incomplete",
                    )
                    + "."
                ),
                (
                    "- Organization and local UI-layer signals: "
                    + _format_declared_list(
                        signal_types,
                        "no explicit local UI-layer signals observed",
                    )
                    + "."
                ),
                f"- Confidence: {confidence}.",
                f"- Guidance: {_surface_guidance(surface)}",
            ]
        )

        warnings = [str(warning).strip() for warning in (surface.get("warnings") or []) if str(warning).strip()]
        if warnings:
            lines.append("- Caveats: " + "; ".join(warnings[:3]) + ".")
        lines.append("")

    if len(surfaces) > 1:
        lines.extend(
            [
                "### Cross-Surface Cautions",
                "",
                "- Multiple frontend surfaces coexist in this context pack.",
                (
                    "- Do not assume pack-wide frontend conventions are "
                    "interchangeable across unrelated UI roots."
                ),
                (
                    "- Apply the touched surface's local standards first, "
                    "especially when legacy and modern UI stacks coexist."
                ),
                "",
            ]
        )

    return lines


# ---------------------------------------------------------------------------
# Backend platform detection
# ---------------------------------------------------------------------------


def _detect_backend_platform_signal_types(paths: list[str]) -> list[str]:
    signal_types: list[str] = []
    for raw_path in paths:
        path = Path(raw_path)
        lowered_name = path.name.lower()
        lowered_parts = [part.lower() for part in path.parts]

        if any(
            part in {"middleware", "middlewares", "interceptors", "filters"}
            for part in lowered_parts
        ):
            signal_types.append("middleware-stack")

        if any(
            part in {"controllers", "controller", "routes", "handlers", "api"}
            for part in lowered_parts
        ) or any(
            token in lowered_name
            for token in ("controller", "handler", "router", "route")
        ):
            signal_types.append("api-or-controller-layer")

        if any(
            part in {"registry", "registries", "container", "providers"}
            for part in lowered_parts
        ) or any(
            token in lowered_name for token in ("registry", "container", "provider")
        ):
            signal_types.append("service-registry-or-container")

        if any(
            part in {"repositories", "repository", "dao", "persistence", "store"}
            for part in lowered_parts
        ) or "repository" in lowered_name:
            signal_types.append("repository-or-persistence-layer")

        if any(
            part in {"workers", "worker", "jobs", "job", "queues", "consumers"}
            for part in lowered_parts
        ) or any(
            token in lowered_name for token in ("worker", "job", "queue", "consumer")
        ):
            signal_types.append("worker-or-job-partition")

    return unique_preserving_order(signal_types)


def discover_backend_platform_signals(
    repositories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    backend_signals: list[dict[str, Any]] = []

    for repo in repositories:
        repo_layer = str(repo.get("system_layer") or "").strip().lower()
        if repo_layer not in {"backend", "database", "infrastructure", "shared"}:
            continue

        sample_paths = _collect_sample_paths(repo)
        signal_types = _detect_backend_platform_signal_types(sample_paths)
        if not signal_types:
            continue

        backend_signals.append(
            {
                "repo_id": str(
                    repo.get("repo_id") or repo.get("repo_name") or "unknown"
                ),
                "repo_name": str(
                    repo.get("repo_name") or repo.get("repo_id") or "unknown"
                ),
                "system_layer": repo_layer,
                "signal_types": signal_types,
                "sample_paths": unique_preserving_order(sample_paths)[:6],
            }
        )

    return backend_signals


def _format_backend_signal_type(signal_type: str) -> str:
    labels = {
        "middleware-stack": "middleware stacks",
        "api-or-controller-layer": "API or controller layers",
        "service-registry-or-container": "service registries or containers",
        "repository-or-persistence-layer": (
            "repository or persistence abstractions"
        ),
        "worker-or-job-partition": "worker or job partitions",
    }
    return labels.get(signal_type, signal_type.replace("-", " "))


def _build_backend_signal_lines(
    repositories: list[dict[str, Any]],
) -> list[str]:
    backend_signals = discover_backend_platform_signals(repositories)
    if not backend_signals:
        return []

    lines = [
        "## Backend Platform Signals",
        "",
        (
            f"- Explicit backend platform seams were observed in {len(backend_signals)} "
            "bounded repository summaries."
        ),
        (
            "- These signals are additive and path-bounded; they do not replace "
            "the higher-level architectural summary."
        ),
        "",
    ]

    for signal in backend_signals:
        repo_name = str(signal.get("repo_name") or signal.get("repo_id") or "unknown")
        signal_types = [
            _format_backend_signal_type(item)
            for item in (signal.get("signal_types") or [])
        ]
        sample_paths = [str(item) for item in (signal.get("sample_paths") or [])]
        lines.extend(
            [
                f"### Repository: {repo_name}",
                "",
                (
                    "- Explicit platform seam signals: "
                    + _format_declared_list(
                        signal_types,
                        "no explicit backend platform seams observed",
                    )
                    + "."
                ),
                (
                    "- Example bounded paths: "
                    + _format_declared_list(
                        sample_paths,
                        "no bounded backend paths observed",
                    )
                    + "."
                ),
                (
                    "- Guidance: preserve these local platform seams when "
                    "changing adjacent backend code; do not generalize them into "
                    "broader architectural claims without stronger evidence."
                ),
                "",
            ]
        )

    return lines
