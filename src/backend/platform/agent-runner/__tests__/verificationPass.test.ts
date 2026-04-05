import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

const readImplSpec = vi.fn();
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

vi.mock('../pipeline/sequencer.js', () => ({
  readImplSpec,
}));

vi.mock('../pipeline/testCapture.js', () => ({
  collectSliceValidationCommands,
}));

describe('verification Dalton prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes the monolith focus block when building a verification prompt with a focus path', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(
      'Implement the sink endpoint.',
      ['pnpm test'],
      'services/sink',
      daltonRegistry,
    );

    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('"Verify Helper" may help with checking implementation completeness');
    expect(prompt).toContain('Primary focus path: `services/sink`');
    expect(prompt).toContain('Your launch CWD is already this folder.');
    expect(prompt).toContain('## Validation Commands');
  });

  it('preserves no-focus verification behavior when no focus path is provided', async () => {
    const { buildVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = buildVerificationDaltonPrompt(
      'Implement the sink endpoint.',
      ['pnpm test'],
    );

    expect(prompt).not.toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## Validation Commands');
  });

  it('threads the monolith focus path through resolveVerificationDaltonPrompt', async () => {
    readImplSpec.mockResolvedValue('Implement the sink endpoint.');
    collectSliceValidationCommands.mockResolvedValue(['pnpm test']);

    const { resolveVerificationDaltonPrompt } = await import('../pipeline/verificationPass.js');

    const prompt = await resolveVerificationDaltonPrompt(
      '/handoffs',
      '/implementation-steps',
      'services/sink',
      daltonRegistry,
    );

    expect(readImplSpec).toHaveBeenCalledWith('/handoffs');
    expect(collectSliceValidationCommands).toHaveBeenCalledWith('/implementation-steps');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('Primary focus path: `services/sink`');
  });
});
