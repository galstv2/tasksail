import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { AgentId } from '../../core/types.js';

const { runPython, readFile, writeTextFile } = vi.hoisted(() => ({
  runPython: vi.fn(),
  readFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('../../core/index.js', () => ({
  runPython,
  writeTextFile,
}));

vi.mock('node:fs/promises', () => ({
  readFile,
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: () => ({
    homeDirName: () => '.copilot',
    agentConfigPaths: () => ({ registry: '.github/copilot/agents/registry.json' }),
    runtimeToProviderAgentId: (agentId: string) => (({
      lily: 'planning-agent',
      alice: 'product-manager',
      dalton: 'software-engineer',
      'dalton-verify': 'software-engineer-verify',
      ron: 'qa',
    } as Record<string, string>)[agentId] ?? agentId),
  }),
}));

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
  resolvePaths: vi.fn(),
  resolvePath: vi.fn(),
  ensurePathWithinDropbox: vi.fn(),
}));

import { getActiveProvider } from '../../cli-provider/index.js';
import {
  resolveReinforcementContext,
  roleRequiresReinforcement,
} from '../reinforcement.js';

describe('roleRequiresReinforcement', () => {
  it('returns true for workflow agents', () => {
    const provider = getActiveProvider('');
    expect(roleRequiresReinforcement(provider, 'lily' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement(provider, 'alice' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement(provider, 'dalton' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement(provider, 'ron' as AgentId)).toBe(true);
  });

  it('returns false for non-workflow agents', () => {
    expect(roleRequiresReinforcement(getActiveProvider(''), 'unknown-agent' as AgentId)).toBe(false);
  });
});

describe('resolveReinforcementContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runPython.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    readFile.mockResolvedValue('# Reinforcement Context\n\n- Status: available\n');
    writeTextFile.mockResolvedValue(undefined);
  });

  it('renders canonical runtime markdown through the Python renderer', async () => {
    const result = await resolveReinforcementContext(
      'dalton' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    const renderedPath = path.join(
      '/fake/repo',
      '.platform-state',
      'runtime',
      'reinforcement',
      'software-engineer.md',
    );

    expect(runPython).toHaveBeenCalledWith(
      path.join('/fake/repo', 'src', 'backend', 'scripts', 'python', 'run-role-agent-helper.py'),
      [
        'render-reinforcement-context',
        '/packs/pack-a',
        'software-engineer',
        renderedPath,
        path.join('/fake/repo', '.platform-state', 'runtime', 'reinforcement', 'software-engineer.env'),
        '--repo-root',
        '/fake/repo',
      ],
      expect.objectContaining({
        cwd: '/fake/repo',
      }),
    );
    expect(readFile).toHaveBeenCalledWith(renderedPath, 'utf-8');
    expect(result).toEqual({
      status: 'available',
      reason: 'Rendered reinforcement context available for launch overlay.',
      injectionEnabled: true,
      contextFile: renderedPath,
    });
    expect(writeTextFile).toHaveBeenCalledWith(
      path.join('/fake/repo', '.platform-state', 'runtime', 'reinforcement', 'software-engineer.diagnostics.json'),
      expect.stringContaining('"status": "available"'),
    );
  });

  it('returns unavailable when rendered status is unavailable', async () => {
    readFile.mockResolvedValue('# Reinforcement Context\n\n- Status: unavailable\n- Reason: missing\n');

    const result = await resolveReinforcementContext(
      'alice' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'missing',
      injectionEnabled: false,
    });
    expect(writeTextFile).toHaveBeenCalledWith(
      path.join('/fake/repo', '.platform-state', 'runtime', 'reinforcement', 'product-manager.diagnostics.json'),
      expect.stringContaining('"reason": "missing"'),
    );
  });

  it('returns unavailable when rendering fails', async () => {
    runPython.mockRejectedValue(new Error('boom'));

    const result = await resolveReinforcementContext(
      'ron' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    expect(result.status).toBe('unavailable');
    expect(result.injectionEnabled).toBe(false);
    expect(result.reason).toContain('failed to render');
  });

  it('returns not-applicable for non-reinforcement agents', async () => {
    const result = await resolveReinforcementContext(
      'unknown-agent' as AgentId,
      '/packs/pack-a',
      '/fake/repo',
    );

    expect(result.status).toBe('not-applicable');
    expect(result.injectionEnabled).toBe(false);
    expect(runPython).not.toHaveBeenCalled();
  });

  it('returns unavailable when no context pack is set', async () => {
    const result = await resolveReinforcementContext(
      'dalton' as AgentId,
      undefined,
      '/fake/repo',
    );

    expect(result.status).toBe('unavailable');
    expect(result.injectionEnabled).toBe(false);
    expect(runPython).not.toHaveBeenCalled();
  });
});
