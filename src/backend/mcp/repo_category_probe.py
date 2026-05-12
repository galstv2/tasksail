"""Filesystem probe to classify repositories into one of the 9 repo_category values.

Detection priority chain (highest confidence first):
1. Strong single-signal (infrastructure, data, documentation, application, frontend)
2. Frontend framework signals
3. Service entrypoints
4. Tool vs library disambiguation
5. Fallback → unknown, low

Category values (from ALLOWED_REPO_CATEGORIES):
  service, application, frontend, library, infrastructure, data,
  documentation, tool, unknown
"""
from __future__ import annotations

import json
from pathlib import Path

from src.backend.mcp.pack_constants import WIZARD_ROLE_TO_REPO_CATEGORY

Category = str   # one of ALLOWED_REPO_CATEGORIES
Confidence = str  # "high" | "medium" | "low"


def classify_repo_category(repo_root: Path) -> tuple[Category, Confidence]:
    """Classify a repository root directory into a repo_category.

    Returns a (category, confidence) tuple. category is always one of
    ALLOWED_REPO_CATEGORIES. confidence is "high", "medium", or "low".
    """
    result = _check_strong_single_signal(repo_root)
    if result:
        return result

    result = _check_frontend_frameworks(repo_root)
    if result:
        return result

    result = _check_service_entrypoints(repo_root)
    if result:
        return result

    result = _check_tool_library(repo_root)
    if result:
        return result

    return ("unknown", "low")


def repo_category_for_wizard_role(role: str) -> str | None:
    """Delegate to the pack_constants mapping.

    Returns None for unknown roles so callers can fall through to 'unknown'.
    """
    return WIZARD_ROLE_TO_REPO_CATEGORY.get(role)


# ---------------------------------------------------------------------------
# Detection steps
# ---------------------------------------------------------------------------

