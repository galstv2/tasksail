"""Filesystem probe to classify repositories as primary (service) or support (library).

Primary = runs on its own (service, frontend app, CLI tool, microservice).
Support = consumed by others (library, NuGet/npm package, IaC, docs).

The key test: "Does this repo run on its own?"
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from src.backend.mcp.context_estate.models import ClassificationResult

REPOSITORY_TYPES = frozenset({"primary", "support"})

_SERVICE_ENTRYPOINTS = frozenset({
    "main.py", "server.py", "app.py", "manage.py",
    "server.ts", "server.js",
})

_DEPLOYMENT_CONFIGS = frozenset({
    "Dockerfile", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "Procfile", "app.yaml", "fly.toml", "railway.json",
    "render.yaml", "vercel.json", "netlify.toml",
})

_INFRA_DIRS = frozenset({
    "terraform", "pulumi", "cdk", "cloudformation",
})

_SUPPORT_NAME_KEYWORDS = frozenset({
    "lib", "utils", "common", "shared", "sdk", "client",
    "helpers", "toolkit", "infra", "core", "types",
})

_DOCS_NAME_KEYWORDS = frozenset({
    "docs", "wiki", "spec", "documentation",
})

_SOURCE_EXTENSIONS = frozenset({
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs",
    ".cs", ".java", ".kt", ".rb", ".swift", ".c", ".cpp",
    ".h", ".hpp", ".scala", ".clj", ".ex", ".exs",
})

_MAKEFILE_RUN_RE = re.compile(r"^(run|serve|start|dev)\s*:", re.MULTILINE)


def classify_repository_type(
    repo_root: Path,
    *,
    languages: list[str] | None = None,
    repo_name: str | None = None,
) -> dict[str, str]:
    """Classify a repository as primary (runnable service/app) or support.

    Returns ``{"repository_type": "primary"|"support",
    "classification_confidence": "high"|"medium"|"low"}``.
    """
    primary_score = 0
    support_score = 0

    primary_score += _check_entrypoint_files(repo_root)
    primary_score += _check_deployment_configs(repo_root)

    pkg_primary, pkg_support = _check_package_json(repo_root)
    primary_score += pkg_primary
    support_score += pkg_support

    py_primary, py_support = _check_python_packaging(repo_root)
    primary_score += py_primary
    support_score += py_support

    primary_score += _check_go_entrypoint(repo_root)
    primary_score += _check_rust_entrypoint(repo_root)
    primary_score += _check_java_kotlin_project(repo_root)
    primary_score += _check_ruby_project(repo_root)
    primary_score += _check_php_project(repo_root)
    primary_score += _check_elixir_project(repo_root)
    primary_score += _check_swift_project(repo_root)
    primary_score += _check_makefile(repo_root)

    name = repo_name or repo_root.name
    name_primary, name_support = _check_name_signals(name)
    primary_score += name_primary
    support_score += name_support

    nuget_primary, nuget_support = _check_dotnet_project(repo_root)
    primary_score += nuget_primary
    support_score += nuget_support

    # Only run docs-only and infra-only checks when no primary signals found.
    # These are "absence of service" indicators that should not compete with
    # positive service signals like Dockerfile or entrypoint files.
    if primary_score == 0:
        support_score += _check_docs_only(repo_root, languages)
        support_score += _check_infra_only(repo_root, primary_score)

    if primary_score == 0 and support_score == 0:
        return ClassificationResult(
            repository_type="support",
            classification_confidence="low",
        ).as_dict()

    repo_type = "primary" if primary_score > support_score else "support"
    margin = abs(primary_score - support_score)
    if margin >= 3:
        confidence = "high"
    elif margin >= 1:
        confidence = "medium"
    else:
        confidence = "low"

    return ClassificationResult(
        repository_type=repo_type,
        classification_confidence=confidence,
    ).as_dict()


def _check_entrypoint_files(repo_root: Path) -> int:
    """Check for service entrypoint files at root. Returns primary score."""
    score = 0
    try:
        for name in _SERVICE_ENTRYPOINTS:
            if (repo_root / name).is_file():
                score += 3 if name == "manage.py" else 2
    except OSError:
        pass
    return score


def _check_deployment_configs(repo_root: Path) -> int:
    """Check for deployment/container configs at root. Returns primary score."""
    score = 0
    try:
        for name in _DEPLOYMENT_CONFIGS:
            if (repo_root / name).is_file():
                score += 3
                break
    except OSError:
        pass
    return score


def _check_package_json(repo_root: Path) -> tuple[int, int]:
    """Parse package.json for service vs library signals."""
    primary = 0
    support = 0
    pkg_path = repo_root / "package.json"
    try:
        if not pkg_path.is_file():
            return (0, 0)
        data = json.loads(pkg_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return (0, 0)

        scripts = data.get("scripts", {})
        has_start = isinstance(scripts, dict) and bool(scripts.get("start"))
        has_bin = bool(data.get("bin"))
        has_main = bool(data.get("main"))
        has_types = bool(data.get("types") or data.get("typings"))

        if has_start:
            primary += 2
        if has_bin:
            primary += 1
        if (has_main or has_types) and not has_start and not has_bin:
            support += 2
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        pass
    return (primary, support)


def _check_python_packaging(repo_root: Path) -> tuple[int, int]:
    """Check pyproject.toml / setup.py for CLI entrypoints vs pure library."""
    primary = 0
    support = 0
    try:
        pyproject = repo_root / "pyproject.toml"
        setup_py = repo_root / "setup.py"
        has_packaging = pyproject.is_file() or setup_py.is_file()
        if not has_packaging:
            return (0, 0)

        has_scripts = False
        if pyproject.is_file():
            content = pyproject.read_text(encoding="utf-8")
            if "[project.scripts]" in content or "[tool.poetry.scripts]" in content:
                has_scripts = True

        if not has_scripts and setup_py.is_file():
            content = setup_py.read_text(encoding="utf-8")
            if "console_scripts" in content or "entry_points" in content:
                has_scripts = True

        if has_scripts:
            primary += 2
        else:
            support += 2
    except (OSError, UnicodeDecodeError):
        pass
    return (primary, support)


def _check_java_kotlin_project(repo_root: Path) -> int:
    """Check for Java/Kotlin service signals (Spring Boot, Gradle app, Maven app)."""
    try:
        # Spring Boot application class or main method
        has_spring_boot = False
        has_build_tool = False

        # Gradle with application plugin or Spring Boot
        for name in ("build.gradle", "build.gradle.kts"):
            gradle = repo_root / name
            if gradle.is_file():
                has_build_tool = True
                content = gradle.read_text(encoding="utf-8", errors="replace")[:4000]
                if "spring-boot" in content or "springframework.boot" in content:
                    has_spring_boot = True
                if "application" in content and "mainClass" in content:
                    return 2

        # Maven with Spring Boot or exec plugin
        pom = repo_root / "pom.xml"
        if pom.is_file():
            has_build_tool = True
            content = pom.read_text(encoding="utf-8", errors="replace")[:4000]
            if "spring-boot" in content or "springframework.boot" in content:
                has_spring_boot = True
            if "<mainClass>" in content:
                return 2

        if has_spring_boot:
            return 3

        # gradlew or mvnw at root suggests a runnable project
        if has_build_tool and (
            (repo_root / "gradlew").is_file()
            or (repo_root / "mvnw").is_file()
        ):
            return 1
    except OSError:
        pass
    return 0


def _check_ruby_project(repo_root: Path) -> int:
    """Check for Ruby service signals (Rails, Rack, config.ru)."""
    try:
        # config.ru = Rack app (service)
        if (repo_root / "config.ru").is_file():
            return 3
        # Rakefile + bin/rails = Rails app
        if (repo_root / "bin" / "rails").is_file():
            return 3
        # Gemfile with rails dependency
        gemfile = repo_root / "Gemfile"
        if gemfile.is_file():
            content = gemfile.read_text(encoding="utf-8", errors="replace")[:2000]
            if "'rails'" in content or '"rails"' in content:
                return 2
            if "'sinatra'" in content or '"sinatra"' in content:
                return 2
    except OSError:
        pass
    return 0


def _check_php_project(repo_root: Path) -> int:
    """Check for PHP service signals (Laravel, Symfony, index.php)."""
    try:
        # Laravel artisan CLI
        if (repo_root / "artisan").is_file():
            return 3
        # Symfony console
        if (repo_root / "bin" / "console").is_file():
            return 2
        # public/index.php = web app entrypoint
        if (repo_root / "public" / "index.php").is_file():
            return 2
        # composer.json with framework dependency
        composer = repo_root / "composer.json"
        if composer.is_file():
            content = composer.read_text(encoding="utf-8", errors="replace")[:2000]
            if "laravel/framework" in content or "symfony/framework-bundle" in content:
                return 2
    except OSError:
        pass
    return 0


def _check_elixir_project(repo_root: Path) -> int:
    """Check for Elixir/Phoenix service signals."""
    try:
        mix = repo_root / "mix.exs"
        if not mix.is_file():
            return 0
        content = mix.read_text(encoding="utf-8", errors="replace")[:2000]
        # Phoenix framework = web service
        if ":phoenix" in content or "phoenix" in content.lower():
            return 3
        # Any mix project with a module that has application/start
        if "mod:" in content:
            return 1
    except OSError:
        pass
    return 0


def _check_swift_project(repo_root: Path) -> int:
    """Check for Swift service/app signals (Xcode project, Package.swift with executable)."""
    try:
        # .xcodeproj or .xcworkspace = likely an app
        for child in repo_root.iterdir():
            if child.suffix in (".xcodeproj", ".xcworkspace") and child.is_dir():
                return 2

        # Package.swift with executable target
        pkg = repo_root / "Package.swift"
        if pkg.is_file():
            content = pkg.read_text(encoding="utf-8", errors="replace")[:2000]
            if ".executableTarget" in content:
                return 2
    except OSError:
        pass
    return 0


def _check_go_entrypoint(repo_root: Path) -> int:
    """Check for Go service entrypoint (cmd/main.go)."""
    try:
        if (repo_root / "cmd" / "main.go").is_file():
            return 2
        if (repo_root / "main.go").is_file():
            return 2
    except OSError:
        pass
    return 0


def _check_rust_entrypoint(repo_root: Path) -> int:
    """Check for Rust binary entrypoint (src/main.rs)."""
    try:
        if (repo_root / "src" / "main.rs").is_file():
            return 2
    except OSError:
        pass
    return 0


def _check_makefile(repo_root: Path) -> int:
    """Check Makefile for run/serve targets. Reads first 50 lines."""
    try:
        makefile = repo_root / "Makefile"
        if not makefile.is_file():
            return 0
        lines: list[str] = []
        with makefile.open(encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if i >= 50:
                    break
                lines.append(line)
        content = "".join(lines)
        if _MAKEFILE_RUN_RE.search(content):
            return 1
    except OSError:
        pass
    return 0


def _check_name_signals(name: str) -> tuple[int, int]:
    """Check repo name for service vs library keywords."""
    primary = 0
    support = 0
    lower = name.lower().replace("_", "-")
    segments = set(lower.split("-"))

    for keyword in _DOCS_NAME_KEYWORDS:
        if keyword in segments:
            support += 2
            return (primary, support)

    for keyword in _SUPPORT_NAME_KEYWORDS:
        if keyword in segments:
            support += 1
            break

    return (primary, support)


def _check_docs_only(
    repo_root: Path,
    languages: list[str] | None,
) -> int:
    """Return support score if repo contains only docs, no source code."""
    if languages and len(languages) > 0:
        return 0
    try:
        has_source = False
        file_count = 0
        for child in repo_root.rglob("*"):
            if file_count > 200:
                break
            if not child.is_file():
                continue
            parts = child.parts
            if any(p.startswith(".") or p in ("node_modules", "__pycache__", "dist", "build") for p in parts):
                continue
            file_count += 1
            if child.suffix in _SOURCE_EXTENSIONS:
                has_source = True
                break
        if file_count > 0 and not has_source:
            return 3
    except OSError:
        pass
    return 0


def _check_infra_only(repo_root: Path, primary_score: int) -> int:
    """Return support score if repo is infrastructure-only with no service entrypoint."""
    if primary_score > 0:
        return 0
    try:
        for dir_name in _INFRA_DIRS:
            if (repo_root / dir_name).is_dir():
                return 3
    except OSError:
        pass
    return 0


def _check_dotnet_project(repo_root: Path) -> tuple[int, int]:
    """Check for .NET solution/project files. Returns (primary, support).

    Handles the .NET convention of nested projects under src/.
    """
    primary = 0
    support = 0
    try:
        # .sln or .slnx at root is a strong service signal
        for child in repo_root.iterdir():
            if child.suffix in (".sln", ".slnx") and child.is_file():
                primary += 2
                break

        # Search for .csproj files up to 3 levels deep
        csproj_files: list[Path] = []
        for depth_pattern in ("*.csproj", "*/*.csproj", "*/*/*.csproj"):
            csproj_files.extend(repo_root.glob(depth_pattern))
            if csproj_files:
                break

        if not csproj_files:
            # Check for .nuspec (NuGet package, no project)
            for child in repo_root.iterdir():
                if child.suffix == ".nuspec" and child.is_file():
                    support += 2
                    break
            return (primary, support)

        has_web_sdk = False
        has_exe_output = False
        has_package_only = False
        for csproj in csproj_files[:5]:
            content = csproj.read_text(encoding="utf-8", errors="replace")
            if "Microsoft.NET.Sdk.Web" in content:
                has_web_sdk = True
            if "<OutputType>Exe</OutputType>" in content:
                has_exe_output = True
            if "<PackageId>" in content and "<OutputType>Exe</OutputType>" not in content:
                has_package_only = True

        if has_web_sdk:
            primary += 3
        elif has_exe_output:
            primary += 2
        elif has_package_only:
            support += 2

    except OSError:
        pass
    return (primary, support)
