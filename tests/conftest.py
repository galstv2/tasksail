"""Pytest conftest — suite-wide guards and fixtures.

SOCKET GUARD
------------
This test suite must never open real TCP sockets.  HTTP handler tests use
the _FakeSocket / BytesIO in-process harness (see test_repo_context_http_transport.py
and test_repo_context_request_id.py for the full rationale).

The guard below monkey-patches socket.socket.bind so that any test that
attempts to bind a port will fail immediately with a clear message.  This
catches accidental use of HTTPServer, socketserver, or raw sockets anywhere
in the test tree.

If a future test legitimately needs real networking (e.g. an opt-in
integration test), gate it behind RUN_SLOW_TESTS and add the
``real_socket`` fixture to temporarily lift the guard for that test only.
"""

from __future__ import annotations

import os
import socket

import pytest

# ---------------------------------------------------------------------------
# Keep a reference to the real bind so we can restore it when needed.
# ---------------------------------------------------------------------------
_real_socket_bind = socket.socket.bind


def _guarded_bind(self: socket.socket, address: object) -> None:
    """Fail-fast if any test tries to bind a real socket."""
    raise RuntimeError(
        "Tests must not bind real sockets.  Use the _FakeSocket in-process "
        "harness instead.  If this is an opt-in integration test, apply the "
        "'real_socket' fixture to temporarily allow real networking."
    )


# ---------------------------------------------------------------------------
# Install the guard at import time so it covers the entire test session.
# Honour RUN_SLOW_TESTS — when set, integration tests are expected to use
# real sockets, so skip the glopml patch entirely.
# ---------------------------------------------------------------------------
if not os.environ.get("RUN_SLOW_TESTS"):
    socket.socket.bind = _guarded_bind  # type: ignore[assignment]


@pytest.fixture()
def real_socket():
    """Temporarily restore real socket.bind for a single test.

    Usage::

        @pytest.mark.skipUnless(os.environ.get("RUN_SLOW_TESTS"), "...")
        def test_something_that_needs_a_port(real_socket):
            ...
    """
    socket.socket.bind = _real_socket_bind  # type: ignore[assignment]
    try:
        yield
    finally:
        if not os.environ.get("RUN_SLOW_TESTS"):
            socket.socket.bind = _guarded_bind  # type: ignore[assignment]
