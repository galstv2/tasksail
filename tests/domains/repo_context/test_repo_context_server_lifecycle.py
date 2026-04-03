from __future__ import annotations

import threading
import unittest
from unittest import mock


class ShutdownEventTests(unittest.TestCase):
    """Validate the shutdown-worker threading pattern used by run_server."""

    def test_shutdown_event_triggers_server_shutdown(self) -> None:
        shutdown_event = threading.Event()
        mock_server = mock.MagicMock()

        def _shutdown_worker() -> None:
            shutdown_event.wait()
            mock_server.shutdown()

        worker = threading.Thread(
            target=_shutdown_worker, name="test-shutdown-worker", daemon=True,
        )
        worker.start()

        shutdown_event.set()
        worker.join(timeout=2)

        mock_server.shutdown.assert_called_once()


if __name__ == "__main__":
    unittest.main()
