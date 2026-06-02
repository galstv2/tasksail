"""Tests for src.backend.mcp.pack_preflight (Phase 2 G1–G6)."""
from __future__ import annotations

from pathlib import Path

import pytest

from src.backend.mcp.pack_preflight import (
    CONTEXT_PACK_ID_PATTERN,
    PackPreflightRequest,
    PackPreflightValidator,
    PreflightResult,
    _is_scary_path,
)
from src.backend.mcp.pack_schemas.answers import BootstrapAnswers, BootstrapRepository

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _make_repo(repo_root: str, *, repo_id: str = "repo-a") -> BootstrapRepository:
    return BootstrapRepository(
        repo_id=repo_id,
        repo_name="Repo A",
        repo_root=repo_root,
        system_layer="backend",
        owner="",
        repo_role="",
        repository_type=None,
    )


def _make_answers(
    *,
    context_pack_id: str = "valid-pack",
    repositories: list[BootstrapRepository] | None = None,
) -> BootstrapAnswers:
    return BootstrapAnswers(
        questionnaire_version="context-pack-bootstrap/v1",
        captured_at="2026-05-09T00:00:00Z",
        context_pack_id=context_pack_id,
        estate_name="Valid Estate",
        repository_count=len(repositories or []),
        default_scope_mode="focused",
        discovery_mode="auto",
        estate_type="distributed-platform",
        repositories=repositories or [],
    )


def _make_request(
    *,
    context_pack_dir: Path,
    discovery_root: Path,
    creation_origin: str = "existing",
    confirm_overwrite: bool = False,
    allow_scary_path: bool = False,
    answers: BootstrapAnswers | None = None,
) -> PackPreflightRequest:
    return PackPreflightRequest(
        context_pack_dir=context_pack_dir,
        discovery_root=discovery_root,
        creation_origin=creation_origin,  # type: ignore[arg-type]
        confirm_overwrite=confirm_overwrite,
        allow_scary_path=allow_scary_path,
        bootstrap_answers=answers or _make_answers(),
        raw_bootstrap_answers={},
    )


def _run(req: PackPreflightRequest) -> PreflightResult:
    return PackPreflightValidator(req).run()


def _codes(result: PreflightResult, where: str = "errors") -> set[str]:
    bucket = result.errors if where == "errors" else result.warnings
    return {e.code for e in bucket}


# ---------------------------------------------------------------------------
# G1: aggregation / non-short-circuit
# ---------------------------------------------------------------------------

def test_passing_payload_emits_no_errors_or_warnings(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    pack_dir = tmp_path / "context-packs" / "valid-pack"
    pack_dir.parent.mkdir(parents=True)
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert result.ok is True
    assert result.errors == []
    assert result.warnings == []


def test_three_independent_failures_all_surface(tmp_path: Path) -> None:
    """G1 acceptance: validator does not short-circuit; all errors surface."""
    answers = _make_answers(
        context_pack_id="-bad-slug-",
        repositories=[_make_repo("/no/such/path")],
    )
    pack_dir = Path("/etc/some-pack")

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        creation_origin="existing",
        answers=answers,
    ))

    assert result.ok is False
    codes = _codes(result)
    assert "context-pack-id-invalid" in codes
    assert "path-not-found" in codes
    assert "scary-path" in codes


# ---------------------------------------------------------------------------
# G2: path checks
# ---------------------------------------------------------------------------

def test_existing_flow_typo_repo_root_emits_path_not_found(tmp_path: Path) -> None:
    answers = _make_answers(repositories=[_make_repo("/no/such/path")])
    pack_dir = tmp_path / "context-packs" / "valid-pack"
    pack_dir.parent.mkdir(parents=True)

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        creation_origin="existing",
        answers=answers,
    ))

    assert "path-not-found" in _codes(result)


