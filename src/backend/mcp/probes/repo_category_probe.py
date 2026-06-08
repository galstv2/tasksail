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

from pathlib import Path

from src.backend.mcp.pack.constants import WIZARD_ROLE_TO_REPO_CATEGORY
from src.backend.mcp.probes.repo_category_fs import (
    _glob_any,
    _is_dir,
    _is_file,
    _iter_files,
    _read_json_object,
    _read_text_safe,
    _rglob_any,
)

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
    """Return the repo category mapped from a wizard role.

    Returns None for unknown roles so callers can fall through to 'unknown'.
    """
    return WIZARD_ROLE_TO_REPO_CATEGORY.get(role)


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
    # Scan up to depth 3 with a generous cap so test/library projects in a
    # multi-project solution don't crowd out the defining project.
    return _iter_files(root, ("*.csproj", "*/*.csproj", "*/*/*.csproj"), limit=40)


def _is_dotnet_test_project(csproj: Path, content: str) -> bool:
    name = csproj.stem.lower()
    if name.endswith(".tests") or name.endswith(".test"):
        return True
    lowered = content.lower()
    return (
        "microsoft.net.test.sdk" in lowered
        or "xunit" in lowered
        or "nunit" in lowered
        or "mstest.testframework" in lowered
    )


def _dotnet_program_is_service(root: Path) -> bool:
    for program in _iter_files(root, ("Program.cs", "*/Program.cs", "*/*/Program.cs"), limit=8):
        content = _read_text_safe(program)
        if (
            "WebApplication.CreateBuilder" in content
            or "WebApplication.Create" in content
            or "MapControllers" in content
            or "MapGet" in content
            or "UseKestrel" in content
            or "BackgroundService" in content
            or "Host.CreateApplicationBuilder" in content
            or "IHostBuilder" in content
        ):
            return True
    return False


def _dotnet_has_services_layout(root: Path) -> bool:
    # A services/ directory holding projects is the conventional multi-service
    # platform layout — a strong service signal even without Web/Worker SDKs.
    for pattern in ("services/*.csproj", "services/*/*.csproj", "src/services/*/*.csproj"):
        if _glob_any(root, pattern):
            return True
    return False


def _check_dotnet(root: Path) -> tuple[Category, Confidence] | None:
    """Unified .NET classification: service / tool / library / unknown.

    Counts NON-TEST projects so test projects in a multi-project solution can no
    longer preempt classification (the prior short-circuit was why multi-project
    .NET solutions resolved to 'unknown'). 'unknown' is reserved for a genuine
    test-only repository.
    """
    projects = _dotnet_project_files(root)
    has_solution = _glob_any(root, "*.sln") or _glob_any(root, "*.slnx")
    has_nuspec = _glob_any(root, "*.nuspec")
    if not projects and not has_solution and not has_nuspec:
        return None

    nontest = 0
    test_count = 0
    has_web_sdk = False
    has_exe = False
    has_package = False
    for csproj in projects:
        content = _read_text_safe(csproj)
        if _is_dotnet_test_project(csproj, content):
            test_count += 1
            continue
        nontest += 1
        if "Microsoft.NET.Sdk.Web" in content or "Microsoft.NET.Sdk.Worker" in content:
            has_web_sdk = True
        elif "<OutputType>Exe</OutputType>" in content:
            has_exe = True
        elif (
            "<PackageId>" in content
            or "<GeneratePackageOnBuild>true</GeneratePackageOnBuild>" in content
            or "Microsoft.NET.Sdk.Razor" in content
            or "<OutputType>Library</OutputType>" in content
        ):
            has_package = True

    if has_web_sdk:
        return ("service", "high")
    if _dotnet_program_is_service(root):
        return ("service", "medium")
    if _dotnet_has_services_layout(root):
        return ("service", "medium")
    if has_exe:
        return ("tool", "medium")
    if has_package:
        return ("library", "medium")
    if nontest > 0:
        return ("library", "medium")
    # No non-test projects: a genuine test-only repo, or solution/nuspec only.
    if root.name.endswith(".Tests") or root.name.endswith(".Test") or test_count > 0:
        return ("unknown", "medium")
    return ("library", "medium")


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
    entry_markers = (
        "FastAPI(", "Flask(", "Celery(", "uvicorn", "Starlette(",
        "tornado", "aiohttp", "Litestar(", "Sanic(", "Quart(",
    )
    for filename in ("app.py", "server.py", "main.py"):
        if _is_file(root / filename):
            content = _read_text_safe(root / filename)
            if any(marker in content for marker in entry_markers):
                return ("service", "high")

    dep_markers = (
        "fastapi", "flask", "django", "celery", "starlette",
        "tornado", "aiohttp", "litestar", "sanic", "quart",
    )
    for path in (
        root / "pyproject.toml",
        root / "requirements.txt",
        root / "setup.py",
        root / "setup.cfg",
    ):
        if _is_file(path):
            content = _read_text_safe(path).lower()
            if any(marker in content for marker in dep_markers):
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


