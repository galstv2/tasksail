"""In-process HTTP handler test harness — NO REAL SOCKETS.

POLICY: Tests MUST NOT open real TCP sockets, bind ports, or spawn
HTTPServer instances.  See tests/conftest.py for the runtime guard.

WHY:

1. Speed — Real-server tests paid ~500ms+ per suite in startup, shutdown,
   and poll_interval latency.  The in-process approach runs the same handler
   code in <0.1s with zero I/O wait.

2. Reliability — Port conflicts, TIME_WAIT collisions, and thread teardown
   races caused flaky CI failures.  BytesIO streams eliminate all of that.

3. Determinism — No background threads means no interleaving.  Each call()
   invocation is a synchronous function call that returns a fully-formed
   Response, so assertions are never racing against in-flight I/O.

HOW IT WORKS:

BaseHTTPRequestHandler reads from self.rfile and writes to self.wfile,
both created by StreamRequestHandler.setup() from self.request (the
socket).  FakeSocket replaces the real socket:

  - makefile('rb')  -> BytesIO containing the raw HTTP request bytes
  - sendall(data)   -> appends response bytes to an internal buffer
                       (Python >=3.13 uses _SocketWriter which calls
                       sendall() directly instead of makefile('wb'))
  - makefile('wb')  -> _NonClosingBytesIO (fallback for older Pythons)

call() builds a raw HTTP/1.1 request, instantiates the handler with a
FakeSocket, and parses the response via http.client.HTTPResponse.
Tests see a Response object with .status, .headers, .json(), .text().

TO ADD NEW HTTP HANDLER TESTS: import call() and Response from this
module.  Never import HTTPServer, never bind a port.
"""

from __future__ import annotations

import http.client
import io
import json


class _NonClosingBytesIO(io.BytesIO):
    """BytesIO that ignores close() so response data survives handler finish().

    StreamRequestHandler.finish() calls self.wfile.close(). If we let
    that happen, the response bytes are discarded before we can read them.
    """

    def close(self) -> None:
        pass


class FakeSocket:
    """Minimal socket stand-in for StreamRequestHandler.setup().

    setup() calls self.request.makefile('rb') for rfile and
    self.request.makefile('wb') for wfile. It may also call
    settimeout() and setsockopt() depending on handler configuration.
    """

    def __init__(self, request_data: bytes) -> None:
        self._input = io.BytesIO(request_data)
        self._output = _NonClosingBytesIO()

    def makefile(self, mode: str, bufsize: int = -1):  # noqa: ARG002
        if "r" in mode:
            return self._input
        return self._output

    def sendall(self, data: bytes) -> None:
        """Python 3.13+ _SocketWriter calls sendall instead of makefile('wb')."""
        self._output.write(data)

    def settimeout(self, timeout: float | None) -> None:  # noqa: ARG002
        pass

    def setsockopt(self, *args: object) -> None:  # noqa: ARG002
        pass


class FakeServer:
    """Minimal server stand-in for BaseHTTPRequestHandler.__init__."""

    server_name = "localhost"
    server_port = 8811


class Response:
    """Parsed HTTP response with convenient accessors."""

    def __init__(self, raw: http.client.HTTPResponse) -> None:
        self.status = raw.status
        self.code = raw.status
        self.headers = raw.msg
        self._body = raw.read()

    def text(self) -> str:
        return self._body.decode("utf-8")

    def json(self) -> dict:
        return json.loads(self._body.decode("utf-8"))


def build_request(
    method: str,
    path: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> bytes:
    """Serialize an HTTP/1.1 request to raw bytes."""
    lines = [f"{method} {path} HTTP/1.1", "Host: localhost"]
    body_bytes = body or b""
    if body is not None:
        lines.append(f"Content-Length: {len(body_bytes)}")
    if headers:
        for key, value in headers.items():
            lines.append(f"{key}: {value}")
    return ("\r\n".join(lines) + "\r\n\r\n").encode() + body_bytes


def call(
    handler_class: type,
    method: str,
    path: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    """Invoke *handler_class* in-process and return a parsed response.

    No TCP connection is opened. The handler reads from and writes to
    BytesIO streams, and the response is parsed via http.client.HTTPResponse.
    """
    request_data = build_request(method, path, body, headers)
    sock = FakeSocket(request_data)

    # BaseHTTPRequestHandler.__init__ calls setup() -> handle() -> finish()
    # synchronously. After returning, the response bytes are in sock._output.
    handler_class(sock, ("127.0.0.1", 0), FakeServer())

    # Parse response bytes through http.client.HTTPResponse.
    sock._output.seek(0)
    response_sock = FakeSocket(sock._output.read())
    resp = http.client.HTTPResponse(response_sock)
    resp.begin()
    return Response(resp)