def test_new_flow_unwritable_parent_emits_parent_not_writable(tmp_path: Path) -> None:
    # /dev/null/foo has /dev/null as a non-directory parent; not writable.
    answers = _make_answers(repositories=[_make_repo("/dev/null/foo")])
    pack_dir = tmp_path / "context-packs" / "valid-pack"
    pack_dir.parent.mkdir(parents=True)

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        creation_origin="new",
        answers=answers,
    ))

    assert "parent-not-writable" in _codes(result)


def test_context_pack_parent_not_writable_emits_dedicated_code(tmp_path: Path) -> None:
    answers = _make_answers(repositories=[_make_repo(str(tmp_path))])
    pack_dir = Path("/dev/null/some-pack")  # parent not writable

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
        allow_scary_path=True,  # /dev is also flagged but irrelevant for this assert
    ))

    assert "context-pack-parent-not-writable" in _codes(result)


# ---------------------------------------------------------------------------
# G3: pack collision
# ---------------------------------------------------------------------------

def test_existing_pack_without_overwrite_emits_pack_already_exists(tmp_path: Path) -> None:
    pack_dir = tmp_path / "valid-pack"
    (pack_dir / "qmd").mkdir(parents=True)
    (pack_dir / "qmd" / "repo-sources.json").write_text("{}")

    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert "pack-already-exists" in _codes(result)


def test_existing_pack_with_overwrite_downgrades_to_warning(tmp_path: Path) -> None:
    pack_dir = tmp_path / "valid-pack"
    (pack_dir / "qmd").mkdir(parents=True)
    (pack_dir / "qmd" / "repo-sources.json").write_text("{}")

    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        confirm_overwrite=True,
        answers=answers,
    ))

    assert result.ok is True
    assert "pack-already-exists" not in _codes(result)
    assert "pack-overwrite-confirmed" in _codes(result, where="warnings")


def test_empty_pack_dir_does_not_trigger_collision(tmp_path: Path) -> None:
    pack_dir = tmp_path / "valid-pack"
    pack_dir.mkdir()  # exists but empty

    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert "pack-already-exists" not in _codes(result)


def test_unrelated_files_in_pack_dir_emit_not_empty_warning(tmp_path: Path) -> None:
    pack_dir = tmp_path / "valid-pack"
    pack_dir.mkdir()
    (pack_dir / "stray.txt").write_text("hi")

    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert "context-pack-dir-not-empty" in _codes(result, where="warnings")


# ---------------------------------------------------------------------------
# G4: scary path
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/", "/tmp", "/etc/foo", "~", "C:\\Windows",
    "/Users", "/home", "/Volumes",
    "/usr/bin", "/var/log",
])
def test_scary_paths_classify_as_scary(path: str) -> None:
    is_scary, reason = _is_scary_path(path)
    assert is_scary is True, f"expected scary: {path}"
    assert reason is not None


@pytest.mark.parametrize("path", [
    "/Users/foo/code/my-pack",
    "/home/user/projects",
    "/usr/local/share/packs",
    "/var/folders/xy/abc/T/p",
    "/Library/Caches/com.example",
    "/tmp/a/b/c",
])
def test_safe_paths_do_not_classify_as_scary(path: str) -> None:
    is_scary, _reason = _is_scary_path(path)
    assert is_scary is False, f"expected safe: {path}"


def test_scary_path_with_override_downgrades_to_warning(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])

    result = _run(_make_request(
        context_pack_dir=Path("/etc/some-pack"),
        discovery_root=tmp_path,
        allow_scary_path=True,
        answers=answers,
    ))

    assert "scary-path" not in _codes(result)
    assert "scary-path-confirmed" in _codes(result, where="warnings")


# ---------------------------------------------------------------------------
# G5: slug + reserved-name
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("slug", [
    "my-pack", "valid-pack", "abc123", "x" + ("a" * 62) + "y",  # 64 chars
])
def test_valid_slugs_accepted(slug: str) -> None:
    assert CONTEXT_PACK_ID_PATTERN.match(slug)


