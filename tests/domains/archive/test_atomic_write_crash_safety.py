"""QMD writes use temp-file + os.replace for crash safety.

Asserts that simulating an exception between the temp-file write and os.replace
leaves the final QMD destination path untouched, so a crash mid-write cannot
produce a torn or zero-byte QMD record.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


class TestAtomicWriteCrashSafety:
    """Crash-safety contract: exception between temp-write and rename must leave dest untouched."""

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

        with patch("os.replace", side_effect=OSError("Simulated crash during replace")):
            with pytest.raises(OSError):
                write_text_atomic(dest, '{"status": "filed"}')

        assert not dest.exists(), (
            "Production write_text_atomic must leave dest untouched on rename failure."
        )
