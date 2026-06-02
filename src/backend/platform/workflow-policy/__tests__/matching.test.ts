import { describe, expect, it } from 'vitest';

import { agentIdExists, COMMAND_LINE_PATTERN, normalizeAgentId } from '../matching.js';
import { copilotProvider } from '../../cli-provider/providers/copilot/index.js';

describe('COMMAND_LINE_PATTERN', () => {
  it('matches Windows-native command starters outside fenced blocks', () => {
    const commands = [
      'powershell -File scripts/check.ps1',
      'pwsh -Command Get-ChildItem',
      'cmd /c dir',
      '.\\scripts\\check.bat',
      'py -m pytest tests/domains/test_infra/test_script_lib.py',
    ];

    for (const command of commands) {
      expect(COMMAND_LINE_PATTERN.test(command)).toBe(true);
    }
  });

  it('does not treat plain prose as a command line', () => {
    expect(COMMAND_LINE_PATTERN.test('Validation should run in CI.')).toBe(false);
  });
});

describe('normalizeAgentId provider-alias mapping', () => {
  // The human-reference parser owns only the runtime alias allow-set; the
  // alias -> provider-agent-ID mapping is delegated to the active provider.
  const mapper = copilotProvider.runtimeToProviderAgentId;

  it('maps the human-reference runtime aliases through the provider mapper', () => {
    expect(normalizeAgentId('lily', mapper)).toBe('planning-agent');
    expect(normalizeAgentId('alice', mapper)).toBe('product-manager');
    expect(normalizeAgentId('dalton', mapper)).toBe('software-engineer');
    expect(normalizeAgentId('ron', mapper)).toBe('qa');
  });

  it('leaves dalton-verify unmapped: it is deliberately not a human-reference alias', () => {
    // dalton-verify is excluded from the matching alias allow-set, so a human-authored
    // "dalton-verify" reference is never normalized to a provider-agent ID here. This
    // preserves the prior behavior (the old alias map had no dalton-verify entry).
    expect(normalizeAgentId('dalton-verify', mapper)).toBe('dalton-verify');
  });

  it('passes provider-agent IDs through unchanged', () => {
    expect(normalizeAgentId('software-engineer', mapper)).toBe('software-engineer');
    expect(normalizeAgentId('software-engineer-verify', mapper)).toBe('software-engineer-verify');
    expect(normalizeAgentId('qa', mapper)).toBe('qa');
  });

  it('strips HTML comments and lowercases before alias mapping', () => {
    expect(normalizeAgentId('  LILY  ', mapper)).toBe('planning-agent');
    expect(normalizeAgentId('Dalton<!-- reviewer note -->', mapper)).toBe('software-engineer');
  });

  it('agentIdExists resolves an alias against the named team but ignores dalton-verify', () => {
    const namedAgentTeam = {
      'software-engineer': { role: 'Software Engineer', name: 'Dalton' },
    } as unknown as Parameters<typeof agentIdExists>[1];
    expect(agentIdExists('dalton', namedAgentTeam, mapper)).toBe(true);
    expect(agentIdExists('dalton-verify', namedAgentTeam, mapper)).toBe(false);
  });
});