@pytest.mark.parametrize("slug", [
    "-leading-dash", "trailing-dash-",
    "x" + ("a" * 63) + "y",  # 65 chars
    "Has-Caps", "spaces are bad", "u_score",
])
def test_invalid_slugs_rejected(slug: str) -> None:
    assert not CONTEXT_PACK_ID_PATTERN.match(slug)


@pytest.mark.parametrize("slug,expected_reason", [
    ("con", "reserved-name"),
    ("prn", "reserved-name"),
    ("aux", "reserved-name"),
    ("nul", "reserved-name"),
    ("com1", "reserved-name"),
    ("lpt9", "reserved-name"),
    # Uppercase forms fail the lowercase slug regex first; they still reject,
    # just via the slug-format branch instead of the reserved-name branch.
    ("CON", "slug-format"),
    ("PRN", "slug-format"),
])
def test_reserved_names_rejected(
    tmp_path: Path, slug: str, expected_reason: str,
) -> None:
    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(
        context_pack_id=slug,
        repositories=[_make_repo(str(repo_root))],
    )
    pack_dir = tmp_path / "context-packs" / "valid"
    pack_dir.parent.mkdir(parents=True)

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    invalid_errors = [e for e in result.errors if e.code == "context-pack-id-invalid"]
    assert any(e.details.get("reason") == expected_reason for e in invalid_errors), (
        f"slug {slug!r} expected reason {expected_reason!r}; "
        f"got {[e.details.get('reason') for e in invalid_errors]}"
    )


# ---------------------------------------------------------------------------
# G6: tool availability (Python only — git probe varies by host)
# ---------------------------------------------------------------------------

def test_python_version_check_passes_on_current_host(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])
    pack_dir = tmp_path / "context-packs" / "valid-pack"
    pack_dir.parent.mkdir(parents=True)

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert "python-version-too-old" not in _codes(result)


def test_python_version_below_floor_emits_too_old(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import types

    repo_root = tmp_path / "repo-old"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])
    pack_dir = tmp_path / "context-packs" / "old-python-pack"
    pack_dir.parent.mkdir(parents=True)

    monkeypatch.setattr(
        "src.backend.mcp.pack_preflight.sys.version_info",
        types.SimpleNamespace(major=3, minor=11),
    )

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert "python-version-too-old" in _codes(result)


def test_python_version_floor_3_12_passes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import types

    repo_root = tmp_path / "repo-floor"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])
    pack_dir = tmp_path / "context-packs" / "floor-python-pack"
    pack_dir.parent.mkdir(parents=True)

    monkeypatch.setattr(
        "src.backend.mcp.pack_preflight.sys.version_info",
        types.SimpleNamespace(major=3, minor=12),
    )

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        answers=answers,
    ))

    assert "python-version-too-old" not in _codes(result)


def test_existing_flow_does_not_require_git(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G6 acceptance: existing-flow create must not emit git-unavailable.

    Hide git from PATH for the duration of this test and confirm no git error
    surfaces under existing creation_origin.
    """
    monkeypatch.setattr("shutil.which", lambda _name: None)

    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])
    pack_dir = tmp_path / "context-packs" / "valid-pack"
    pack_dir.parent.mkdir(parents=True)

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        creation_origin="existing",
        answers=answers,
    ))

    assert "git-unavailable" not in _codes(result)


def test_new_flow_without_git_emits_git_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.backend.mcp.pack_preflight.shutil.which", lambda _name: None)

    repo_root = tmp_path / "repo-a"
    repo_root.mkdir()
    answers = _make_answers(repositories=[_make_repo(str(repo_root))])
    pack_dir = tmp_path / "context-packs" / "valid-pack"
    pack_dir.parent.mkdir(parents=True)

    result = _run(_make_request(
        context_pack_dir=pack_dir,
        discovery_root=tmp_path,
        creation_origin="new",
        answers=answers,
    ))

    assert "git-unavailable" in _codes(result)
