"""Shared infrastructure for live pipeline E2E tests.

Provides constants, Docker helpers, context-pack activation, workspace
management, and a base test class for production-mirroring live E2E
pipeline tests.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.support.crud_scaffold import create_context_pack_with_crud

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE_FILE = REPO_ROOT / "docker" / "compose" / "docker-compose.yml"
HEALTHCHECK_CLI = REPO_ROOT / "src" / "backend" / "platform" / "container" / "cli.ts"
CONTEXT_PACK_CLI = REPO_ROOT / "src" / "backend" / "platform" / "context-pack" / "cli.ts"
AGENT_RUNNER_CLI = REPO_ROOT / "src" / "backend" / "platform" / "agent-runner" / "cli.ts"
WORKFLOW_POLICY_CLI = REPO_ROOT / "src" / "backend" / "platform" / "workflow-policy" / "cli.ts"
HANDOFFS = REPO_ROOT / "AgentWorkSpace" / "handoffs"
PENDING = REPO_ROOT / "AgentWorkSpace" / "pendingitems"
DROPBOX = REPO_ROOT / "AgentWorkSpace" / "dropbox"
IMPL_STEPS = REPO_ROOT / "AgentWorkSpace" / "ImplementationSteps"
ERROR_ITEMS = REPO_ROOT / "AgentWorkSpace" / "erroritems"
QMD = REPO_ROOT / "AgentWorkSpace" / "qmd"
GUARDRAIL_RECEIPTS = REPO_ROOT / ".platform-state" / "runtime" / "guardrails"
CONVENTIONS_STATE = REPO_ROOT / ".platform-state" / "runtime" / "conventions"
PARALLEL_RUNTIME = REPO_ROOT / ".platform-state" / "runtime" / "parallel"

_AGENT_TIMEOUT_BUFFER_S = 60  # extra headroom beyond the wrapper's wall-clock limit


def tsx_cmd(script: Path, *args: str) -> list[str]:
    """Run TypeScript entrypoints through the repo-local tsx binary."""
    return ["npx", "tsx", str(script), *args]

def _load_agent_timeouts() -> tuple[int, int, dict[str, int]]:
    """Load default, parallel, and per-agent test-harness timeouts from registry."""
    registry_path = REPO_ROOT / ".github" / "agents" / "registry.json"
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 300 + _AGENT_TIMEOUT_BUFFER_S, 900 + _AGENT_TIMEOUT_BUFFER_S, {}
    default_wc = registry.get("default_wall_clock_timeout_s", 300)
    parallel_wc = registry.get("parallel_wall_clock_timeout_s", 900)
    default_timeout = default_wc + _AGENT_TIMEOUT_BUFFER_S
    parallel_timeout = parallel_wc + _AGENT_TIMEOUT_BUFFER_S
    overrides: dict[str, int] = {}
    for entry in registry.get("agents", []):
        wc = entry.get("wall_clock_timeout_s")
        if isinstance(wc, int) and wc != default_wc:
            overrides[entry["agent_id"]] = wc + _AGENT_TIMEOUT_BUFFER_S
    return default_timeout, parallel_timeout, overrides

AGENT_TIMEOUT_S, PARALLEL_TIMEOUT_S, _AGENT_TIMEOUT_OVERRIDES = _load_agent_timeouts()
DOCKER_BUILD_TIMEOUT_S = 180
HEALTH_POLL_TIMEOUT_S = 120
PIPELINE_AGENT_IDS = ("alice", "dalton", "ron")


def pipeline_timeout_s() -> int:
    """Return a timeout budget for Alice -> Dalton -> Ron live pipeline runs."""
    return (
        sum(_AGENT_TIMEOUT_OVERRIDES.get(agent, AGENT_TIMEOUT_S) for agent in PIPELINE_AGENT_IDS)
        + 120
    )


def docker_compose(
    *args: str,
    timeout: int = 60,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def kill_orphan_agents() -> None:
    """Terminate lingering Copilot agent or wrapper processes by PID."""
    ps = subprocess.run(
        ["ps", "-axo", "pid=,command="],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    if ps.returncode != 0:
        return

    current_pid = os.getpid()
    for line in ps.stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(None, 1)
        if len(parts) != 2:
            continue
        pid_text, command = parts
        try:
            pid = int(pid_text)
        except ValueError:
            continue
        if pid == current_pid:
            continue
        if not any(
            pattern in command
            for pattern in ("copilot --agent", "agent-runner/cli.ts", "agent-runner/roleAgent.ts")
        ):
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    time.sleep(0.5)


class BasePipelineTests(unittest.TestCase):
    """Shared setup, teardown, and helpers for live pipeline tests."""

    _docker_started: bool = False
    _chosen_path: str = "standard"
    _tmp_dir: tempfile.TemporaryDirectory[str] | None = None
    _first_failure: str | None = None
    context_pack_dir: str
    crud_app_dir: str

    def setUp(self) -> None:
        if self.__class__._first_failure is not None:
            self.skipTest(
                f"skipped due to earlier failure in {self.__class__._first_failure}",
            )

    def run(self, result: unittest.TestResult | None = None) -> unittest.TestResult | None:  # type: ignore[override]
        test_result = super().run(result)
        if result is not None and self.__class__._first_failure is None:
            failures = getattr(result, "failures", None)
            errors = getattr(result, "errors", None)
            if failures is not None and errors is not None:
                for test, _ in failures + errors:
                    if test is self:
                        self.__class__._first_failure = self._testMethodName
                        break
        return test_result

    @classmethod
    def setUpClass(cls) -> None:
        if not shutil.which("docker"):
            raise unittest.SkipTest("docker not found in PATH")
        if not shutil.which("copilot"):
            raise unittest.SkipTest("copilot CLI not found in PATH")
        if not shutil.which("timeout") and not shutil.which("gtimeout"):
            raise unittest.SkipTest(
                "timeout/gtimeout not found — brew install coreutils",
            )

        # Live E2E runs own the mutable workspace contract. If the workspace is
        # dirty from a prior run or manual activity, clear it before creating
        # the temp context pack so the test starts from a known-clean state.
        cls._reset_workspace(clear_qmd=True)
        cls._cleanup_stale_temp_workdirs()

        cls._tmp_dir = tempfile.TemporaryDirectory(prefix="live-e2e-")
        pack, crud = create_context_pack_with_crud(
            Path(cls._tmp_dir.name), REPO_ROOT,
        )
        cls.context_pack_dir = str(pack)
        cls.crud_app_dir = str(crud)
        cls._reset_crud_repo()
        cls._assert_clean_crud_repo()

        result = docker_compose(
            "up", "-d", "--build", timeout=DOCKER_BUILD_TIMEOUT_S,
        )
        if result.returncode != 0:
            raise unittest.SkipTest(
                f"Docker services failed to start:\n{result.stderr}",
            )
        cls._docker_started = True

        cls._wait_for_healthy()
        cls._activate_context_pack()

    @classmethod
    def _clear_qmd(cls) -> None:
        if QMD.is_dir():
            for entry in QMD.iterdir():
                if entry.name == ".gitkeep":
                    continue
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                elif entry.is_file():
                    entry.unlink()

    @classmethod
    def _wait_for_healthy(cls) -> None:
        deadline = time.monotonic() + HEALTH_POLL_TIMEOUT_S
        while time.monotonic() < deadline:
            result = subprocess.run(
                tsx_cmd(HEALTHCHECK_CLI, "healthcheck"),
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                return
            time.sleep(5)
        raise unittest.SkipTest(
            "MCP services did not become healthy within "
            f"{HEALTH_POLL_TIMEOUT_S}s",
        )

    @classmethod
    def _cleanup_stale_temp_workdirs(cls) -> None:
        temp_root = Path(tempfile.gettempdir())
        for path in temp_root.glob("live-e2e-*"):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)

    @classmethod
    def _reset_crud_repo(cls) -> None:
        reset = subprocess.run(
            ["git", "reset", "--hard", "HEAD"],
            cwd=cls.crud_app_dir,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if reset.returncode != 0:
            raise unittest.SkipTest(
                "Initial CRUD scaffold git reset failed:\n"
                f"{reset.stderr or reset.stdout}",
            )
        clean = subprocess.run(
            ["git", "clean", "-fdx"],
            cwd=cls.crud_app_dir,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if clean.returncode != 0:
            raise unittest.SkipTest(
                "Initial CRUD scaffold git clean failed:\n"
                f"{clean.stderr or clean.stdout}",
            )

    @classmethod
    def _assert_clean_crud_repo(cls) -> None:
        result = subprocess.run(
            ["git", "status", "--short"],
            cwd=cls.crud_app_dir,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if result.returncode != 0:
            raise unittest.SkipTest(
                "Initial CRUD scaffold git status failed:\n"
                f"{result.stderr or result.stdout}",
            )
        if result.stdout.strip():
            raise unittest.SkipTest(
                "Initial CRUD scaffold is dirty before the task starts:\n"
                f"{result.stdout}",
            )

    @classmethod
    def _reset_workspace(cls, *, clear_qmd: bool = False) -> None:
        """Fully reset the AgentWorkSpace to a clean pre-task state."""
        kill_orphan_agents()

        # Remove stale queue, dropbox, and slices. QMD is only cleared at
        # test startup so operators can inspect archive output after completion.
        workspace_dirs = [PENDING, DROPBOX, IMPL_STEPS, ERROR_ITEMS]
        if clear_qmd:
            workspace_dirs.append(QMD)
        for workspace_dir in workspace_dirs:
            if not workspace_dir.is_dir():
                continue
            for entry in workspace_dir.iterdir():
                if entry.name == ".gitkeep":
                    continue
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                elif entry.is_file():
                    entry.unlink()

        # Clean runtime state directories and receipts from prior runs.
        runtime_dir = REPO_ROOT / ".platform-state" / "runtime"
        if runtime_dir.is_dir():
            for entry in runtime_dir.iterdir():
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                elif entry.is_file():
                    entry.unlink()

        subprocess.run(
            tsx_cmd(
                REPO_ROOT / "src" / "backend" / "platform" / "queue" / "cli.ts",
                "init",
                "--reset",
                "--force",
            ),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        # Note: clear-failure-lock was removed — the failure lock system no
        # longer exists (see operations.test.ts). No cleanup needed.

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            kill_orphan_agents()
            cls._reset_workspace()
            cls._clear_context_pack_workspace()
        finally:
            if cls._docker_started:
                docker_compose("down", timeout=60)
            if cls._tmp_dir is not None:
                cls._tmp_dir.cleanup()

    def tearDown(self) -> None:
        kill_orphan_agents()

    # ---- helpers --------------------------------------------------------

    @classmethod
    def _activate_context_pack(cls) -> None:
        activate = subprocess.run(
            tsx_cmd(CONTEXT_PACK_CLI, "activate", "--context-pack-dir", cls.context_pack_dir),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if activate.returncode != 0:
            raise unittest.SkipTest(
                "Context pack activation failed:\n"
                f"{activate.stderr or activate.stdout}",
            )

        switch = subprocess.run(
            tsx_cmd(CONTEXT_PACK_CLI, "switch", "--apply", "--context-pack-dir", cls.context_pack_dir),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if switch.returncode != 0:
            raise unittest.SkipTest(
                "Context pack workspace sync failed:\n"
                f"{switch.stderr or switch.stdout}",
            )

    @classmethod
    def _clear_context_pack_workspace(cls) -> None:
        subprocess.run(
            tsx_cmd(CONTEXT_PACK_CLI, "switch", "--clear"),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    def _run_pipeline(self, *, start_at: str) -> subprocess.CompletedProcess[str]:
        """Run the production pipeline CLI from the requested agent onward."""
        proc = subprocess.Popen(
            tsx_cmd(AGENT_RUNNER_CLI, "pipeline", "--start-at", start_at),
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={
                **os.environ,
                "ACTIVE_CONTEXT_PACK_DIR": self.context_pack_dir,
                "RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS": "true",
                "RUN_ROLE_AGENT_ORCHESTRATOR_ID": "pipeline-sequencer",
            },
            start_new_session=True,
        )
        timeout = pipeline_timeout_s()
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            stdout, stderr = proc.communicate(timeout=10)
            raise AssertionError(
                f"pipeline timed out after {timeout}s\n"
                f"--- stdout ---\n{stdout[-2000:]}\n"
                f"--- stderr ---\n{stderr[-2000:]}"
            )
        except BaseException:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=10)
            raise
        return subprocess.CompletedProcess(
            proc.args, proc.returncode, stdout, stderr,
        )

    def _run_validator(
        self, *args: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            tsx_cmd(WORKFLOW_POLICY_CLI, "--root", str(REPO_ROOT), *args),
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )
