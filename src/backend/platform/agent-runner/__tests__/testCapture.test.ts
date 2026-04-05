import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

const existsSync = vi.fn();
const resolveSelectedPrimaryRepoRoot = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync,
  };
});

vi.mock('../../context-pack/focusedRepo.js', () => ({
  resolveSelectedPrimaryRepoRoot,
}));

const {
  buildTestCapturePrompt,
  extractValidationCommands,
  resolveTestCaptureCwd,
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

describe('resolveTestCaptureCwd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReset();
    resolveSelectedPrimaryRepoRoot.mockReset();
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
      'services/sink',
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
