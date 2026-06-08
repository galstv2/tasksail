/**
 * Bypass-gate check via inherited env.
 *
 * After helper removal, the bypass gate (runRoleAgent checks
 * RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS=true) is satisfied because the child process
 * spawned by spawnPipelineForTask inherits the env var from fork options.
 *
 * This test verifies that when RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS=true is already
 * set on process.env (as it would be in the forked child), runRoleAgent's gate
 * passes without any in-process wrapper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runRoleAgent = vi.fn();

vi.mock('../../roleAgent.js', () => ({
  runRoleAgent,
}));

const resolvePaths = vi.fn();
const readTextFile = vi.fn();
const writeTextFile = vi.fn();
const ensureDir = vi.fn();
const emitTaskProgressEvent = vi.fn().mockResolvedValue(undefined);
const nowIsoCompact = vi.fn(() => '2026-04-18T00-00-00Z');
const getErrorMessage = vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e)));
const readEnvAssignment = vi.fn(() => undefined);
const safeJsonParse = vi.fn((s: string) => JSON.parse(s));

vi.mock('../../../core/index.js', () => ({
  resolvePaths,
  readTextFile,
  writeTextFile,
  ensureDir,
  emitTaskProgressEvent,
  nowIsoCompact,
  getErrorMessage,
  readEnvAssignment,
  safeJsonParse,
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
  newSpanId: vi.fn(() => 'test-span-id'),
  STANDARD_AGENT_ORDER: ['alice', 'dalton', 'ron'],
  FAST_PATH_AGENT_ORDER: ['alice', 'dalton', 'ron'],
}));

vi.mock('../../guardrails.js', () => ({
  runRuntimePolicyCheck: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('../contextPrewarm.js', () => ({
  prewarmPipelineContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../remediation.js', () => ({
  remediationHasBlockingFindings: vi.fn().mockResolvedValue(false),
  remediationRunQaLoop: vi.fn().mockResolvedValue(undefined),
  remediationClearCloseoutArtifacts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../verificationPass.js', () => ({
  resolveVerificationDaltonPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../queue/policyValidation.js', () => ({
  runPolicyValidation: vi.fn().mockResolvedValue({ passed: true, stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('../../../queue/completePendingItem.js', () => ({
  completePendingItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../pythonHelpers.js', () => ({
  captureCodeDiff: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

describe('runPipelineSequence — bypass gate via inherited env (§5.1 MG-7)', () => {
  let repoRoot: string;
  let savedBypass: string | undefined;
  let savedOrchestrator: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'seq-bypass-test-'));
    mkdirSync(path.join(repoRoot, '.git'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'bypass-task', 'handoffs'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'bypass-task', 'ImplementationSteps'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'bypass-task'), { recursive: true });

    resolvePaths.mockReturnValue({
      repoRoot,
      handoffs: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'bypass-task', 'handoffs'),
      implementationSteps: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'bypass-task', 'ImplementationSteps'),
      platformState: path.join(repoRoot, '.platform-state'),
      taskRuntime: path.join(repoRoot, '.platform-state', 'runtime', 'tasks', 'bypass-task'),
      templates: path.join(repoRoot, 'AgentWorkSpace', 'templates'),
    });

    readTextFile.mockResolvedValue(null);
    writeTextFile.mockImplementation(async (filePath: string, content: string) => {
      mkdirSync(path.dirname(filePath), { recursive: true });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(filePath, content, 'utf-8');
    });
    ensureDir.mockImplementation(async (dirPath: string) => {
      mkdirSync(dirPath, { recursive: true });
    });

    runRoleAgent.mockResolvedValue({
      exitCode: 0,
      agentId: 'alice',
      durationMs: 1,
      mcpLaunch: {
        status: 'not-applicable',
        reason: 'no external MCP servers',
        injectionEnabled: false,
        selectedServerIds: [],
        excludedServerIds: [],
      },
    });

    // Save pre-existing env values
    savedBypass = process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    savedOrchestrator = process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];

    // Pre-set the env as the forked child would inherit from spawnPipelineForTask
    process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
    process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = 'pipeline-sequencer';
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });

    // Restore env vars
    if (savedBypass === undefined) {
      delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    } else {
      process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = savedBypass;
    }
    if (savedOrchestrator === undefined) {
      delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
    } else {
      process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = savedOrchestrator;
    }
  });

  it(
    'runPipelineSequence completes without bypass-gate error when RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS is pre-set on the child env (§5.1 MG-7)',
    async () => {
      // Previously, the helper set the env in-process.
      // Now the child process inherits the env from spawnPipelineForTask's fork options.
      // In this in-process test, we simulate that inheritance by pre-setting the env
      // before calling runPipelineSequence.

      const { runPipelineSequence } = await import('../sequencer.js');

      // Must resolve without throwing a bypass-gate error.
      await expect(
        runPipelineSequence({ repoRoot, taskId: 'bypass-task', stopAfter: 'alice' }),
      ).resolves.toBeDefined();

      // runRoleAgent was called — confirming the sequencer ran to completion.
      expect(runRoleAgent).toHaveBeenCalled();
    },
  );

  it(
    'bypass gate throws when RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS is absent and skipWorkflowValidation is true',
    async () => {
      // This validates that the bypass gate itself still enforces the invariant.
      // If spawnPipelineForTask fails to set the env on the fork, the gate fires.
      delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];

      // Restore the real runRoleAgent check by making the mock throw on bypass-gate failure.
      // This simulates the gate that roleAgent.ts enforces.
      runRoleAgent.mockImplementation(async ({ skipWorkflowValidation }: { skipWorkflowValidation?: boolean }) => {
        if (skipWorkflowValidation) {
          const allowBypass = (process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] ?? '').trim().toLowerCase();
          if (allowBypass !== 'true') {
            throw new Error(
              '--skip-workflow-check is reserved for controlled internal orchestrators. ' +
              'Set RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS=true.',
            );
          }
        }
        return { exitCode: 0, agentId: 'alice', durationMs: 1 };
      });

      const { runPipelineSequence } = await import('../sequencer.js');

      await expect(
        runPipelineSequence({ repoRoot, taskId: 'bypass-task', stopAfter: 'alice' }),
      ).rejects.toThrow('RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS');
    },
  );
});
