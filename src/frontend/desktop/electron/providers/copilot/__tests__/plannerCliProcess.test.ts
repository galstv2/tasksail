// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPlannerCliInvocation,
  getPlanningAgentRequiredModel,
  spawnPlannerCliProcess,
} from '../../../planner/cliProcess';
import { REPO_ROOT } from '../../../paths';
import { copilotProvider } from '../../../../../../backend/platform/cli-provider/providers/copilot/copilotProvider.js';

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

afterEach(() => {
  vi.restoreAllMocks();
});

function plannerPromptArg(args: readonly string[]): string | undefined {
  const promptIndex = args.findIndex((arg) => arg === '--prompt' || arg === '-i');
  return promptIndex >= 0 ? args[promptIndex + 1] : undefined;
}

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
    ]));
    expect(plannerPromptArg(invocation.args)).toBe('Reply with exactly READY.');
    expect(plannerPromptArg(invocation.args)).not.toContain('.github/copilot/prompts');
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
    ]));
    expect(invocation.args).not.toContain('--prompt');
    expect(plannerPromptArg(invocation.args)).toContain('--- TASKSAIL RUNTIME PLANNING STYLE PROFILE ---');
    expect(plannerPromptArg(invocation.args)).toContain('Use the Balanced Planning Specialist style.');
    expect(plannerPromptArg(invocation.args)).toContain('Reply with exactly READY.');
  });

  it('passes only the personality id through the provider-neutral planner CLI seam', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan it clinically.',
      promptMode: 'interactive',
      plannerPersonalityId: 'clinical',
    });

    expect(plannerPromptArg(invocation.args)).toContain('Use the Clinical Planning Specialist style.');
    expect(plannerPromptArg(invocation.args)).toContain('Plan it clinically.');
    expect(invocation.prompt).toBe('Plan it clinically.');
    expect(JSON.stringify(invocation)).not.toContain('.github/copilot/prompts');
  });

  it('keeps resumed planner prompts unchanged while preserving the planning agent id', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Continue with the raw operator turn.',
      promptMode: 'interactive',
      resumeSessionId: 'session-42',
      plannerPersonalityId: 'clinical',
    });

    expect(invocation.agentId).toBe('planning-agent');
    expect(invocation.args).toEqual(expect.arrayContaining(['--agent', 'planning-agent', '--resume=session-42']));
    expect(plannerPromptArg(invocation.args)).toBe('Continue with the raw operator turn.');
    expect(plannerPromptArg(invocation.args)).not.toContain('TASKSAIL RUNTIME PLANNING STYLE PROFILE');
  });

  it('propagates planner session ownership into the CLI environment', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Update the staged plan.',
      plannerSessionId: 'planner-42',
    });

    expect(invocation.plannerSessionId).toBe('planner-42');
    expect(invocation.env.PLANNER_SESSION_ID).toBe('planner-42');
  });

  it('forwards launch extensions to the provider launch options', () => {
    const launchExtensions = {
      pluginDirs: ['/extensions/plugin-a'],
      skillDirs: ['/extensions/skills-a'],
    };
    const buildLaunchSpec = vi.spyOn(copilotProvider, 'buildPlannerLaunchSpec');

    buildPlannerCliInvocation({
      prompt: 'Plan with extensions.',
      launchExtensions,
    });

    expect(buildLaunchSpec).toHaveBeenCalledWith(expect.objectContaining({
      launchExtensions,
    }));
  });

  it('keeps no-extension planner launch args and env free of Lily extension fields', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan without extensions.',
    });

    expect(invocation.args).not.toContain('--plugin-dir');
    expect(invocation.env).not.toHaveProperty('COPILOT_SKILLS_DIRS');
  });

  // Skill dirs feed COPILOT_SKILLS_DIRS; plugin dirs feed --plugin-dir args.

  it('phase2: renders each plugin dir as a repeated --plugin-dir arg pair', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan with plugins.',
      launchExtensions: {
        pluginDirs: ['/stage/p1', '/stage/p2'],
        skillDirs: [],
      },
    });

    // Each plugin dir must appear as a '--plugin-dir <dir>' pair in args.
    const pairAt = (dir: string): boolean => {
      const idx = invocation.args.indexOf(dir);
      return idx > 0 && invocation.args[idx - 1] === '--plugin-dir';
    };
    expect(pairAt('/stage/p1')).toBe(true);
    expect(pairAt('/stage/p2')).toBe(true);
    // Two distinct --plugin-dir flags must be present.
    expect(invocation.args.filter((a) => a === '--plugin-dir')).toHaveLength(2);
  });

  it('phase2: renders skill dirs as comma-joined COPILOT_SKILLS_DIRS env value', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan with skills.',
      launchExtensions: {
        pluginDirs: [],
        skillDirs: ['/stage/skills-a', '/stage/skills-b'],
      },
    });

    expect(invocation.env['COPILOT_SKILLS_DIRS']).toBe('/stage/skills-a,/stage/skills-b');
    // Skills must NOT produce --plugin-dir args.
    expect(invocation.args).not.toContain('--plugin-dir');
  });

  it.each([
    { label: 'empty', launchExtensions: { pluginDirs: [] as string[], skillDirs: [] as string[] } },
    { label: 'undefined', launchExtensions: undefined },
  ])('phase2: $label launchExtensions produces no --plugin-dir args and no COPILOT_SKILLS_DIRS', ({ launchExtensions }) => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan with no extensions.',
      launchExtensions,
    });

    expect(invocation.args).not.toContain('--plugin-dir');
    expect(invocation.env).not.toHaveProperty('COPILOT_SKILLS_DIRS');
  });

  it('records explicit captured reasoning effort for planner launch', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Use captured effort.',
      reasoningEffort: 'high',
    });

    expect(invocation.reasoningEffort).toBe('high');
  });

  it('normalizes explicit None reasoning effort to no planner effort', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Use no effort.',
      reasoningEffort: 'none',
    });

    expect(invocation.reasoningEffort).toBeUndefined();
    expect(invocation.args).not.toContain('none');
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
      expect.arrayContaining(['-i', expect.stringContaining('Reply with exactly READY.')]),
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
