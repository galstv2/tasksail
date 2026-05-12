// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  buildPlannerCliInvocation,
  getPlanningAgentRequiredModel,
  spawnPlannerCliProcess,
} from '../../../plannerCliProcess';
import { REPO_ROOT } from '../../../paths';

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

const expectedProviderCommand = () => (process.platform === 'win32' ? 'copilot.cmd' : 'copilot');

describe('buildPlannerCliInvocation', () => {
  it('builds the canonical planner JSONL invocation with required flags', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Reply with exactly READY.',
    });

    expect(invocation.command).toBe(expectedProviderCommand());
    expect(invocation.cwd).toBe(REPO_ROOT);
    expect(invocation.agentId).toBe('planning-agent');
    expect(invocation.model).toBe(getPlanningAgentRequiredModel());
    expect(invocation.promptMode).toBe('one-shot');
    expect(invocation.allowedRoots).toEqual([
      'AgentWorkSpace/dropbox',
      'AgentWorkSpace/templates',
    ]);
    expect(invocation.args).toEqual(expect.arrayContaining([
      '--agent',
      'planning-agent',
      '--model',
      getPlanningAgentRequiredModel(),
      '--output-format',
      'json',
      '--stream',
      'on',
      '--no-ask-user',
      '--allow-tool',
      'write',
      '--deny-tool',
      'shell',
      '--deny-tool',
      'shell(git push)',
      '--add-dir',
      `${REPO_ROOT}/AgentWorkSpace/dropbox`,
      '--add-dir',
      `${REPO_ROOT}/AgentWorkSpace/templates`,
      '--disallow-temp-dir',
      '--prompt',
      'Reply with exactly READY.',
    ]));
    expect(invocation.env.RUN_ROLE_AGENT_ACTIVE_MODEL).toBe(getPlanningAgentRequiredModel());
    expect(invocation.env.COPILOT_MODEL).toBe(getPlanningAgentRequiredModel());
  });

  it('adds resume and boundary overrides without widening defaults silently', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Continue the prior turn.',
      resumeSessionId: 'session-42',
      allowedRoots: ['AgentWorkSpace', 'contextpacks/orders', 'AgentWorkSpace'],
      contextPackBoundaryEnforced: true,
    });

    expect(invocation.allowedRoots).toEqual(['AgentWorkSpace', 'contextpacks/orders']);
    expect(invocation.args).toContain('--resume=session-42');
    expect(invocation.args).toEqual(expect.arrayContaining([
      '--add-dir',
      `${REPO_ROOT}/AgentWorkSpace`,
      '--add-dir',
      `${REPO_ROOT}/contextpacks/orders`,
    ]));
  });

  it('uses interactive bootstrap flags when requested for the first turn', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Reply with exactly READY.',
      promptMode: 'interactive',
    });

    expect(invocation.promptMode).toBe('interactive');
    expect(invocation.args).toEqual(expect.arrayContaining([
      '--output-format',
      'json',
      '--stream',
      'on',
      '-i',
      'Reply with exactly READY.',
    ]));
    expect(invocation.args).not.toContain('--prompt');
  });

  it('propagates planner session ownership into the CLI environment', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Update the staged plan.',
      plannerSessionId: 'planner-42',
    });

    expect(invocation.plannerSessionId).toBe('planner-42');
    expect(invocation.env.PLANNER_SESSION_ID).toBe('planner-42');
  });

  it('uses the provider launch spec cwd', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Use an explicit cwd.',
      allowedRoots: ['AgentWorkSpace/dropbox'],
      workingDirectory: '/tmp/planner-cwd',
    });

    expect(invocation.cwd).toBe('/tmp/planner-cwd');
  });

  it('resolves the Windows provider shim when running on win32', () => {
    const restorePlatform = setPlatform('win32');

    try {
      const invocation = buildPlannerCliInvocation({
        prompt: 'Reply with exactly READY.',
      });

      expect(invocation.command).toBe('copilot.cmd');
    } finally {
      restorePlatform();
    }
  });
});

describe('spawnPlannerCliProcess', () => {
  it('spawns copilot with the canonical planner invocation', () => {
    const spawnMock = vi.fn(() => ({ pid: 1234 })) as unknown as typeof import('node:child_process').spawn;

    spawnPlannerCliProcess(
      {
        prompt: 'Say hello.',
      },
      spawnMock,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      expectedProviderCommand(),
      expect.arrayContaining(['--agent', 'planning-agent', '--output-format', 'json']),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('spawns interactive bootstrap invocations with -i when requested', () => {
    const spawnMock = vi.fn(() => ({ pid: 4321 })) as unknown as typeof import('node:child_process').spawn;

    spawnPlannerCliProcess(
      {
        prompt: 'Reply with exactly READY.',
        promptMode: 'interactive',
      },
      spawnMock,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      expectedProviderCommand(),
      expect.arrayContaining(['-i', 'Reply with exactly READY.']),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('uses repo root as planner cwd when multiple allowed roots are configured', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Use repo-relative planner paths.',
    });

    expect(invocation.allowedRoots).toEqual([
      'AgentWorkSpace/dropbox',
      'AgentWorkSpace/templates',
    ]);
    expect(invocation.cwd).toBe(REPO_ROOT);
  });
});
