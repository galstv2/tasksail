import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentRunError,
  ConfigError,
  ContainerError,
  ContextPackError,
  InvariantError,
  MCPError,
  QueueError,
  ValidationError,
  flushLoggers,
  runCliBoundary,
  type PlatformError,
} from '../core/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const HELPER_MANAGED_CLIS = [
  'src/backend/platform/queue/cli.ts',
  'src/backend/platform/queue/cli-repair-closeout.ts',
  'src/backend/platform/agent-runner/cli.ts',
  'src/backend/platform/context-pack/cli.ts',
  'src/backend/platform/context-pack/qmdSeedDryRun.ts',
  'src/backend/platform/workflow-policy/cli.ts',
  'src/backend/platform/validation/cli.ts',
  'src/backend/platform/container/cli.ts',
  'src/backend/platform/setup/cli.ts',
] as const;

const ERROR_CASES: Array<{
  name: string;
  error: PlatformError;
  exitCode: number;
}> = [
  {
    name: 'ValidationError',
    error: new ValidationError('bad input', { code: 'BAD_INPUT', category: 'user' }),
    exitCode: 64,
  },
  {
    name: 'ConfigError usage',
    error: new ConfigError('bad config value', { code: 'BAD_CONFIG_VALUE', category: 'user' }),
    exitCode: 64,
  },
  {
    name: 'ConfigError missing config',
    error: new ConfigError('missing config', { code: 'CONFIG_MISSING', category: 'user' }),
    exitCode: 78,
  },
  {
    name: 'ContainerError',
    error: new ContainerError('container down', { code: 'CONTAINER_DOWN', category: 'external' }),
    exitCode: 69,
  },
  {
    name: 'MCPError',
    error: new MCPError('mcp down', { code: 'MCP_DOWN', category: 'external' }),
    exitCode: 69,
  },
  {
    name: 'AgentRunError',
    error: new AgentRunError('agent failed', { code: 'AGENT_FAILED', category: 'system' }),
    exitCode: 70,
  },
  {
    name: 'QueueError',
    error: new QueueError('queue failed', { code: 'QUEUE_FAILED', category: 'system' }),
    exitCode: 70,
  },
  {
    name: 'ContextPackError',
    error: new ContextPackError('pack failed', { code: 'PACK_FAILED', category: 'system' }),
    exitCode: 70,
  },
  {
    name: 'InvariantError',
    error: new InvariantError('bug', { code: 'INVARIANT_FAILED', category: 'invariant' }),
    exitCode: 70,
  },
];

afterEach(() => {
  flushLoggers();
  vi.restoreAllMocks();
});

describe('CLI boundary integration', () => {
  it.each(ERROR_CASES)('logs and exits for $name', async ({ error, exitCode }) => {
    const logDir = mkdtempSync(path.join(tmpdir(), 'cli-boundary-'));
    const previousLogDir = process.env.LOG_DIR;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    try {
      process.env.LOG_DIR = logDir;
      runCliBoundary('platform/test/cli', async () => {
        throw error;
      });

      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(exitCode);
      });

      const line = readLastErrorLine(logDir);
      expect(line).toMatchObject({
        msg: 'cli.crash',
        err: {
          name: error.name,
          code: error.code,
          category: error.category,
        },
      });
    } finally {
      if (previousLogDir === undefined) {
        delete process.env.LOG_DIR;
      } else {
        process.env.LOG_DIR = previousLogDir;
      }
      flushLoggers();
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('helper-managed CLIs import and call runCliBoundary', () => {
    for (const relativePath of HELPER_MANAGED_CLIS) {
      const source = readRepoFile(relativePath);
      expect(source).toContain('runCliBoundary');
      expect(source).toMatch(/runCliBoundary\(\s*['"]platform\//);
    }
  });

  it('pipeline child entrypoint preserves its direct boundary contract', () => {
    const source = readRepoFile('src/backend/platform/agent-runner/pipelineChildEntry.ts');

    expect(source).toContain("installProcessHandlers('platform/agent-runner/pipelineChildEntry')");
    expect(source).toContain("log.error('pipeline.child.crash', err)");
    expect(source).toContain('writeProtocolStderr(formatPipelineChildEntryError(err))');
    expect(source).toContain('CLOSEOUT_FAILURE_EXIT_CODE');
    expect(source).toContain('_isCloseoutFailure');
  });

  it('runtime modules do not import the Python CLI entrypoint', () => {
    const runtimeSources = [
      'src/backend/platform/container/directRuntimeProcess.ts',
      'src/backend/platform/setup/setup.ts',
    ];

    for (const relativePath of runtimeSources) {
      const source = readRepoFile(relativePath);
      expect(source).toContain('../core/pythonResolver.js');
      expect(source).not.toContain('../core/pythonCli.js');
    }
  });

  it('external MCP registry preserves bridge divergence and protocol output', () => {
    const source = readRepoFile('src/backend/platform/external-mcp-registry/cli.ts');

    expect(source).toContain("runCliBoundary('platform/external-mcp-registry/cli'");
    expect(source).toContain("log.error('cli.crash', e)");
    expect(source).toContain('process.exit(2)');
    expect(source).toContain("writeProtocolStdout(JSON.stringify(result) + '\\n')");
  });
});

function readLastErrorLine(logDir: string): Record<string, unknown> {
  const errorDir = path.join(logDir, 'error');
  const fileName = readdirSync(errorDir).find((name) => name.startsWith('backend-ts-'));
  if (!fileName) {
    throw new Error('missing error log file');
  }
  const lines = readFileSync(path.join(errorDir, fileName), 'utf-8').trim().split('\n').filter(Boolean);
  return JSON.parse(lines.at(-1)!) as Record<string, unknown>;
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');
}
