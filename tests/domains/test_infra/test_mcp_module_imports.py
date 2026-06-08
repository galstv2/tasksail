"""Reference-integrity guard for the mcp directory refactor.

Locks the post-refactor module addresses: every relocated mcp module must import
cleanly, every deleted compatibility shim must be gone, and every script entrypoint
that imports an mcp module must still resolve. A future move that forgets to repoint a
caller fails here at collection/run time instead of silently at runtime.
"""
from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "src" / "backend" / "scripts" / "python"

# The 15 importable modules the 18 pre-refactor root modules collapsed into.
RELOCATED_MCP_MODULES = (
    "src.backend.mcp.probes.git_roots",
    "src.backend.mcp.probes.path_resolution",
    "src.backend.mcp.probes.repo_category_probe",
    "src.backend.mcp.probes.repo_type_probe",
    "src.backend.mcp.pack.constants",
    "src.backend.mcp.pack.io",
    "src.backend.mcp.pack.writer",
    "src.backend.mcp.pack.preflight",
    "src.backend.mcp.workspace_context_sync.cli",
    "src.backend.mcp.workspace_context_sync.deep_focus",
    "src.backend.mcp.workspace_context_sync.resolution",
    "src.backend.mcp.workspace_context_sync.service",
    "src.backend.mcp.workspace_context_sync.workspace",
    "src.backend.mcp.context_estate.discovery_cli",
    "src.backend.mcp.context_estate.manifest_cli",
)

# The 3 pure re-export shims deleted by the Path-B collapse - must NOT be importable.
DELETED_MCP_SHIMS = (
    "src.backend.mcp.context_estate_draft_index",
    "src.backend.mcp.context_estate_manifest",
    "src.backend.mcp.context_pack_bootstrap",
)

# Entrypoints that import a relocated mcp module. They are normally run as
# `python <script>.py`, which puts the script's own dir on sys.path[0]; their
# `from lib.X import ...` aliases rely on it, so we replicate that here.
SCRIPT_ENTRYPOINTS_IMPORTING_MCP = (
    "approve-context-estate-manifest.py",
    "bootstrap-context-pack.py",
    "discover-context-estate.py",
    "plan-qmd-seeding.py",
    "run-pack-preflight.py",
    "sync-context-pack-workspace.py",
    "update-pack-manifest.py",
    "upgrade-pack-schema.py",
)


@pytest.mark.parametrize("module_path", RELOCATED_MCP_MODULES)
def test_relocated_mcp_module_importable(module_path: str) -> None:
    assert importlib.import_module(module_path) is not None


@pytest.mark.parametrize("module_path", DELETED_MCP_SHIMS)
def test_deleted_shim_is_gone(module_path: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module_path)


@pytest.mark.parametrize("script_name", SCRIPT_ENTRYPOINTS_IMPORTING_MCP)
def test_entrypoint_imports_resolve(script_name: str) -> None:
    script_path = SCRIPTS_DIR / script_name
    assert script_path.exists(), f"missing entrypoint: {script_path}"
    module_name = "_import_smoke_" + Path(script_name).stem.replace("-", "_")
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        spec = importlib.util.spec_from_file_location(module_name, script_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(SCRIPTS_DIR))
        sys.modules.pop(module_name, None)


def test_bootstrap_context_pack_parser_accepts_infrastructure_modes() -> None:
    script_path = SCRIPTS_DIR / "bootstrap-context-pack.py"
    module_name = "_bootstrap_context_pack_parser"
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        spec = importlib.util.spec_from_file_location(module_name, script_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        for mode in ("distributed-platform", "monolith-platform"):
            args = module.parse_args([
                "--context-pack-dir",
                "/tmp/context-pack",
                "--answers-json",
                "{}",
                "--discovery-root",
                "/tmp/source",
                "--mode",
                mode,
            ])
            assert args.mode == mode
    finally:
        sys.path.remove(str(SCRIPTS_DIR))
        sys.modules.pop(module_name, None)
