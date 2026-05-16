from __future__ import annotations

import json

from src.backend.scripts.python.lib.protocol_output import (
    write_protocol_json,
    write_protocol_stderr,
    write_protocol_stdout,
)


def test_write_protocol_stdout_exact(capsys) -> None:
    write_protocol_stdout("exact text")

    captured = capsys.readouterr()
    assert captured.out == "exact text"
    assert captured.err == ""


def test_write_protocol_stderr_exact(capsys) -> None:
    write_protocol_stderr("exact error")

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "exact error"


def test_write_protocol_json_compact_default_newline(capsys) -> None:
    write_protocol_json({"ok": True, "value": 1})

    captured = capsys.readouterr()
    assert captured.out == json.dumps({"ok": True, "value": 1}) + "\n"


def test_write_protocol_json_pretty_sort_and_no_newline(capsys) -> None:
    write_protocol_json({"b": 2, "a": 1}, indent=2, sort_keys=True, trailing_newline=False)

    captured = capsys.readouterr()
    assert captured.out == '{\n  "a": 1,\n  "b": 2\n}'
