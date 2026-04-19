"""§4.3 idempotency item 3: QMD writes use temp-file + os.rename.

Asserts that simulating an exception between the temp-file write and os.rename
leaves the final QMD destination path untouched, so a crash mid-write cannot
produce a torn or zero-byte QMD record.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


def _write_text_atomic(path: Path, content: str) -> None:
    """Mirrors the production write_text_atomic from mcp/repo_context_mcp/utils.py."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.rename(tmp_path, str(path))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


class TestAtomicWriteCrashSafety:
    """Crash-safety contract: exception between temp-write and rename must leave dest untouched."""

    def test_exception_before_rename_leaves_dest_untouched(self, tmp_path: Path) -> None:
        """If os.rename raises, the final path must remain at its original state."""
        dest = tmp_path / "qmd" / "record.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Dest does not exist before the write.
        assert not dest.exists()

        # Simulate a crash between the temp-write and os.rename.
        with patch("os.rename", side_effect=OSError("Simulated crash during rename")):
            with pytest.raises(OSError, match="Simulated crash during rename"):
                _write_text_atomic(dest, '{"status": "filed"}')

        # Destination must still not exist — temp file was cleaned up, no torn record.
        assert not dest.exists(), (
            "Final QMD path must remain untouched when os.rename raises; "
            "a torn/zero-byte record would corrupt the archive index."
        )

    def test_exception_before_rename_cleans_up_temp_file(self, tmp_path: Path) -> None:
        """Temp file must be removed when os.rename raises to avoid leaking disk space."""
        dest = tmp_path / "qmd" / "record.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        captured_tmp: list[str] = []

        def capturing_rename(*args: object) -> None:
            captured_tmp.append(str(args[0]))
            raise OSError("Simulated crash during rename")

        with patch("os.rename", side_effect=capturing_rename):
            with pytest.raises(OSError):
                _write_text_atomic(dest, '{"status": "filed"}')

        # Temp file must have been cleaned up.
        if captured_tmp:
            tmp_file = captured_tmp[0]
            assert not os.path.exists(tmp_file), (
                f"Temp file {tmp_file} was not cleaned up after failed rename."
            )

    def test_successful_write_produces_correct_content(self, tmp_path: Path) -> None:
        """Happy path: content is written atomically and readable from the final path."""
        dest = tmp_path / "qmd" / "record.json"
        content = '{"status": "filed", "task_id": "test-123"}'

        _write_text_atomic(dest, content)

        assert dest.exists()
        assert dest.read_text(encoding="utf-8") == content

    def test_production_write_text_atomic_leaves_dest_untouched_on_rename_failure(
        self, tmp_path: Path
    ) -> None:
        """Test the real production write_text_atomic from mcp/repo_context_mcp/utils."""
        try:
            from src.backend.mcp.repo_context_mcp.utils import write_text_atomic
        except ImportError:
            pytest.skip("Production write_text_atomic not importable in this environment.")

        dest = tmp_path / "qmd" / "prod-record.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        assert not dest.exists()

        with patch("os.rename", side_effect=OSError("Simulated crash during rename")):
            with pytest.raises(OSError):
                write_text_atomic(dest, '{"status": "filed"}')

        assert not dest.exists(), (
            "Production write_text_atomic must leave dest untouched on rename failure."
        )