def _is_dir(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        return False


def _is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def _glob_any(root: Path, pattern: str) -> bool:
    try:
        return any(True for _ in root.glob(pattern))
    except OSError:
        return False


def _read_text_safe(path: Path, max_bytes: int = 4096) -> str:
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            return f.read(max_bytes)
    except OSError:
        return ""


def _check_strong_single_signal(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Step 1: strong single-signal indicators (high confidence)."""

    # Infrastructure: Terraform directory or .tf files at root
    if _is_dir(root / "terraform"):
        return ("infrastructure", "high")
    if _glob_any(root, "*.tf"):
        return ("infrastructure", "high")

    # Infrastructure: Helm chart (Chart.yaml at root)
    if _is_file(root / "Chart.yaml"):
        return ("infrastructure", "high")

    # Infrastructure: k8s or kubernetes directory
    if _is_dir(root / "k8s") or _is_dir(root / "kubernetes"):
        return ("infrastructure", "high")

    # Data: dbt
    if _is_file(root / "dbt_project.yml"):
        return ("data", "high")

    # Data: Airflow (dags/ directory or airflow_settings.yaml)
    if _is_dir(root / "dags") or _is_file(root / "airflow_settings.yaml"):
        return ("data", "high")

    # Documentation: mkdocs
    if _is_file(root / "mkdocs.yml"):
        return ("documentation", "high")

    # Documentation: Docusaurus
    if _glob_any(root, "docusaurus.config.*"):
        return ("documentation", "high")

    # Application: Tauri
    if _is_file(root / "tauri.conf.json") or _is_dir(root / "src-tauri"):
        return ("application", "high")

    # Application: Electron
    if _is_file(root / "electron-builder.yml") or _is_file(root / "electron-builder.json"):
        return ("application", "high")
    if _glob_any(root, "electron.vite.config.*"):
        return ("application", "high")

    # Application: Flutter
    if _is_file(root / "pubspec.yaml"):
        return ("application", "high")

    # Application: PyInstaller — only count .spec when it looks like a PyInstaller spec
    try:
        spec_paths = list(root.glob("*.spec"))
    except OSError:
        spec_paths = []
    for spec_path in spec_paths:
        content = _read_text_safe(spec_path, 512)
        if "Analysis(" in content or "EXE(" in content:
            return ("application", "high")

    # Frontend: Xcode project or workspace (iOS/macOS UI app)
    try:
        for child in root.iterdir():
            if child.suffix in (".xcodeproj", ".xcworkspace") and _is_dir(child):
                return ("frontend", "high")
    except OSError:
        pass

    return None


def _check_frontend_frameworks(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Step 2: Frontend framework config files (high confidence)."""

    if _glob_any(root, "next.config.*"):
        return ("frontend", "high")
    if _glob_any(root, "nuxt.config.*"):
        return ("frontend", "high")
    if _glob_any(root, "svelte.config.*"):
        return ("frontend", "high")
    if _is_file(root / "angular.json"):
        return ("frontend", "high")

    # Vite with a UI app entry point (not just a library)
    if _glob_any(root, "vite.config.*"):
        has_app_tsx = _is_file(root / "src" / "App.tsx")
        has_app_vue = _is_file(root / "src" / "App.vue")
        has_app_jsx = _is_file(root / "src" / "App.jsx")
        if has_app_tsx or has_app_vue or has_app_jsx:
            return ("frontend", "high")

    return None


def _check_service_entrypoints(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Step 3: Service entrypoint files (medium-high confidence)."""

    # Deployment configs are a strong service signal
    _DEPLOYMENT_FILES = (
        "Dockerfile", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
        "fly.toml", "railway.json", "render.yaml", "Procfile",
    )
    for filename in _DEPLOYMENT_FILES:
        if _is_file(root / filename):
            return ("service", "high")

    # Django manage.py
    if _is_file(root / "manage.py"):
        return ("service", "high")

    # Rack (Ruby)
    if _is_file(root / "config.ru"):
        return ("service", "high")

    # Spring Boot via Maven or Gradle
    if _is_file(root / "pom.xml"):
        content = _read_text_safe(root / "pom.xml")
        if "spring-boot" in content or "springframework.boot" in content:
            return ("service", "high")

    for name in ("build.gradle", "build.gradle.kts"):
        if _is_file(root / name):
            content = _read_text_safe(root / name)
            if "spring-boot" in content or "springframework.boot" in content:
                return ("service", "high")

    # Go: cmd/main.go is a strong service signal
    if _is_file(root / "cmd" / "main.go"):
        return ("service", "high")

    # Go: main.go at root (medium)
    if _is_file(root / "main.go"):
        return ("service", "medium")

    # Rust binary: src/main.rs but NOT src/lib.rs (that would be library)
    if _is_file(root / "src" / "main.rs") and not _is_file(root / "src" / "lib.rs"):
        return ("service", "medium")

    return None


def _check_tool_library(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Step 4: Tool vs library disambiguation (medium confidence)."""

    # Python: pyproject.toml
    pyproject = root / "pyproject.toml"
    if _is_file(pyproject):
        content = _read_text_safe(pyproject)
        has_scripts = (
            "[project.scripts]" in content
            or "[tool.poetry.scripts]" in content
        )
        no_dockerfile = not _is_file(root / "Dockerfile")
        if has_scripts and no_dockerfile:
            return ("tool", "medium")
        return ("library", "medium")

    # Node: package.json with bin key only (no start script) → tool
    pkg = root / "package.json"
    if _is_file(pkg):
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                has_bin = bool(data.get("bin"))
                scripts = data.get("scripts") or {}
                has_start = bool(scripts.get("start"))
                has_main = bool(data.get("main"))
                has_types = bool(data.get("types") or data.get("typings"))
                if has_bin and not has_start:
                    return ("tool", "medium")
                if (has_main or has_types) and not has_start and not has_bin:
                    return ("library", "medium")
        except (json.JSONDecodeError, OSError):
            pass

    # Rust library: Cargo.toml with [lib] but no [[bin]]
    cargo = root / "Cargo.toml"
    if _is_file(cargo):
        content = _read_text_safe(cargo)
        if "[lib]" in content and "[[bin]]" not in content:
            return ("library", "medium")

    # Ruby gem
    if _glob_any(root, "*.gemspec"):
        return ("library", "medium")

    # NuGet package
    if _glob_any(root, "*.nuspec"):
        return ("library", "medium")

    return None
