"""Shared constants for context estate discovery, manifest, and bootstrap."""
from __future__ import annotations

from src.backend.mcp.pack.constants import (  # noqa: F401 – re-export for backward compat
    ALLOWED_ESTATE_TYPES,
    ALLOWED_LAYERS,
    DISTRIBUTED_ESTATE_TYPES,
    MONOLITH_ESTATE_TYPES,
    REPOSITORY_TYPES,
)

ESTATE_TYPES = ("distributed", "monolith")

ALLOWED_DISCOVERY_MODES = (
    "auto",
    "distributed",
    "distributed-platform",
    "monolith",
    "monolith-platform",
)

SKIP_DIR_NAMES = {
    ".git", ".hg", ".svn", ".idea", ".vscode", ".venv",
    "__pycache__", "node_modules", "dist", "build", "coverage",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".next",
    "target", "vendor",
}

DIRECT_FOCUS_TYPES: dict[str, str] = {
    "docs": "docs", "doc": "docs",
    "infra": "infrastructure", "infrastructure": "infrastructure",
    "shared": "shared", "src": "source", "source": "source",
    "backend": "backend", "frontend": "frontend",
    "api": "service", "web": "application", "app": "application",
    "apps": "application-group", "package": "package",
    "packages": "package-group",
    "service": "service-group", "services": "service-group",
    "module": "module-group", "modules": "module-group",
    "domain": "domain-group", "domains": "domain-group",
    "component": "component-group", "components": "component-group",
    "lib": "library-group", "libs": "library-group",
}

GROUP_CHILD_TYPES: dict[str, str] = {
    "services": "service", "service": "service",
    "apps": "application", "app": "application",
    "packages": "package", "package": "package",
    "modules": "module", "module": "module",
    "domains": "domain", "domain": "domain",
    "components": "component", "component": "component",
    "libs": "library", "lib": "library",
}

HIGH_SIGNAL_TYPE_ALIASES: dict[str, str] = {
    "docs": "docs", "doc": "docs",
    "infra": "infrastructure", "infrastructure": "infrastructure",
    "services": "services", "service": "services",
    "packages": "packages", "package": "packages",
    "src": "source", "source": "source",
    "apps": "applications", "app": "applications",
    "libs": "libraries", "lib": "libraries",
    "shared": "shared", "backend": "backend", "frontend": "frontend",
    "api": "service", "web": "application",
}

DEFAULT_DISTRIBUTED_SCAN_DEPTH = 4

ALLOWED_REPO_ROLES = {
    "frontend", "backend-service", "shared-lib", "infra",
    "database", "service", "application", "library", "shared",
}

ALLOWED_FOCUS_TYPES = {
    "application", "application-group", "backend", "component",
    "component-group", "docs", "domain", "domain-group",
    "frontend", "general", "infrastructure", "library",
    "library-group", "module", "module-group", "package",
    "package-group", "service", "service-group", "shared", "source",
}

DEFAULT_REPOSITORY_TYPE = "support"

DEFAULT_SCOPE_MODE = "focused"

EXTENSION_LANGUAGE_MAP: dict[str, str] = {
    ".py": "python", ".cs": "csharp",
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".go": "go", ".java": "java", ".rs": "rust", ".rb": "ruby",
    ".tf": "hcl", ".hcl": "hcl", ".sql": "sql", ".sh": "shell",
    ".yaml": "yaml", ".yml": "yaml", ".json": "json",
}

EXCLUDED_SCAN_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__",
    "bin", "obj", "dist", "build", ".tox", ".mypy_cache",
}

FRONTEND_SIGNALS = {
    "public", "components", "pages", "views",
    "next.config.js", "next.config.ts", "next.config.mjs",
    "vite.config.ts", "vite.config.js", "angular.json", "nuxt.config.ts",
}

INFRA_SIGNALS = {"terraform", "pulumi", "cdk", "cloudformation"}

TEST_SIGNALS = {
    "tests", "test", "__tests__", "spec", "e2e",
    "cypress", "playwright",
    "jest.config.js", "jest.config.ts",
    "vitest.config.ts", "vitest.config.js", "vitest.config.mts",
    "pytest.ini", "conftest.py",
    "karma.conf.js",
    ".rspec",
}

# Suffixes on the directory/repo name itself that indicate a test project.
# Matched case-insensitively against the final path component.
TEST_NAME_SUFFIXES = (
    ".tests", ".test",
    ".unittests", ".integrationtests", ".functionaltests",
    "-tests", "-test", "-e2e", "-spec",
    "_tests", "_test",
)

MAX_SCAN_FILES = 500
