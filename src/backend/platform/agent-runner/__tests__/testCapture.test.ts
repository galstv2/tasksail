import { EventEmitter } from 'node:events';
import path from 'node:path';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalMcpPromptScope } from '../pipeline/mcpPromptContext.js';

// Inline runtime-nickname -> provider-agent-ID fixture (Copilot roster). Importing
// the provider module here collides with this file's hoisted node:fs mock.
const toProviderAgentIdFixture = (agentId: string): string => (({
  lily: 'planning-agent',
  alice: 'product-manager',
  dalton: 'software-engineer',
  'dalton-verify': 'software-engineer-verify',
  ron: 'qa',
} as Record<string, string>)[agentId] ?? agentId);
import type { FocusedRepoResult } from '../../context-pack/focusedRepo.js';

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
  getEffectiveScopeForPrimary: (
    primary: { testTarget?: { path: string; kind: 'directory' | 'file' } | null },
    globals?: { testTarget?: { path: string; kind: 'directory' | 'file' } | null },
  ) => ({
    testTarget: primary.testTarget ?? globals?.testTarget ?? undefined,
    supportTargets: [],
  }),
}));

const {
  buildTestCapturePrompt,
  collectSliceValidationCommands,
  extractValidationCommands,
  resolveTestCaptureCwd,
  runTestCapture,
} = await import('../pipeline/testCapture.js');

// Ron maps to the qa provider ID; the test capture prompt targets 'ron'.
const externalScope: ExternalMcpPromptScope = {
  runtimeToProviderAgentId: toProviderAgentIdFixture,
  registry: {
    schema_version: 1,
    external_servers: [
      {
        id: 'qa-helper',
        display_name: 'QA Helper',
        purpose: 'reviewing captured validation evidence',
        enabled: true,
        transport: 'http',
        url: 'http://localhost:8080/mcp',
      },
    ],
  },
  assignments: {
    schema_version: 1,
    assignments: [{ agent_id: 'qa', external_mcp_server_ids: ['qa-helper'] }],
  },
};

const testCapturePromptProvider = {
  instructionPathForRole: (agentId: string): string => `.github/copilot/instructions/${agentId}.instructions.md`,
  promptPathEnvVars: (): { handoffsDir: string; implStepsDir: string } => ({
    handoffsDir: 'COPILOT_HANDOFFS_DIR',
    implStepsDir: 'COPILOT_IMPL_STEPS_DIR',
  }),
};

const tempDirs: string[] = [];

