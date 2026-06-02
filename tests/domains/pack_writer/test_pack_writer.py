"""Tests for PackWriter — atomic write, authorship guards, and derivation logic."""
from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from src.backend.mcp.pack_schemas import (
    LocalPath,
    ManifestRepositoryV2,
    RepoSourcesManifestV2,
    validate_answers,
    validate_manifest_v2,
    validate_plan,
)
from src.backend.mcp.pack_schemas.manifest import ManifestFocusableArea
from src.backend.mcp.pack_writer import PackWriter, PackWriterContended

# Paths to shared fixtures
_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "pack_schemas"
_MANIFEST_V2_FIXTURE = _FIXTURES / "manifest" / "distributed-v2.json"
_ANSWERS_FIXTURE = _FIXTURES / "answers" / "minimum.json"
_PLAN_FIXTURE = _FIXTURES / "plan" / "minimum.json"


def _load_v2_fixture() -> RepoSourcesManifestV2:
    raw = json.loads(_MANIFEST_V2_FIXTURE.read_text(encoding="utf-8"))
    return validate_manifest_v2(raw)


def _make_pack_dir(tmp_path: Path) -> tuple[Path, Path]:
    """Return (pack_dir, manifest_path) with a seeded v2 manifest."""
    pack_dir = tmp_path / "my-pack"
    pack_dir.mkdir()
    manifest_dir = pack_dir / "qmd"
    manifest_dir.mkdir()
    manifest_path = manifest_dir / "repo-sources.json"
    manifest_path.write_text(_MANIFEST_V2_FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    return pack_dir, manifest_path


# ------------------------------------------------------------------
# Test 1: basic write creates the manifest
# ------------------------------------------------------------------

def test_write_manifest_creates_file(tmp_path: Path) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    model = _load_v2_fixture()
    writer = PackWriter(pack_dir)
    writer.write_manifest(model)
    manifest_path = pack_dir / "qmd" / "repo-sources.json"
    assert manifest_path.exists()
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert raw["context_pack_id"] == "platform-demo-v2"


# ------------------------------------------------------------------
# Test 2: write_manifest mirrors repository_type = repo_focus
# ------------------------------------------------------------------

def test_write_manifest_mirrors_repository_type(tmp_path: Path) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    model = _load_v2_fixture()
    # Set repo_focus to a known value, clear repository_type
    assert model.repositories is not None
    model.repositories[0].repo_focus = "support"
    model.repositories[0].repository_type = ""
    PackWriter(pack_dir).write_manifest(model)
    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repository_type"] == "support"


# ------------------------------------------------------------------
# Test 3: write_manifest derives focus area repository_type
# ------------------------------------------------------------------

def test_write_manifest_derives_focus_area_types(tmp_path: Path) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    model = RepoSourcesManifestV2(
        manifest_version="qmd-repo-sources/v2",
        manifest_status="approved",
        estate_type="monolith",
        context_pack_id="focus-pack",
        qmd_scope_root="qmd/context-packs/focus-pack",
        primary_focus_area_ids=["api"],
        focusable_areas=[
            ManifestFocusableArea(
                focus_id="api",
                focus_name="API",
                focus_type="service",
                relative_path="src/api",
            ),
            ManifestFocusableArea(
                focus_id="core",
                focus_name="Core",
                focus_type="service",
                relative_path="src/core",
            ),
        ],
    )
    PackWriter(pack_dir).write_manifest(model)
    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    fa_by_id = {fa["focus_id"]: fa for fa in raw["focusable_areas"]}
    assert fa_by_id["api"]["repository_type"] == "primary"
    assert fa_by_id["core"]["repository_type"] == "support"


# ------------------------------------------------------------------
# Test 4: update_manifest authorship guard — repo_focus
# ------------------------------------------------------------------


def test_update_manifest_authorship_guard_repo_focus(tmp_path: Path) -> None:
    pack_dir, _ = _make_pack_dir(tmp_path)

    # Mark the first repo as authored with a specific focus
    def seed_authored(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus = "support"
        model.repositories[0].repo_focus_authored = True
        return model

    writer = PackWriter(pack_dir)
    writer.update_manifest(seed_authored, preserve_authored_fields=False)

    # Now a mutator tries to overwrite the authored value
    def try_override(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus = "primary"
        return model

    writer.update_manifest(try_override)

    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    # The authored value should be preserved
    assert raw["repositories"][0]["repo_focus"] == "support"


# ------------------------------------------------------------------
# Test 5: update_manifest authorship guard — repo_category
# ------------------------------------------------------------------


def test_update_manifest_authorship_guard_repo_category(tmp_path: Path) -> None:
    pack_dir, _ = _make_pack_dir(tmp_path)

    def seed_authored(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_category = "library"
        model.repositories[0].repo_category_authored = True
        return model

    writer = PackWriter(pack_dir)
    writer.update_manifest(seed_authored)

    def try_override(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_category = "tool"
        return model

    writer.update_manifest(try_override)

    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repo_category"] == "library"


# ------------------------------------------------------------------
# Test 6: update_manifest — repo_focus is operator-owned
# ------------------------------------------------------------------


def test_update_manifest_preserves_repo_focus_without_authored_flag(tmp_path: Path) -> None:
    pack_dir, _ = _make_pack_dir(tmp_path)

    def mutator(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        assert model.repositories is not None
        model.repositories[0].repo_focus = "support"
        return model

    PackWriter(pack_dir).update_manifest(mutator)

    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    assert raw["repositories"][0]["repo_focus"] == "primary"


# ------------------------------------------------------------------
# Test 7: write_answers creates the answers file
# ------------------------------------------------------------------

def test_write_answers_creates_file(tmp_path: Path) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    raw = json.loads(_ANSWERS_FIXTURE.read_text(encoding="utf-8"))
    answers_model = validate_answers(raw)
    PackWriter(pack_dir).write_answers(answers_model)
    answers_path = pack_dir / "qmd" / "bootstrap" / "bootstrap-answers.json"
    assert answers_path.exists()
    parsed = json.loads(answers_path.read_text(encoding="utf-8"))
    assert parsed["context_pack_id"] == "test-pack"


# ------------------------------------------------------------------
# Test 8: write_plan creates the plan file
# ------------------------------------------------------------------

def test_write_plan_creates_file(tmp_path: Path) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    raw = json.loads(_PLAN_FIXTURE.read_text(encoding="utf-8"))
    plan_model = validate_plan(raw)
    PackWriter(pack_dir).write_plan(plan_model)
    plan_path = pack_dir / "qmd" / "bootstrap" / "seed-plan.json"
    assert plan_path.exists()
    parsed = json.loads(plan_path.read_text(encoding="utf-8"))
    assert parsed["context_pack_id"] == "test-pack"


# ------------------------------------------------------------------
# Test 9: manifest_file override routes to custom path
# ------------------------------------------------------------------

def test_manifest_file_override(tmp_path: Path) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    custom_path = tmp_path / "custom-manifest.json"
    model = _load_v2_fixture()
    PackWriter(pack_dir, manifest_file=custom_path).write_manifest(model)
    assert custom_path.exists()
    assert not (pack_dir / "qmd" / "repo-sources.json").exists()


# ------------------------------------------------------------------
# Test 10: idempotent update — same mutator twice produces same bytes
# ------------------------------------------------------------------


def test_idempotent_update(tmp_path: Path) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)

    def mutator(model: RepoSourcesManifestV2) -> RepoSourcesManifestV2:
        return model  # identity mutator

    writer = PackWriter(pack_dir)
    writer.update_manifest(mutator)
    first_bytes = manifest_path.read_bytes()
    writer.update_manifest(mutator)
    second_bytes = manifest_path.read_bytes()
    assert first_bytes == second_bytes


# ------------------------------------------------------------------
# Test 11: synthesis of primary_focus_area_ids from legacy repository_type=primary
# ------------------------------------------------------------------

def test_synthesis_of_primary_focus_area_ids(tmp_path: Path) -> None:
    """Legacy manifests with focus_area.repository_type='primary' synthesize primary_focus_area_ids."""
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    # Build a model with legacy repository_type-based classification, no primary_focus_area_ids
    model = RepoSourcesManifestV2(
        manifest_version="qmd-repo-sources/v2",
        manifest_status="approved",
        estate_type="monolith",
        context_pack_id="legacy-pack",
        qmd_scope_root="qmd/context-packs/legacy-pack",
        primary_focus_area_ids=[],  # empty — should be synthesized
        focusable_areas=[
            ManifestFocusableArea(
                focus_id="api",
                focus_name="API",
                focus_type="service",
                relative_path="src/api",
                repository_type="primary",
            ),
            ManifestFocusableArea(
                focus_id="core",
                focus_name="Core",
                focus_type="service",
                relative_path="src/core",
                repository_type="support",
            ),
        ],
    )
    PackWriter(pack_dir).write_manifest(model)
    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    assert "api" in raw["primary_focus_area_ids"]
    assert "core" not in raw["primary_focus_area_ids"]
    fa_by_id = {fa["focus_id"]: fa for fa in raw["focusable_areas"]}
    assert fa_by_id["api"]["repository_type"] == "primary"
    assert fa_by_id["core"]["repository_type"] == "support"


# ------------------------------------------------------------------
# Test 12: lock contention — second writer times out and raises PackWriterContended
# ------------------------------------------------------------------


def test_lock_contention_raises_after_timeout(tmp_path: Path) -> None:
    """Two PackWriter instances on the same pack: second raises PackWriterContended."""
    pack_dir, _ = _make_pack_dir(tmp_path)

    lock_held = threading.Event()
    release_signal = threading.Event()

    def hold_lock() -> None:
        writer = PackWriter(pack_dir)
        with writer._locked():
            lock_held.set()
            release_signal.wait(timeout=5.0)

    thread = threading.Thread(target=hold_lock, daemon=True)
    thread.start()
    # Wait until the first writer actually holds the lock
    assert lock_held.wait(timeout=2.0), "First writer never acquired the lock"

    # Second writer with very short timeout — must fail immediately
    writer2 = PackWriter(pack_dir)
    with pytest.raises(PackWriterContended):
        with writer2._locked(timeout=0.1):
            pass

    release_signal.set()
    thread.join(timeout=2.0)


# ------------------------------------------------------------------
# G5 crash-safety: PackWriter end-to-end. A crash between temp-file
# write and os.replace must leave the original manifest intact.
# ------------------------------------------------------------------

def test_write_manifest_crash_between_tempfile_and_replace_preserves_original(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pack_dir, manifest_path = _make_pack_dir(tmp_path)
    original_bytes = manifest_path.read_bytes()

    def _explode(*_a: object, **_kw: object) -> None:
        raise OSError("simulated crash mid-write")

    # PackWriter -> pack_io.write_text_atomic -> os.replace; intercept the rename step
    # at its concrete home in repo_context_mcp/utils.py.
    from src.backend.mcp.repo_context_mcp import utils as _utils
    monkeypatch.setattr(_utils.os, "replace", _explode)

    model = _load_v2_fixture()
    # Mutate something so the would-be write differs from the original.
    assert model.repositories is not None
    model.repositories[0].repo_focus = "support"

    with pytest.raises(OSError, match="simulated crash"):
        PackWriter(pack_dir).write_manifest(model)

    assert manifest_path.read_bytes() == original_bytes, (
        "Original manifest must be intact when os.replace fails mid-write"
    )
    # Confirm no leftover *.tmp sibling pollutes the directory.
    leftovers = [p for p in manifest_path.parent.iterdir() if p.suffix == ".tmp"]
    assert leftovers == [], f"Unexpected temp file leftover: {leftovers}"


def test_write_manifest_populates_container_paths_from_mount_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    host_root = tmp_path / "host-root"
    repo_root = host_root / "api"
    repo_root.mkdir(parents=True)
    monkeypatch.setenv("REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR", str(host_root))
    monkeypatch.setenv("REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR", "/workspace")

    model = RepoSourcesManifestV2(
        manifest_version="qmd-repo-sources/v2",
        manifest_status="approved",
        estate_type="distributed",
        context_pack_id="mounted-pack",
        qmd_scope_root="qmd/context-packs/mounted-pack",
        repositories=[
            ManifestRepositoryV2(
                repo_id="api",
                repo_name="API",
                local_paths=[LocalPath(host=str(repo_root), container="/stale")],
            )
        ],
    )

    PackWriter(pack_dir).write_manifest(model)

    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    assert raw["repositories"][0]["local_paths"] == [
        {"host": str(repo_root), "container": "/workspace/api"}
    ]


def test_write_manifest_outside_mount_logs_warning_and_clears_container(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    pack_dir = tmp_path / "pack"
    pack_dir.mkdir()
    monkeypatch.setenv("REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR", str(tmp_path / "mounted"))
    monkeypatch.setenv("REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR", "/workspace")
    outside_root = tmp_path / "outside" / "api"

    model = RepoSourcesManifestV2(
        manifest_version="qmd-repo-sources/v2",
        manifest_status="approved",
        estate_type="distributed",
        context_pack_id="outside-pack",
        qmd_scope_root="qmd/context-packs/outside-pack",
        repositories=[
            ManifestRepositoryV2(
                repo_id="api",
                repo_name="API",
                local_paths=[LocalPath(host=str(outside_root), container="/stale")],
            )
        ],
    )

    with caplog.at_level("WARNING"):
        PackWriter(pack_dir).write_manifest(model)

    raw = json.loads((pack_dir / "qmd" / "repo-sources.json").read_text(encoding="utf-8"))
    assert raw["repositories"][0]["local_paths"] == [
        {"host": str(outside_root), "container": None}
    ]
    warnings = [
        record for record in caplog.records
        if getattr(record, "event", "") == "pack_writer.outside-mount-host-path"
    ]
    assert len(warnings) == 1
    assert getattr(warnings[0], "host") == str(outside_root)
