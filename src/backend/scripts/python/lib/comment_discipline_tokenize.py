from __future__ import annotations

import ast
import io
import json
import sys
import tokenize
from typing import Any


def _docstring_tokens(path: str, source: str) -> list[dict[str, Any]]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    tokens: list[dict[str, Any]] = []
    nodes: list[ast.AST] = [tree]
    nodes.extend(
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    )
    for node in nodes:
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if not (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
            and hasattr(first, "lineno")
            and hasattr(first, "end_lineno")
        ):
            continue
        segment = ast.get_source_segment(source, first) or first.value.value
        tokens.append(
            {
                "path": path,
                "kind": "python-docstring",
                "startLine": first.lineno,
                "endLine": first.end_lineno,
                "text": segment,
            }
        )
    return tokens


def _comment_tokens(path: str, source: str) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    raw = source.encode("utf-8")
    reader = io.BytesIO(raw).readline
    try:
        for token in tokenize.tokenize(reader):
            if token.type != tokenize.COMMENT:
                continue
            tokens.append(
                {
                    "path": path,
                    "kind": "python-comment",
                    "startLine": token.start[0],
                    "endLine": token.end[0],
                    "text": token.string,
                }
            )
    except tokenize.TokenError:
        return tokens
    return tokens


def main() -> int:
    payload = json.load(sys.stdin)
    results: list[dict[str, Any]] = []
    for item in payload:
        path = str(item["path"])
        source = str(item["content"])
        results.extend(_comment_tokens(path, source))
        results.extend(_docstring_tokens(path, source))
    json.dump(results, sys.stdout, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