function makeFocused(overrides: Partial<FocusedRepoResult> & { primaryRepoRoot: string }): FocusedRepoResult {
  const primaryRepoRoot = overrides.primaryRepoRoot;
  return {
    visibleRepoRoots: [primaryRepoRoot],
    declaredRepoRoots: [primaryRepoRoot],
    estateType: 'monolith',
    primaryRepoId: 'primary',
    selectedRepoIds: ['primary'],
    selectedFocusIds: [],
    authoritySource: 'active-task-sidecar',
    ...overrides,
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tasksail-test-capture-'));
  tempDirs.push(dir);
  return dir;
}

async function writeTaskSidecar(options: {
  repoRoot: string;
  taskId: string;
  originalRoot: string;
  worktreeRoot: string;
}): Promise<string> {
  const taskDir = path.join(options.repoRoot, 'AgentWorkSpace', 'tasks', options.taskId);
  await mkdir(taskDir, { recursive: true });
  const sidecarPath = path.join(taskDir, '.task.json');
  await writeFile(sidecarPath, JSON.stringify({
    schema_version: 2,
    taskId: options.taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [{
        originalRoot: options.originalRoot,
        worktreeRoot: options.worktreeRoot,
        worktreeBranch: `task/${options.taskId}`,
        baseCommitSha: 'abc123',
      }],
    },
    materialization: {
      strategy: 'copy',
      cloned: [],
      skipped: [],
      composeProjectName: 'tasksail-test',
    },
    frozenAt: '2025-01-01T00:00:00.000Z',
    finalizedAt: null,
    state: 'active',
  }), 'utf-8');
  return sidecarPath;
}

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

  afterEach(async () => {
    delete process.env['ComSpec'];
    delete process.env['COMSPEC'];
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns repoRoot when contextPackDir is absent', async () => {
    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
    })).resolves.toBe('/platform');
  });

  it('uses the primary repo root when context-pack targeting has no scoped or global test target', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/target-repo',
    }));
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo');
  });

  it('returns undefined when context-pack targeting has no test target and the primary repo root is missing', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/missing-target-repo',
    }));
    existsSync.mockReturnValue(false);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });

  it('uses the global test target when the anchor has no scoped test target', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink',
      testTarget: {
        path: 'tests/sink',
        kind: 'directory',
        resolvedPath: '/target-repo/tests/sink',
      },
    }));
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/tests/sink');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/tests/sink');
  });

  it('uses the parent directory when the global test target is a file', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/sink/index.ts',
      primaryFocusTargetKind: 'file',
      testTarget: {
        path: 'tests/sink/index.test.ts',
        kind: 'file',
        resolvedPath: '/target-repo/tests/sink/index.test.ts',
      },
    }));
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/tests/sink');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/tests/sink');
  });

  it('uses the Acme API test parent directory when the global test target is RoutesTests.cs', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/target-repo',
      primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
      primaryFocusTargetKind: 'file',
      testTarget: {
        path: 'services/Acme.Api.Tests/RoutesTests.cs',
        kind: 'file',
        resolvedPath: '/target-repo/services/Acme.Api.Tests/RoutesTests.cs',
      },
    }));
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/services/Acme.Api.Tests');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/services/Acme.Api.Tests');
  });

  it('returns undefined when the resolved test target folder is missing on disk', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/target-repo',
      testTarget: {
        path: 'services/sink',
        kind: 'directory',
        resolvedPath: '/target-repo/services/sink',
      },
    }));
    existsSync.mockReturnValue(false);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });

  it('returns undefined when the selected primary repo cannot be resolved', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(undefined);

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBeUndefined();
  });

  it('returns worktreeRoot when sidecar declares a binding', async () => {
    const repoRoot = await createTempDir();
    const taskId = 'task-worktree-root';
    const originalRoot = path.join(repoRoot, 'original');
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    await mkdir(originalRoot, { recursive: true });
    await mkdir(worktreeRoot, { recursive: true });
    const originalRootReal = await realpath(originalRoot);
    const worktreeRootReal = await realpath(worktreeRoot);
    const sidecarPath = await writeTaskSidecar({
      repoRoot,
      taskId,
      originalRoot,
      worktreeRoot,
    });
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: originalRootReal,
      visibleRepoRoots: [originalRootReal],
      declaredRepoRoots: [originalRootReal],
      testTarget: {
        path: '',
        kind: 'directory',
        resolvedPath: originalRootReal,
      },
    }));
    existsSync.mockImplementation((candidate: string) => candidate === sidecarPath || candidate === worktreeRootReal);

    const cwd = await resolveTestCaptureCwd({
      repoRoot,
      taskId,
      contextPackDir: path.join(repoRoot, 'context-pack'),
    });

    expect(cwd).toBe(worktreeRootReal);
    expect(cwd).toContain(worktreeRootReal);
    expect(cwd).not.toContain(originalRootReal);
  });

  it('uses the injected primary worktree root when no explicit test target exists', async () => {
    const repoRoot = await createTempDir();
    const taskId = 'task-worktree-root-fallback';
    const originalRoot = path.join(repoRoot, 'original');
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    await mkdir(originalRoot, { recursive: true });
    await mkdir(worktreeRoot, { recursive: true });
    const originalRootReal = await realpath(originalRoot);
    const worktreeRootReal = await realpath(worktreeRoot);
    const sidecarPath = await writeTaskSidecar({
      repoRoot,
      taskId,
      originalRoot,
      worktreeRoot,
    });
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: originalRootReal,
      visibleRepoRoots: [originalRootReal],
      declaredRepoRoots: [originalRootReal],
    }));
    existsSync.mockImplementation((candidate: string) => (
      candidate === sidecarPath || candidate === worktreeRootReal
    ));

    const cwd = await resolveTestCaptureCwd({
      repoRoot,
      taskId,
      contextPackDir: path.join(repoRoot, 'context-pack'),
    });

    expect(cwd).toBe(worktreeRootReal);
    expect(cwd).toContain(worktreeRootReal);
    expect(cwd).not.toContain(originalRootReal);
  });

  it('appends primaryFocusRelativePath against worktreeRoot', async () => {
    const repoRoot = await createTempDir();
    const taskId = 'task-worktree-focus';
    const originalRoot = path.join(repoRoot, 'original');
    const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const worktreeFocus = path.join(worktreeRoot, 'src', 'feature');
    await mkdir(originalRoot, { recursive: true });
    await mkdir(worktreeFocus, { recursive: true });
    const originalRootReal = await realpath(originalRoot);
    const worktreeRootReal = await realpath(worktreeRoot);
    const worktreeFocusReal = await realpath(worktreeFocus);
    const sidecarPath = await writeTaskSidecar({
      repoRoot,
      taskId,
      originalRoot,
      worktreeRoot,
    });
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: originalRootReal,
      visibleRepoRoots: [originalRootReal],
      declaredRepoRoots: [originalRootReal],
      primaryFocusRelativePath: 'src/feature',
      primaryFocusTargetKind: 'directory',
      testTarget: {
        path: 'src/feature',
        kind: 'directory',
        resolvedPath: path.join(originalRootReal, 'src', 'feature'),
      },
    }));
    existsSync.mockImplementation((candidate: string) => (
      candidate === sidecarPath || candidate === worktreeFocusReal
    ));

    const cwd = await resolveTestCaptureCwd({
      repoRoot,
      taskId,
      contextPackDir: path.join(repoRoot, 'context-pack'),
    });

    expect(cwd).toBe(worktreeFocusReal);
    expect(cwd).toContain(worktreeRootReal);
    expect(cwd).not.toContain(originalRootReal);
  });

  it('preserves originalRoot when no sidecar exists', async () => {
    const repoRoot = await createTempDir();
    const taskId = 'task-no-sidecar';
    const originalRoot = path.join(repoRoot, 'original');
    const originalFocus = path.join(originalRoot, 'src', 'feature');
    await mkdir(originalFocus, { recursive: true });
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: originalRoot,
      primaryFocusRelativePath: 'src/feature',
      primaryFocusTargetKind: 'directory',
      testTarget: {
        path: 'src/feature',
        kind: 'directory',
        resolvedPath: originalFocus,
      },
    }));
    existsSync.mockImplementation((candidate: string) => candidate === originalFocus);

    await expect(resolveTestCaptureCwd({
      repoRoot,
      taskId,
      contextPackDir: path.join(repoRoot, 'context-pack'),
    })).resolves.toBe(originalFocus);
  });

  it('uses the anchor scoped test target instead of a global test target', async () => {
    resolveSelectedPrimaryRepoRoot.mockResolvedValue(makeFocused({
      primaryRepoRoot: '/target-repo',
      primaryFocusTargets: [
        {
          path: 'apps/api',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'apps/api/scoped-tests', kind: 'directory' },
        },
        {
          path: 'apps/web',
          kind: 'directory',
          role: 'primary',
          testTarget: { path: 'apps/web/scoped-tests', kind: 'directory' },
        },
      ],
      testTarget: {
        path: 'tests/global',
        kind: 'directory',
        resolvedPath: '/target-repo/tests/global',
      },
    }));
    existsSync.mockImplementation((candidate: string) => candidate === '/target-repo/apps/api/scoped-tests');

    await expect(resolveTestCaptureCwd({
      repoRoot: '/platform',
      taskId: 'task-1',
      contextPackDir: '/context-pack',
    })).resolves.toBe('/target-repo/apps/api/scoped-tests');
  });
});

