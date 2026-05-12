"""Shared infrastructure for live pipeline E2E tests.

Provides constants, Docker helpers, context-pack activation, workspace
management, and a base test class for production-mirroring live E2E
pipeline tests.

Isolation contract: live E2E tests never touch the real repo's mutable
workspace. Each test class scaffolds an isolated temp directory shaped
like a TaskSail repo root (read-only source/config symlinked in, fresh
empty mutable dirs, and a `.git/` marker so platform code's `findRepoRoot()`
halts inside the temp tree). All platform CLI invocations either pass
`--repo-root <test_repo_root>` or run with `cwd=test_repo_root` so writes
land in the temp tree, not the real repo.

Caveat: the docker-compose service definition uses path-relative volume
mounts that resolve from the compose file's directory and therefore still
bind the real repo's `AgentWorkSpace/dropbox` and (by default)
`AgentWorkSpace/qmd`. The qmd mount is redirected here via the
`REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR` env override; the dropbox mount
is hardcoded in compose and is left as a follow-up. In practice the MCP
service does not write to dropbox, so this is observational only.
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
COMPOSE_FILE = REPO_ROOT / 'runtime' / 'docker' / 'compose' / 'docker-compose.yml'
HEALTHCHECK_CLI = REPO_ROOT / "src" / "backend" / "platform" / "container" / "cli.ts"
CONTEXT_PACK_CLI = REPO_ROOT / "src" / "backend" / "platform" / "context-pack" / "cli.ts"
AGENT_RUNNER_CLI = REPO_ROOT / "src" / "backend" / "platform" / "agent-runner" / "cli.ts"
WORKFLOW_POLICY_CLI = REPO_ROOT / "src" / "backend" / "platform" / "workflow-policy" / "cli.ts"
QUEUE_CLI = REPO_ROOT / "src" / "backend" / "platform" / "queue" / "cli.ts"

_AGENT_TIMEOUT_BUFFER_S = 60  # extra headroom beyond the wrapper's wall-clock limit

# Top-level entries to expose into the test repo root via symlinks. Anything
# platform code reads from disk but never writes goes here. Missing entries
# are skipped silently — the live test gate is the authority on completeness.
_REPO_ROOT_SYMLINKS = (
    "src",
    "node_modules",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
    "runtime",
    "config",
    ".github",
)


def tsx_cmd(script: Path, *args: str) -> list[str]:
    """Run TypeScript entrypoints through the repo-local tsx binary."""
    return ["npx", "tsx", str(script), *args]


def _scaffold_isolated_repo_root(prefix: str = "tasksail-e2e-repo-") -> tempfile.TemporaryDirectory[str]:
    """Create a temp directory shaped like a TaskSail repo root for live E2E tests.

    Symlinks read-only repo content into the temp root, creates fresh mutable
    workspace directories, and drops an empty `.git/` marker so platform code
    that walks up looking for the repo root halts inside the temp tree.

    Returns the TemporaryDirectory object so the caller can hold it for
    automatic cleanup. The absolute path is available via `.name`.
    """
    tmp = tempfile.TemporaryDirectory(prefix=prefix)
    root = Path(tmp.name)

    for name in _REPO_ROOT_SYMLINKS:
        source = REPO_ROOT / name
        if source.exists() or source.is_symlink():
            os.symlink(source, root / name)

    # findRepoRoot() halts on a `.git` directory; an empty marker is sufficient.
    (root / ".git").mkdir()

    agent_ws = root / "AgentWorkSpace"
    agent_ws.mkdir()
    for sub in ("dropbox", "pendingitems", "tasks", "error-items", "qmd"):
        (agent_ws / sub).mkdir()
    # Templates are canonical read-only fixtures — symlink, do not copy.
    os.symlink(REPO_ROOT / "AgentWorkSpace" / "templates", agent_ws / "templates")

    (root / ".platform-state").mkdir()

    return tmp


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
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['docker', 'compose', '-f', str(COMPOSE_FILE), *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=timeout,
        env=env,
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
    _test_repo_root_obj: tempfile.TemporaryDirectory[str] | None = None
    _first_failure: str | None = None
    context_pack_dir: str
    crud_app_dir: str

    # Per-class isolated repo root + path constants. Populated in setUpClass via
    # _setup_test_repo_root() before any helper that reads or writes them runs.
    test_repo_root: Path
    HANDOFFS: Path
    PENDING: Path
    DROPBOX: Path
    IMPL_STEPS: Path
    ERROR_ITEMS: Path
    QMD: Path
    GUARDRAIL_RECEIPTS: Path
    CONVENTIONS_STATE: Path
    PARALLEL_RUNTIME: Path

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
    def _setup_test_repo_root(cls) -> None:
        """Scaffold an isolated repo root and bind path constants to it."""
        cls._test_repo_root_obj = _scaffold_isolated_repo_root()
        root = Path(cls._test_repo_root_obj.name)
        cls.test_repo_root = root
        agent_ws = root / "AgentWorkSpace"
        runtime = root / ".platform-state" / "runtime"
        cls.HANDOFFS = agent_ws / "handoffs"
        cls.PENDING = agent_ws / "pendingitems"
        cls.DROPBOX = agent_ws / "dropbox"
        cls.IMPL_STEPS = agent_ws / "ImplementationSteps"
        cls.ERROR_ITEMS = agent_ws / "error-items"
        cls.QMD = agent_ws / "qmd"
        cls.GUARDRAIL_RECEIPTS = runtime / "guardrails"
        cls.CONVENTIONS_STATE = runtime / "conventions"
        cls.PARALLEL_RUNTIME = runtime / "parallel"

    @classmethod
    def setUpClass(cls) -> None:
        if not shutil.which('docker'):
            raise unittest.SkipTest("docker not found in PATH")
        if not shutil.which("copilot"):
            raise unittest.SkipTest("copilot CLI not found in PATH")
        if not shutil.which("timeout") and not shutil.which("gtimeout"):
            raise unittest.SkipTest(
                "timeout/gtimeout not found — brew install coreutils",
            )

        cls._cleanup_stale_temp_workdirs()
        cls._setup_test_repo_root()

        # Seed the queue inside the isolated repo root so platform code finds
        # a valid queue layout for the rest of the test.
        cls._reset_workspace(clear_qmd=True)

        cls._tmp_dir = tempfile.TemporaryDirectory(prefix="live-e2e-")
        pack, crud = create_context_pack_with_crud(
            Path(cls._tmp_dir.name), REPO_ROOT,
        )
        cls.context_pack_dir = str(pack)
        cls.crud_app_dir = str(crud)
        cls._reset_crud_repo()
        cls._assert_clean_crud_repo()

        # Redirect the qmd mount at the temp repo root. The dropbox mount is
        # hardcoded in compose and not redirectable here — see module docstring.
        compose_env = {
            **os.environ,
            "REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR": str(cls.QMD),
        }
        result = docker_compose(
            "up", "-d", "--build",
            timeout=DOCKER_BUILD_TIMEOUT_S,
            env=compose_env,
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
        if cls.QMD.is_dir():
            for entry in cls.QMD.iterdir():
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
                cwd=cls.test_repo_root,
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
        for pattern in ("live-e2e-*", "tasksail-e2e-repo-*"):
            for path in temp_root.glob(pattern):
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
        """Fully reset the isolated AgentWorkSpace to a clean pre-task state."""
        kill_orphan_agents()

        # Remove stale queue, dropbox, and slices. QMD is only cleared at
        # test startup so operators can inspect archive output after completion.
        workspace_dirs = [cls.PENDING, cls.DROPBOX, cls.IMPL_STEPS, cls.ERROR_ITEMS]
        if clear_qmd:
            workspace_dirs.append(cls.QMD)
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
        runtime_dir = cls.test_repo_root / ".platform-state" / "runtime"
        if runtime_dir.is_dir():
            for entry in runtime_dir.iterdir():
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                elif entry.is_file():
                    entry.unlink()

        subprocess.run(
            tsx_cmd(
                QUEUE_CLI,
                "init",
                "--reset",
                "--force",
                "--repo-root", str(cls.test_repo_root),
            ),
            cwd=cls.test_repo_root,
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
            if getattr(cls, "test_repo_root", None) is not None:
                cls._reset_workspace()
                cls._clear_context_pack_workspace()
        finally:
            if cls._docker_started:
                docker_compose("down", timeout=60)
            if cls._tmp_dir is not None:
                cls._tmp_dir.cleanup()
            if cls._test_repo_root_obj is not None:
                cls._test_repo_root_obj.cleanup()

    def tearDown(self) -> None:
        kill_orphan_agents()

    # ---- helpers --------------------------------------------------------

    @classmethod
    def _activate_context_pack(cls) -> None:
        activate = subprocess.run(
            tsx_cmd(CONTEXT_PACK_CLI, "activate", "--context-pack-dir", cls.context_pack_dir),
            cwd=cls.test_repo_root,
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
            cwd=cls.test_repo_root,
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
            cwd=cls.test_repo_root,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    def _run_pipeline(self, *, start_at: str) -> subprocess.CompletedProcess[str]:
        """Run the production pipeline CLI from the requested agent onward."""
        proc = subprocess.Popen(
            tsx_cmd(AGENT_RUNNER_CLI, "pipeline", "--start-at", start_at),
            cwd=self.test_repo_root,
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
            tsx_cmd(WORKFLOW_POLICY_CLI, "--root", str(self.test_repo_root), *args),
            cwd=self.test_repo_root,
            text=True,
            capture_output=True,
        )