def _check_dart(root: Path) -> tuple[Category, Confidence] | None:
    """Dart/Flutter: GUI app vs CLI tool vs package library."""
    pub = root / "pubspec.yaml"
    if not _is_file(pub):
        return None
    content = _read_text_safe(pub)
    if "sdk: flutter" in content or "\nflutter:" in content or content.startswith("flutter:"):
        return ("application", "high")
    if "executables:" in content:
        return ("tool", "medium")
    return ("library", "medium")


def _check_swift_package(root: Path) -> tuple[Category, Confidence] | None:
    """Swift Package Manager (non-Xcode): executable target vs library."""
    pkg = root / "Package.swift"
    if not _is_file(pkg):
        return None
    content = _read_text_safe(pkg)
    if ".executableTarget" in content or ".executable(" in content:
        if "Vapor" in content or "Hummingbird" in content:
            return ("service", "medium")
        return ("tool", "medium")
    return ("library", "medium")


def _check_deno_bun(root: Path) -> tuple[Category, Confidence] | None:
    """Deno/Bun runtimes (Node alternatives)."""
    for cfg in ("deno.json", "deno.jsonc"):
        if _is_file(root / cfg):
            content = _read_text_safe(root / cfg)
            if '"tasks"' in content and ('"start"' in content or '"serve"' in content):
                return ("service", "medium")
            return ("library", "medium")
    if _is_file(root / "bun.toml") or _is_file(root / "bunfig.toml"):
        return ("service", "medium")
    return None


def _check_c_cpp(root: Path) -> tuple[Category, Confidence] | None:
    """C/C++ build systems. add_executable → tool (CLI), add_library → library."""
    cmake = root / "CMakeLists.txt"
    if _is_file(cmake):
        content = _read_text_safe(cmake)
        has_exe = "add_executable(" in content
        has_lib = "add_library(" in content
        if has_exe and not has_lib:
            return ("tool", "medium")
        return ("library", "medium")
    if (
        _is_file(root / "conanfile.txt")
        or _is_file(root / "conanfile.py")
        or _is_file(root / "vcpkg.json")
    ):
        return ("library", "medium")
    if _is_file(root / "meson.build"):
        content = _read_text_safe(root / "meson.build")
        if "executable(" in content and "library(" not in content:
            return ("tool", "medium")
        return ("library", "medium")
    return None


def _check_strong_single_signal(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Strong single-signal indicators with high confidence."""

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

    # Dart / Flutter (GUI app vs CLI tool vs library)
    result = _check_dart(root)
    if result:
        return result

    # Application: PyInstaller; only count build files with PyInstaller content.
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
    """Frontend framework config files with high confidence."""

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
    """Service entrypoint files with medium-high confidence."""

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

    result = _check_dotnet(root)
    if result:
        return result

    result = _check_node_service(root)
    if result:
        return result

    result = _check_python_service(root)
    if result:
        return result

    result = _check_swift_package(root)
    if result:
        return result

    result = _check_deno_bun(root)
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

    # Go: a main entry point. CLI frameworks → tool; otherwise service.
    if _is_file(root / "cmd" / "main.go") or _is_file(root / "main.go"):
        gomod = root / "go.mod"
        gomod_text = _read_text_safe(gomod) if _is_file(gomod) else ""
        if any(
            lib in gomod_text
            for lib in ("spf13/cobra", "urfave/cli", "alecthomas/kingpin")
        ):
            return ("tool", "medium")
        if _is_file(root / "cmd" / "main.go"):
            return ("service", "high")
        return ("service", "medium")

    # Rust binary: src/main.rs but NOT src/lib.rs (that would be library)
    if _is_file(root / "src" / "main.rs") and not _is_file(root / "src" / "lib.rs"):
        return ("service", "medium")

    return None


def _check_tool_library(
    root: Path,
) -> tuple[Category, Confidence] | None:
    """Tool vs library disambiguation with medium confidence."""

    # C / C++ build systems
    result = _check_c_cpp(root)
    if result:
        return result

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

    # Rust: workspace or library crate (binary crates fall through to tool)
    cargo = root / "Cargo.toml"
    if _is_file(cargo):
        content = _read_text_safe(cargo)
        if "[workspace]" in content:
            return ("library", "medium")
        if "[lib]" in content and "[[bin]]" not in content:
            return ("library", "medium")
        if "[[bin]]" in content and "[lib]" not in content:
            return ("tool", "medium")

    # Ruby gem
    if _glob_any(root, "*.gemspec"):
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
