// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  buildPlannerCopilotInvocation,
  getPlanningAgentRequiredModel,
  spawnPlannerCopilotProcess,
} from './plannerCopilotProcess';
import { REPO_ROOT } from './paths';

describe('buildPlannerCopilotInvocation', () => {
  it('builds the canonical planner JSONL invocation with required flags', () => {
    const invocation = buildPlannerCopilotInvocation({
      prompt: 'Reply with exactly READY.',
    });

    expect(invocation.command).toBe('copilot');
    expect(invocation.cwd).toBe(REPO_ROOT);
    expect(invocation.agentId).toBe('planning-agent');
    expect(invocation.model).toBe(getPlanningAgentRequiredModel());
    expect(invocation.outputFormat).toBe('json');
    expect(invocation.streamMode).toBe('on');
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
    const invocation = buildPlannerCopilotInvocation({
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
    const invocation = buildPlannerCopilotInvocation({
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

  it('propagates planner session ownership into the Copilot environment', () => {
    const invocation = buildPlannerCopilotInvocation({
      prompt: 'Update the staged plan.',
      plannerSessionId: 'planner-42',
    });

    expect(invocation.plannerSessionId).toBe('planner-42');
    expect(invocation.env.PLANNER_SESSION_ID).toBe('planner-42');
  });

  it('uses the explicit working directory override when provided', () => {
    const invocation = buildPlannerCopilotInvocation({
      prompt: 'Use an explicit cwd.',
      allowedRoots: ['AgentWorkSpace/dropbox'],
      workingDirectory: '/tmp/planner-cwd',
    });

    expect(invocation.cwd).toBe('/tmp/planner-cwd');
  });
});

describe('spawnPlannerCopilotProcess', () => {
  it('spawns copilot with the canonical planner invocation', () => {
    const spawnMock = vi.fn(() => ({ pid: 1234 })) as unknown as typeof import('node:child_process').spawn;

    spawnPlannerCopilotProcess(
      {
        prompt: 'Say hello.',
      },
      spawnMock,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining(['--agent', 'planning-agent', '--output-format', 'json']),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('spawns interactive bootstrap invocations with -i when requested', () => {
    const spawnMock = vi.fn(() => ({ pid: 4321 })) as unknown as typeof import('node:child_process').spawn;

    spawnPlannerCopilotProcess(
      {
        prompt: 'Reply with exactly READY.',
        promptMode: 'interactive',
      },
      spawnMock,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining(['-i', 'Reply with exactly READY.']),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('uses repo root as planner cwd when multiple allowed roots are configured', () => {
    const invocation = buildPlannerCopilotInvocation({
      prompt: 'Use repo-relative planner paths.',
    });

    expect(invocation.allowedRoots).toEqual([
      'AgentWorkSpace/dropbox',
      'AgentWorkSpace/templates',
    ]);
    expect(invocation.cwd).toBe(REPO_ROOT);
  });
});