describe('buildTestCapturePrompt', () => {
  it('puts a mandatory artifact-first QA contract in the launch prompt', () => {
    const prompt = buildTestCapturePrompt([
      { command: 'dotnet test', exitCode: 1, stdout: '', stderr: 'Routes.cs: No such file', timedOut: false },
    ], testCapturePromptProvider);

    expect(prompt).toContain('## Mandatory QA Output Contract');
    expect(prompt).toContain('read `.github/copilot/instructions/qa.instructions.md`');
    expect(prompt).toContain('## QA Artifact Checklist');
    expect(prompt).toContain('For concrete artifact paths and branch evidence');
    expect(prompt).toContain('Your chat response is not closeout');
    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/issues.md');
    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/retrospective-input.md');
    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/final-summary.md');
    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/code-changes.diff');
    expect(prompt).toContain('$COPILOT_IMPL_STEPS_DIR/slice-*.md');
    expect(prompt).toContain('This QA launch is non-interactive');
    expect(prompt).toContain('You will not receive follow-up input');
    expect(prompt).toContain('Do not finish with a prose-only QA verdict');
    expect(prompt).toContain('No generated requirement line may remain `pending`');
    expect(prompt).toContain('Set `## QA Status` to exactly `passed` or `issues-found`');
    expect(prompt).toContain('A missing required source file or failed grep is blocking');
    expect(prompt).toContain('Partial handler, route, or file coverage is blocking');
    expect(prompt).toContain('TASKSAIL_TASK_WORKTREES_FILE');
    expect(prompt).toContain('TASKSAIL_TASK_BRANCHES_FILE');
    expect(prompt.indexOf('Write artifacts in this exact order')).toBeLessThan(prompt.indexOf('## Orchestrator Test Results'));
  });

  it('uses provider-supplied QA instruction and prompt path env references', () => {
    const prompt = buildTestCapturePrompt(
      [],
      {
        instructionPathForRole: (agentId: string) => `provider/instructions/${agentId}.md`,
        promptPathEnvVars: () => ({
          handoffsDir: 'PROVIDER_HANDOFFS_DIR',
          implStepsDir: 'PROVIDER_IMPL_STEPS_DIR',
        }),
      },
    );

    expect(prompt).toContain('read `provider/instructions/qa.md`');
    expect(prompt).toContain('$PROVIDER_HANDOFFS_DIR/issues.md');
    expect(prompt).toContain('$PROVIDER_IMPL_STEPS_DIR/slice-*.md');
    expect(prompt).not.toContain('.github/copilot/instructions/qa.instructions.md');
    expect(prompt).not.toContain('$COPILOT_HANDOFFS_DIR');
    expect(prompt).not.toContain('$COPILOT_IMPL_STEPS_DIR');
  });

  it('points Ron at readonly support context through task worktree metadata', () => {
    const prompt = buildTestCapturePrompt(
      [{ command: 'pnpm test', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }],
      testCapturePromptProvider,
      {
        estateType: 'distributed-platform',
        primaryFocusRelativePath: 'services/api',
        primaryFocusTargetKind: 'directory',
        readonlyContextRoots: [
          {
            repoLocalPath: '/repo/AgentWorkSpace/tasks/task-1/worktrees/docs',
            path: '',
            kind: 'directory',
            reason: 'support-repo',
          },
        ],
      },
    );

    expect(prompt).toContain('/repo/AgentWorkSpace/tasks/task-1/worktrees/docs/');
    expect(prompt).toContain('support context appears there without branch metadata');
    expect(prompt).not.toContain('/repo/live/docs');
  });

  it('adds Ron-scoped external MCP guidance when matching servers exist', () => {
    const prompt = buildTestCapturePrompt(
      [{ command: 'pnpm test', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }],
      testCapturePromptProvider,
      { primaryFocusRelativePath: 'services/sink' },
      externalScope,
    );

    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('Use the primary focus as the review starting point');
    expect(prompt).not.toContain('primary implementation scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('"QA Helper" may help with reviewing captured validation evidence');
    expect(prompt).toContain('## Orchestrator Test Results');
  });

  it('omits the MCP block when only non-Ron servers are available', () => {
    const prompt = buildTestCapturePrompt(
      [{ command: 'pnpm test', exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }],
      testCapturePromptProvider,
      undefined,
      {
        runtimeToProviderAgentId: toProviderAgentIdFixture,
        registry: {
          schema_version: 1,
          external_servers: [
            {
              id: 'dalton-only',
              display_name: 'Dalton Only',
              purpose: 'implementation work',
              enabled: true,
              transport: 'http',
              url: 'http://localhost:8080/mcp',
            },
          ],
        },
        assignments: {
          schema_version: 1,
          assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['dalton-only'] }],
        },
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

  it.each([
    ['trailing fence whitespace', '## Validation Commands\n\n```bash \nmake build\n```\n', ['make build']],
    ['tilde fence', '## Validation Commands\n\n~~~\nmake build\n~~~\n', ['make build']],
    ['shebang line', '## Validation Commands\n\n```\n#!/usr/bin/env bash\nmake build\n```\n', ['#!/usr/bin/env bash', 'make build']],
    ['comment line', '## Validation Commands\n\n```\n# comment\nmake build\n```\n', ['make build']],
    ['continuation line', '## Validation Commands\n\n```\nmake build && \\\nmake test\n```\n', ['make build && make test']],
    ['crlf endings', '## Validation Commands\r\n\r\n```\r\nmake build\r\n```\r\n', ['make build']],
  ])('extracts commands from %s', (_name, markdown, expected) => {
    expect(extractValidationCommands(markdown)).toEqual(expected);
  });

  it('ignores heading-like lines inside earlier fenced blocks while resolving the semantic section', () => {
    const commands = extractValidationCommands(
      [
        '## Acceptance and Validation',
        '',
        '```',
        '## Validation Commands',
        'not a real validation section',
        '```',
        '',
        '### Validation Commands',
        '',
        '```bash',
        'make build',
        '```',
      ].join('\n'),
    );

    expect(commands).toEqual(['make build']);
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
    // Windows cleanup must kill the whole cmd.exe tree via taskkill, not just
    // the shell, so npx/tsx descendants do not survive.
    expect(spawn).toHaveBeenCalledWith(
      'taskkill.exe',
      expect.arrayContaining(['/T', '/F']),
      expect.anything(),
    );
  });
});

describe('collectSliceValidationCommands — XML format', () => {
  const XML_SLICE_WITH_COMMANDS = `<?xml version="1.0" encoding="UTF-8"?>
<executionSlice id="slice-1" version="1.0">
  <acceptanceAndValidation>
    <validationCommands><![CDATA[
\`\`\`bash
pnpm test
pnpm lint
\`\`\`
    ]]></validationCommands>
  </acceptanceAndValidation>
</executionSlice>`;

  const XML_SLICE_NO_COMMANDS = `<?xml version="1.0" encoding="UTF-8"?>
<executionSlice id="slice-1" version="1.0">
  <acceptanceAndValidation>
    <validationCommands><![CDATA[
<!-- no commands -->
    ]]></validationCommands>
  </acceptanceAndValidation>
</executionSlice>`;

  it('extracts commands from XML validationCommands CDATA', async () => {
    const dir = await createTempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'slice-1.xml'), XML_SLICE_WITH_COMMANDS, 'utf-8');

    const commands = await collectSliceValidationCommands(dir, 'xml');
    expect(commands).toEqual(['pnpm test', 'pnpm lint']);
  });

  it('returns empty array when XML validationCommands has no commands', async () => {
    const dir = await createTempDir();
    await writeFile(path.join(dir, 'slice-1.xml'), XML_SLICE_NO_COMMANDS, 'utf-8');

    const commands = await collectSliceValidationCommands(dir, 'xml');
    expect(commands).toEqual([]);
  });

  it('markdown collectSliceValidationCommands remains behavior-equivalent', async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, 'slice-1.md'),
      '## Validation Commands\n\n```bash\npnpm test\n```\n',
      'utf-8',
    );

    const commands = await collectSliceValidationCommands(dir, 'markdown');
    expect(commands).toEqual(['pnpm test']);
  });

  it('buildTestCapturePrompt uses slice-*.xml glob when format is xml', () => {
    const prompt = buildTestCapturePrompt([], testCapturePromptProvider, undefined, undefined, undefined, 'xml');
    expect(prompt).toContain('$COPILOT_IMPL_STEPS_DIR/slice-*.xml');
    expect(prompt).not.toContain('$COPILOT_IMPL_STEPS_DIR/slice-*.md');
  });

  it('buildTestCapturePrompt uses slice-*.md glob when format is markdown (behavior-equivalent)', () => {
    const prompt = buildTestCapturePrompt([], testCapturePromptProvider, undefined, undefined, undefined, 'markdown');
    expect(prompt).toContain('$COPILOT_IMPL_STEPS_DIR/slice-*.md');
    expect(prompt).not.toContain('$COPILOT_IMPL_STEPS_DIR/slice-*.xml');
  });
});
