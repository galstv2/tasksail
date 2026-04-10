import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

const collectSliceValidationCommands = vi.fn();

const daltonRegistry: ExternalMcpRegistry = {
  schema_version: 1,
  external_servers: [
    {
      id: 'verify-helper',
      display_name: 'Verify Helper',
      purpose: 'checking implementation completeness',
      enabled: true,
      transport: 'http',
      url: 'http://localhost:8080/mcp',
      agent_scope: { mode: 'allowlist', agent_ids: ['dalton'] },
    },
  ],
};

vi.mock('../pipeline/testCapture.js', () => ({
  collectSliceValidationCommands,
}));

describe('verification Dalton prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a quality-focused prompt with no task context', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(['pnpm test']);

    expect(prompt).toContain('code quality verification pass');
    expect(prompt).toContain('Do NOT trust their work');
    expect(prompt).toContain('You have NO context about what the task was');
    expect(prompt).toContain('pnpm test');
    expect(prompt).not.toContain('Implementation Spec');
    expect(prompt).not.toContain('acceptance criterion');
  });

  it('includes the monolith focus block when a focus path is provided', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(
      ['pnpm test'],
      { primaryFocusRelativePath: 'services/sink' },
      daltonRegistry,
      '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z/code-changes.diff',
    );

    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('## Verification Diff File');
    expect(prompt).toContain('"Verify Helper" may help with checking implementation completeness');
    expect(prompt).toContain('Primary focus path: `services/sink/`');
    expect(prompt).toContain('/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z/code-changes.diff');
    expect(prompt).toContain('## Validation Commands');
  });

  it('uses dalton-verify prompt scoping while preserving Dalton-family MCP guidance', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(['pnpm test'], undefined, daltonRegistry);

    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('"Verify Helper" may help with checking implementation completeness');
  });

  it('preserves no-focus behavior when no focus path is provided', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(['pnpm test']);

    expect(prompt).not.toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## Validation Commands');
  });

  it('threads the focus path through resolveVerificationDaltonPrompt', async () => {
    collectSliceValidationCommands.mockResolvedValue(['pnpm test']);

    const { resolveVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = await resolveVerificationDaltonPrompt(
      '/handoffs',
      '/implementation-steps',
      { primaryFocusRelativePath: 'services/sink' },
      daltonRegistry,
      '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z/code-changes.diff',
      'The orchestrator could not stage the verification diff file.',
    );

    expect(collectSliceValidationCommands).toHaveBeenCalledWith('/implementation-steps');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('## Verification Diff File');
    expect(prompt).toContain('Primary focus path: `services/sink/`');
    expect(prompt).toContain('/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z/code-changes.diff');
    expect(prompt).toContain('Warning: The orchestrator could not stage the verification diff file.');
    expect(prompt).not.toContain('Implementation Spec');
  });

  it('returns undefined when no validation commands are found', async () => {
    collectSliceValidationCommands.mockResolvedValue([]);

    const { resolveVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = await resolveVerificationDaltonPrompt('/handoffs', '/implementation-steps');

    expect(prompt).toBeUndefined();
  });

  it('instructs Dalton to fix bugs but not style preferences', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(['dotnet test']);

    expect(prompt).toContain('Fix broken builds, failing tests, and obvious bugs');
    expect(prompt).toContain('obvious performance problems in the changed code');
    expect(prompt).toContain('Do NOT fix style preferences or refactor working code');
  });

  it('tells Dalton to start from the staged diff file and handle the empty sentinel fallback', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(
      ['pnpm test'],
      undefined,
      undefined,
      '/repo/.platform-state/runtime/verification/2026-03-26T00-00-00Z/code-changes.diff',
      'The orchestrator could not refresh the pre-verification verification diff artifact.',
    );

    expect(prompt).toContain('Start from the staged verification diff file');
    expect(prompt).toContain('open and inspect the referenced');
    expect(prompt).toContain('# No git diff available. Skip this file and scope your review to the files listed in the assigned slice.');
    expect(prompt).toContain('inspect the changed repo files manually');
  });
});
