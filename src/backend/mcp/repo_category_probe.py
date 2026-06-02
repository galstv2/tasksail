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
from typing import Any

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


def _rglob_any(root: Path, pattern: str) -> bool:
    try:
        return any(True for _ in root.rglob(pattern))
    except OSError:
        return False


def _read_text_safe(path: Path, max_bytes: int = 4096) -> str:
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            return f.read(max_bytes)
    except OSError:
        return ""


def _read_json_object(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if isinstance(data, dict):
        return data
    return None


def _iter_files(root: Path, patterns: tuple[str, ...], *, limit: int = 20) -> list[Path]:
    paths: list[Path] = []
    for pattern in patterns:
        try:
            for path in root.glob(pattern):
                if path.is_file():
                    paths.append(path)
                    if len(paths) >= limit:
                        return paths
        except OSError:
            continue
    return paths


def _has_ansible_role_structure(root: Path) -> bool:
    return (
        _glob_any(root, "roles/*/tasks/main.yml")
        or _glob_any(root, "roles/*/tasks/main.yaml")
        or _glob_any(root, "roles/*/meta/main.yml")
        or _glob_any(root, "roles/*/meta/main.yaml")
    )


def _check_infrastructure_markers(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Recognize IaC repositories from explicit tool files, not CI alone."""
    if _glob_any(root, "Pulumi.yaml") or _glob_any(root, "Pulumi.yml"):
        return ("infrastructure", "high")
    if _is_file(root / "cdk.json"):
        return ("infrastructure", "high")
    if _is_file(root / "serverless.yml") or _is_file(root / "serverless.yaml"):
        return ("infrastructure", "high")
    if _is_file(root / "samconfig.toml"):
        return ("infrastructure", "high")

    for template in _iter_files(root, ("template.yml", "template.yaml", "*.cfn.yml", "*.cfn.yaml")):
        content = _read_text_safe(template)
        if (
            "AWSTemplateFormatVersion" in content
            or "AWS::Serverless" in content
            or "AWS::CloudFormation" in content
        ):
            return ("infrastructure", "high")

    if _is_file(root / "ansible.cfg") or _has_ansible_role_structure(root):
        return ("infrastructure", "medium")
    for playbook in _iter_files(root, ("playbook.yml", "playbook.yaml", "site.yml", "site.yaml")):
        content = _read_text_safe(playbook)
        if "hosts:" in content and "tasks:" in content:
            return ("infrastructure", "medium")

    return None


def _check_database_markers(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Recognize repositories whose primary artifact is schema or migrations."""
    if _is_file(root / "schema.sql"):
        return ("data", "high")
    if _is_file(root / "prisma" / "schema.prisma") or _is_file(root / "schema.prisma"):
        return ("data", "high")
    if _is_file(root / "flyway.conf") or _is_dir(root / "sql" / "migrations"):
        return ("data", "high")
    if _is_file(root / "liquibase.properties") or _rglob_any(root, "*changelog*.xml"):
        return ("data", "high")
    if _is_file(root / "alembic.ini") or _is_file(root / "alembic" / "env.py"):
        return ("data", "high")

    migration_patterns = (
        "migrations/*.sql",
        "db/migrations/*.sql",
        "db/migrate/*.sql",
        "database/migrations/*.sql",
        "sql/migrations/*.sql",
        "flyway/sql/*.sql",
    )
    if _iter_files(root, migration_patterns, limit=1):
        return ("data", "high")

    for migration in _iter_files(root, ("Migrations/*.cs", "*/Migrations/*.cs")):
        content = _read_text_safe(migration)
        if "MigrationBuilder" in content or ": Migration" in content:
            return ("data", "medium")

    return None


def _dotnet_project_files(root: Path) -> list[Path]:
    return _iter_files(root, ("*.csproj", "*/*.csproj", "*/*/*.csproj"), limit=10)


def _check_dotnet_test_project(root: Path) -> bool:
    if root.name.endswith(".Tests") or root.name.endswith(".Test"):
        return True
    for csproj in _dotnet_project_files(root):
        content = _read_text_safe(csproj)
        name = csproj.stem.lower()
        if name.endswith(".tests") or name.endswith(".test"):
            return True
        if (
            "Microsoft.NET.Test.Sdk" in content
            or "xunit" in content.lower()
            or "nunit" in content.lower()
            or "MSTest.TestFramework" in content
        ):
            return True
    return False


def _check_dotnet_service(root: Path) -> tuple[Category, Confidence] | None:
    for csproj in _dotnet_project_files(root):
        content = _read_text_safe(csproj)
        if "Microsoft.NET.Sdk.Web" in content or "Microsoft.NET.Sdk.Worker" in content:
            return ("service", "high")

    program_files = _iter_files(root, ("Program.cs", "*/Program.cs", "*/*/Program.cs"), limit=5)
    for program in program_files:
        content = _read_text_safe(program)
        if (
            "WebApplication.CreateBuilder" in content
            or "WebApplication.Create" in content
            or "MapControllers" in content
            or "MapGet" in content
            or "UseKestrel" in content
            or "BackgroundService" in content
        ):
            return ("service", "medium")

    return None


def _check_dotnet_package(root: Path) -> bool:
    for csproj in _dotnet_project_files(root):
        content = _read_text_safe(csproj)
        if "<OutputType>Exe</OutputType>" in content:
            continue
        if (
            "<PackageId>" in content
            or "<GeneratePackageOnBuild>true</GeneratePackageOnBuild>" in content
            or "Microsoft.NET.Sdk.Razor" in content
        ):
            return True
        if "<OutputType>Library</OutputType>" in content:
            return True
    return False


def _check_node_service(root: Path) -> tuple[Category, Confidence] | None:
    data = _read_json_object(root / "package.json")
    if not data:
        return None

    scripts = data.get("scripts") or {}
    dependencies = {}
    for key in ("dependencies", "devDependencies"):
        value = data.get(key)
        if isinstance(value, dict):
            dependencies.update(value)

    framework_names = {"express", "fastify", "koa", "hono", "@nestjs/core"}
    if any(name in dependencies for name in framework_names):
        return ("service", "high")
    if isinstance(scripts, dict) and any(
        scripts.get(name) for name in ("start", "serve")
    ):
        return ("service", "medium")
    return None


def _check_python_service(root: Path) -> tuple[Category, Confidence] | None:
    for filename in ("app.py", "server.py", "main.py"):
        if _is_file(root / filename):
            content = _read_text_safe(root / filename)
            if (
                "FastAPI(" in content
                or "Flask(" in content
                or "Celery(" in content
                or "uvicorn" in content
            ):
                return ("service", "high")

    for path in (root / "pyproject.toml", root / "requirements.txt"):
        if _is_file(path):
            content = _read_text_safe(path).lower()
            if any(marker in content for marker in ("fastapi", "flask", "django", "celery")):
                return ("service", "medium")

    return None


def _check_php_service(root: Path) -> tuple[Category, Confidence] | None:
    if _is_file(root / "artisan"):
        return ("service", "high")
    if _is_file(root / "bin" / "console") or _is_file(root / "public" / "index.php"):
        return ("service", "medium")

    composer = root / "composer.json"
    if _is_file(composer):
        content = _read_text_safe(composer)
        if "laravel/framework" in content or "symfony/framework-bundle" in content:
            return ("service", "high")
    return None


def _check_php_package(root: Path) -> bool:
    data = _read_json_object(root / "composer.json")
    if not data:
        return False
    package_type = data.get("type")
    return package_type in (None, "library", "composer-plugin")


def _check_elixir_service(root: Path) -> tuple[Category, Confidence] | None:
    mix = root / "mix.exs"
    if not _is_file(mix):
        return None
    content = _read_text_safe(mix)
    if ":phoenix" in content or "phoenix" in content.lower():
        return ("service", "high")
    return None


def _check_elixir_package(root: Path) -> bool:
    mix = root / "mix.exs"
    if not _is_file(mix):
        return False
    content = _read_text_safe(mix)
    return "def project" in content or "app:" in content


def _check_ruby_service(root: Path) -> tuple[Category, Confidence] | None:
    if _is_file(root / "bin" / "rails"):
        return ("service", "high")
    gemfile = root / "Gemfile"
    if _is_file(gemfile):
        content = _read_text_safe(gemfile)
        if "'rails'" in content or '"rails"' in content or "'sinatra'" in content or '"sinatra"' in content:
            return ("service", "medium")
    return None


def _contains_jvm_service_marker(content: str) -> bool:
    return any(
        marker in content
        for marker in (
            "spring-boot",
            "springframework.boot",
            "quarkus",
            "micronaut",
            "ktor-server",
            "playframework",
        )
    )


def _check_jvm_package(root: Path) -> bool:
    for name in ("pom.xml", "build.gradle", "build.gradle.kts"):
        path = root / name
        if not _is_file(path):
            continue
        content = _read_text_safe(path)
        if not _contains_jvm_service_marker(content):
            return True
    return False


def _check_strong_single_signal(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Step 1: strong single-signal indicators (high confidence)."""

    # Infrastructure: Terraform/OpenTofu directory or files at root
    if _is_dir(root / "terraform") or _is_dir(root / "tofu"):
        return ("infrastructure", "high")
    if (
        _glob_any(root, "*.tf")
        or _glob_any(root, "*.tfvars")
        or _is_file(root / ".terraform.lock.hcl")
        or _is_file(root / ".tofu.lock.hcl")
    ):
        return ("infrastructure", "high")

    # Infrastructure: Helm chart (Chart.yaml at root)
    if _is_file(root / "Chart.yaml"):
        return ("infrastructure", "high")

    # Infrastructure: k8s or kubernetes directory
    if _is_dir(root / "k8s") or _is_dir(root / "kubernetes"):
        return ("infrastructure", "high")

    result = _check_infrastructure_markers(root)
    if result:
        return result

    # Data: dbt
    if _is_file(root / "dbt_project.yml"):
        return ("data", "high")

    # Data: Airflow (dags/ directory or airflow_settings.yaml)
    if _is_dir(root / "dags") or _is_file(root / "airflow_settings.yaml"):
        return ("data", "high")

    result = _check_database_markers(root)
    if result:
        return result

    # .NET test projects are intentionally not a repo_category in this patch.
    if _check_dotnet_test_project(root):
        return ("unknown", "medium")

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
        has_index = _is_file(root / "index.html")
        has_app_entry = any(
            _is_file(root / "src" / filename)
            for filename in (
                "main.ts",
                "main.tsx",
                "main.js",
                "main.jsx",
                "main.vue",
                "main.svelte",
                "App.tsx",
                "App.jsx",
                "App.vue",
            )
        )
        if has_index and has_app_entry:
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

    result = _check_dotnet_service(root)
    if result:
        return result

    result = _check_node_service(root)
    if result:
        return result

    result = _check_python_service(root)
    if result:
        return result

    result = _check_php_service(root)
    if result:
        return result

    result = _check_elixir_service(root)
    if result:
        return result

    # Rack (Ruby)
    if _is_file(root / "config.ru"):
        return ("service", "high")
    result = _check_ruby_service(root)
    if result:
        return result

    # Spring Boot via Maven or Gradle
    if _is_file(root / "pom.xml"):
        content = _read_text_safe(root / "pom.xml")
        if _contains_jvm_service_marker(content):
            return ("service", "high")

    for name in ("build.gradle", "build.gradle.kts"):
        if _is_file(root / name):
            content = _read_text_safe(root / name)
            if _contains_jvm_service_marker(content):
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
        data = _read_json_object(pkg)
        if data:
            has_bin = bool(data.get("bin"))
            scripts = data.get("scripts") or {}
            has_start = isinstance(scripts, dict) and bool(scripts.get("start"))
            has_main = bool(data.get("main"))
            has_types = bool(data.get("types") or data.get("typings"))
            if has_bin and not has_start:
                return ("tool", "medium")
            if (has_main or has_types) and not has_start and not has_bin:
                return ("library", "medium")

    # Rust library: Cargo.toml with [lib] but no [[bin]]
    cargo = root / "Cargo.toml"
    if _is_file(cargo):
        content = _read_text_safe(cargo)
        if "[lib]" in content and "[[bin]]" not in content:
            return ("library", "medium")

    # Ruby gem
    if _glob_any(root, "*.gemspec"):
        return ("library", "medium")

    # NuGet/.NET package
    if _check_dotnet_package(root):
        return ("library", "medium")
    if _glob_any(root, "*.nuspec"):
        return ("library", "medium")

    # Composer package metadata without framework app markers
    if _check_php_package(root):
        return ("library", "medium")

    # Plain Mix packages are libraries unless Phoenix/service markers matched earlier.
    if _check_elixir_package(root):
        return ("library", "medium")

    # JVM build files without service framework markers are libraries.
    if _check_jvm_package(root):
        return ("library", "medium")

    # Go module with no main package entry point is a library.
    if _is_file(root / "go.mod"):
        return ("library", "medium")

    return None
