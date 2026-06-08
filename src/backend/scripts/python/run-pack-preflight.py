#!/usr/bin/env python3
"""Run PackPreflightValidator against a context-pack create payload.

Reads the IPC create payload as JSON, normalizes the bootstrap answers,
runs every preflight gate, and prints a single-line JSON result to stdout:

    {"ok": bool, "errors": [...], "warnings": [...]}

Exit code is 0 whenever a structured result is produced (including ok=false);
exit code 1 is reserved for unexpected failures (malformed JSON, validator
crash) so the TS caller can distinguish "preflight ran and rejected" from
"preflight failed to run."

Usage:
    run-pack-preflight.py --payload-json -                  # read stdin
    run-pack-preflight.py --payload-json '<json string>'    # direct
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from lib.protocol_output import write_protocol_stdout

# Ensure the repo root is on sys.path so `src.backend.*` imports resolve.
_SCRIPT = Path(__file__).resolve()
_REPO_ROOT = _SCRIPT.parents[4]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.backend.mcp.context_estate.bootstrap_normalization import (
    normalize_bootstrap_answers,
)
from src.backend.mcp.pack.preflight import (
    PackPreflightRequest,
    PackPreflightValidator,
    PreflightError,
    PreflightResult,
)
from src.backend.mcp.pack_schemas.answers import validate_answers
from src.backend.mcp.pack_schemas.errors import PackSchemaError
from src.backend.scripts.python.lib.logging_config import configure_logging


def _resolve_path(value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return Path(value).expanduser().resolve()


def _derive_creation_origin(payload: dict[str, Any]) -> str:
    origin = payload.get("creationOrigin")
    if origin in ("existing", "new"):
        return origin
    return "new" if bool(payload.get("initGitRepos")) else "existing"


def _build_request(payload: dict[str, Any]) -> PackPreflightRequest:
    context_pack_dir = _resolve_path(payload.get("contextPackDir"), "contextPackDir")
    discovery_root = _resolve_path(payload.get("discoveryRoot"), "discoveryRoot")
    raw_bootstrap = payload.get("bootstrapAnswers")
    if not isinstance(raw_bootstrap, dict):
        raise ValueError("bootstrapAnswers must be a JSON object")

    normalized = normalize_bootstrap_answers(raw_bootstrap)
    typed = validate_answers(normalized)

    return PackPreflightRequest(
        context_pack_dir=context_pack_dir,
        discovery_root=discovery_root,
        creation_origin=_derive_creation_origin(payload),
        confirm_overwrite=bool(payload.get("confirmOverwrite", False)),
        allow_scary_path=bool(payload.get("allowScaryPath", False)),
        bootstrap_answers=typed,
        raw_bootstrap_answers=normalized,
    )


def _payload_malformed(message: str, details: dict[str, Any] | None = None) -> PreflightResult:
    return PreflightResult(
        ok=False,
        errors=[PreflightError(
            code="payload-malformed",
            field=None,
            message=message,
            details=details or {},
        )],
        warnings=[],
    )


def _read_payload(arg: str) -> str:
    if arg == "-":
        return sys.stdin.read()
    return arg


def main() -> int:
    configure_logging(stack="py", service="run-pack-preflight")
    parser = argparse.ArgumentParser(
        description="Validate a context-pack create payload before any disk write.",
    )
    parser.add_argument(
        "--payload-json",
        required=True,
        help="JSON string with the create payload, or '-' to read from stdin.",
    )
    args = parser.parse_args()

    raw = _read_payload(args.payload_json)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        write_protocol_stdout(str(json.dumps(_payload_malformed(
            f"Failed to parse payload JSON: {exc}",
            details={"error": str(exc)},
        ).to_dict())) + '\n')
        return 0

    if not isinstance(payload, dict):
        write_protocol_stdout(str(json.dumps(_payload_malformed("payload must be a JSON object").to_dict())) + '\n')
        return 0

    try:
        request = _build_request(payload)
    except PackSchemaError as exc:
        write_protocol_stdout(str(json.dumps(_payload_malformed(
            "Bootstrap answers failed schema validation.",
            details={"errors": list(exc.errors)},
        ).to_dict())) + '\n')
        return 0
    except (ValueError, TypeError) as exc:
        write_protocol_stdout(str(json.dumps(_payload_malformed(str(exc)).to_dict())) + '\n')
        return 0

    try:
        result = PackPreflightValidator(request).run()
    except Exception as exc:
        # Validator should never raise; if it does, treat it as a hard failure
        # so the TS caller can distinguish from "ran and produced result".
        write_protocol_stdout(str(json.dumps({"status": "error", "error": str(exc)})) + '\n')
        return 1

    write_protocol_stdout(str(json.dumps(result.to_dict())) + '\n')
    return 0


if __name__ == "__main__":
    sys.exit(main())
