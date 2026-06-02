"""PackWriter operator-authored update regressions."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

from src.backend.mcp.pack_schemas import LocalPath, ManifestRepositoryV2, RepoSourcesManifestV2
from src.backend.mcp.pack_writer import PackWriter


def _load_update_pack_manifest_script() -> ModuleType:
    script_path = Path("src/backend/scripts/python/update-pack-manifest.py").resolve()
    script_dir = str(script_path.parent)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    spec = importlib.util.spec_from_file_location("update_pack_manifest", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_pack_dir(tmp_path: Path) -> tuple[Path, Path]:
    pack_dir = tmp_path / "pack"
    manifest_path = pack_dir / "qmd" / "repo-sources.json"
    manifest = RepoSourcesManifestV2(
        manifest_version="qmd-repo-sources/v2",
        manifest_status="approved",
        estate_type="distributed",
        context_pack_id="operator-toggle-pack",
        qmd_scope_root="qmd/context-packs/operator-toggle-pack",
        repositories=[
            ManifestRepositoryV2(
                repo_id="api",
                repo_name="API",
                repo_focus="primary",
                repo_focus_authored=True,
                repo_category="application",
                repo_category_authored=True,
                local_paths=[LocalPath(host=str(tmp_path / "api"), container=None)],
            )
        ],
    )
    PackWriter(pack_dir).write_manifest(manifest)
    return pack_dir, manifest_path



def test_operator_update_can_change_authored_repo_focus(tmp_path: Path) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)

    def operator_toggle(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus = "support"
        model.repositories[0].repo_focus_authored = True
        return model

    PackWriter(pack_dir).update_manifest(
        operator_toggle,
        preserve_authored_fields=False,
    )

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repo_focus"] == "support"
    assert raw["repositories"][0]["repository_type"] == "support"
    assert raw["repositories"][0]["repo_focus_authored"] is True



def test_default_update_still_preserves_authored_repo_focus(tmp_path: Path) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)

    def automated_probe(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus = "support"
        return model

    PackWriter(pack_dir).update_manifest(automated_probe)

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repo_focus"] == "primary"
    assert raw["repositories"][0]["repository_type"] == "primary"



def test_default_update_preserves_repo_focus_even_without_authored_flag(
    tmp_path: Path,
) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)

    def clear_authored_flag(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus_authored = False
        return model

    def automated_probe(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus = "support"
        return model

    writer = PackWriter(pack_dir)
    writer.update_manifest(clear_authored_flag, preserve_authored_fields=False)
    writer.update_manifest(automated_probe)

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repo_focus"] == "primary"
    assert raw["repositories"][0]["repository_type"] == "primary"
    assert raw["repositories"][0]["repo_focus_authored"] is False



def test_operator_update_can_change_authored_repo_category(tmp_path: Path) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)

    def operator_update(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_category = "tool"
        model.repositories[0].repo_category_authored = True
        return model

    PackWriter(pack_dir).update_manifest(
        operator_update,
        preserve_authored_fields=False,
    )

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repo_category"] == "tool"
    assert raw["repositories"][0]["repo_category_authored"] is True



def test_update_pack_manifest_script_can_toggle_authored_repo_focus(
    tmp_path: Path,
) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)
    update_pack_manifest = _load_update_pack_manifest_script()

    exit_code = update_pack_manifest.main(
        [
            "--context-pack-dir",
            str(pack_dir),
            "--repo-id",
            "api",
            "--repo-focus",
            "support",
        ]
    )

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert raw["repositories"][0]["repo_focus"] == "support"
    assert raw["repositories"][0]["repository_type"] == "support"



def test_update_pack_manifest_script_set_repo_category_preserves_focus(
    tmp_path: Path,
) -> None:
    pack_dir = tmp_path / "pack"
    manifest_path = pack_dir / "qmd" / "repo-sources.json"
    manifest = RepoSourcesManifestV2(
        manifest_version="qmd-repo-sources/v2",
        manifest_status="approved",
        estate_type="distributed",
        context_pack_id="operator-category-pack",
        qmd_scope_root="qmd/context-packs/operator-category-pack",
        primary_working_repo_ids=["api"],
        repositories=[
            ManifestRepositoryV2(
                repo_id="api",
                repo_name="API",
                repo_focus="primary",
                repo_focus_authored=True,
                repo_category="application",
                repo_category_authored=False,
                local_paths=[LocalPath(host=str(tmp_path / "api"), container=None)],
            )
        ],
    )
    PackWriter(pack_dir).write_manifest(manifest)
    update_pack_manifest = _load_update_pack_manifest_script()

    exit_code = update_pack_manifest.main(
        [
            "--context-pack-dir",
            str(pack_dir),
            "--repo-id",
            "api",
            "--repo-category",
            "service",
        ]
    )

    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert raw["primary_working_repo_ids"] == ["api"]
    assert raw["repositories"][0]["repo_category"] == "service"
    assert raw["repositories"][0]["repo_category_authored"] is True
    assert raw["repositories"][0]["repo_focus"] == "primary"
    assert raw["repositories"][0]["repository_type"] == "primary"
    assert raw["repositories"][0]["repo_focus_authored"] is True
