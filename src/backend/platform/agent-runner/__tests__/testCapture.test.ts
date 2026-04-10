import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

const existsSync = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();
const spawn = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync,
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn,
  };
});

vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveSelectedPrimaryRepoRoot,
}));

const {
  buildTestCapturePrompt,
  extractValidationCommands,
  resolveTestCaptureCwd,
  runTestCapture,
} = await import('../pipeline/testCapture.js');

const externalRegistry: ExternalMcpRegistry = {
  schema_version: 1,
  external_servers: [
    {
      id: 'qa-helper',
      display_name: 'QA Helper',
      purpose: 'reviewing captured validation evidence',
      enabled: true,
      transport: 'http',
      url: 'http://localhost:8080/mcp',
      agent_scope: { mode: 'allowlist', agent_ids: ['ron'] },
    },
  ],
};

function setPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });

  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  };
}

type MockChildProcess = EventEmitter & {
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(options?: {
  closeOnNextTick?: boolean;
  onKill?: (child: MockChildProcess, signal?: NodeJS.Signals) => void;
}): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = 4321;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = vi.fn();
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.killed = true;
    child.signalCode = signal ?? null;
    options?.onKill?.(child, signal);
    return true;
  });

  if (options?.closeOnNextTick !== false) {
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit('close', 0);
    });
  }

  return child;
}

describe('resolveTestCaptureCwd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReset();
    resolveSelectedPrimaryRepoRoot.mockReset();
    spawn.mockReset();
  });

  afterEach(() => {
    delete process.env['ComSpec'];
    delete process.env['COMSPEC'];
  });

  it('uses the platform repo root when no context pack is active', async () => {
    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
    })).resolves.toBe('/platform');
  });

  it('uses the selected primary repo root when context-pack targeting is active without a monolith focus path', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
    });

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo');
  });

  it('uses the selected monolith focus subfolder when it exists on disk', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink',
    });
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/services/sink');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/services/sink');
  });

  it('uses the parent directory when the selected focus target is a file', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink/index.ts',
      primaryFocusTargetKind: 'file',
    });
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/services/sink');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/services/sink');
  });

  it('returns undefined when the selected monolith focus subfolder is missing on disk', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink',
    });
    existsSync.mockReturnValue(false);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });

  it('returns undefined when the selected primary repo cannot be resolved', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });
});

describe('buildTestCapturePrompt', () => {
  it('adds Ron-scoped external MCP guidance when matching servers exist', () => {
    const prompt = buildTestCapturePrompt(
      [{ command: 'pnpm test', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }],
      { primaryFocusRelativePath: 'services/sink' },
      externalRegistry,
    );

    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('"QA Helper" may help with reviewing captured validation evidence');
    expect(prompt).toContain('## Orchestrator Test Results');
  });

  it('omits the MCP block when only non-Ron servers are available', () => {
    const prompt = buildTestCapturePrompt(
      [{ command: 'pnpm test', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }],
      undefined,
      {
        schema_version: 1,
        external_servers: [
          {
            id: 'dalton-only',
            display_name: 'Dalton Only',
            purpose: 'implementation work',
            enabled: true,
            transport: 'http',
            url: 'http://localhost:8080/mcp',
            agent_scope: { mode: 'allowlist', agent_ids: ['dalton'] },
          },
        ],
      },
    );

    expect(prompt).not.toContain('## External MCP Guidance');
  });
});

describe('extractValidationCommands', () => {
  it('extracts commands from the legacy Validation Commands heading', () => {
    const commands = extractValidationCommands(
      '## Validation Commands\n\n```bash\npnpm test\npnpm lint\n```\n',
    );

    expect(commands).toEqual(['pnpm test', 'pnpm lint']);
  });

  it('extracts commands from the Validation alias heading', () => {
    const commands = extractValidationCommands(
      '## Validation\n\n```bash\npnpm test\n```\n',
    );

    expect(commands).toEqual(['pnpm test']);
  });

  it('extracts commands nested under Acceptance and Validation', () => {
    const commands = extractValidationCommands(
      '## Acceptance and Validation\n\n'
      + '### Acceptance Criteria\n\n- works\n\n'
      + '### Unit Tests\n\n- covers workflow\n\n'
      + '### Validation Commands\n\n```bash\npnpm test\nnpm run smoke\n```\n',
    );

    expect(commands).toEqual(['pnpm test', 'npm run smoke']);
  });
});

describe('runTestCapture', () => {
  it('launches commands through sh on Unix platforms', async () => {
    spawn.mockImplementation(() => createMockChildProcess());

    await expect(runTestCapture(['pnpm test'], '/repo')).resolves.toHaveLength(1);

    expect(spawn).toHaveBeenCalledWith(
      'sh',
      ['-c', 'pnpm test'],
      expect.objectContaining({
        cwd: '/repo',
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('launches commands through cmd.exe on Windows platforms', async () => {
    const restorePlatform = setPlatform('win32');
    process.env['ComSpec'] = 'C:\\Windows\\System32\\cmd.exe';
    spawn.mockImplementation(() => createMockChildProcess());

    try {
      await expect(runTestCapture(['npm test'], 'C:\\repo')).resolves.toHaveLength(1);
    } finally {
      restorePlatform();
    }

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/c', 'npm test'],
      expect.objectContaining({
        cwd: 'C:\\repo',
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('avoids Unix-style negative PID process-group kills on Windows', async () => {
    const restorePlatform = setPlatform('win32');
    const controller = new AbortController();
    const processKillSpy = vi.spyOn(process, 'kill');
    const child = createMockChildProcess({
      closeOnNextTick: false,
      onKill: (currentChild) => {
        currentChild.exitCode = 1;
        currentChild.emit('close', 1);
      },
    });
    spawn.mockImplementation(() => child);

    try {
      const capture = runTestCapture(['npm test'], 'C:\\repo', 5_000, controller.signal);
      controller.abort();
      await expect(capture).resolves.toEqual([
        expect.objectContaining({
          command: 'npm test',
          timedOut: true,
        }),
      ]);
    } finally {
      restorePlatform();
      processKillSpy.mockRestore();
    }

    expect(processKillSpy).not.toHaveBeenCalledWith(-child.pid, expect.anything());
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
