// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { buildCopilotEnv } from '../../../../../../backend/platform/cli-provider/providers/copilot/envMapper.js';
import { buildPlannerCliInvocation } from '../../../plannerCliProcess';
import { REPO_ROOT } from '../../../paths';

describe('buildPlannerCliInvocation planner env contract', () => {
  const restoredEnvKeys = [
    'COPILOT_PRIMARY_FOCUS_PATH',
    'COPILOT_PRIMARY_FOCUS_TARGETS_JSON',
    'COPILOT_HANDOFFS_DIR',
  ];
  const originalEnvValues = new Map(
    restoredEnvKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of restoredEnvKeys) {
      const originalValue = originalEnvValues.get(key);
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it('emits base planner provider keys without focus metadata', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
    });

    expect(invocation.env.COPILOT_MODEL).toBe(invocation.model);
    expect(invocation.env.COPILOT_AGENT_ID).toBe('planning-agent');
    expect(invocation.env.COPILOT_PLATFORM_REPO_ROOT).toBe(REPO_ROOT);
    expect(invocation.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGETS_JSON');
  });

  it('scrubs stale inherited planner-controlled COPILOT values without focus metadata', () => {
    process.env.COPILOT_PRIMARY_FOCUS_TARGETS_JSON = 'stale-json';
    process.env.COPILOT_PRIMARY_FOCUS_PATH = 'stale-path';
    process.env.COPILOT_HANDOFFS_DIR = '/stale/handoffs';

    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
    });

    expect(invocation.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGETS_JSON');
    expect(invocation.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(invocation.env).not.toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(invocation.env.COPILOT_MODEL).toBe(invocation.model);
    expect(invocation.env.COPILOT_AGENT_ID).toBe('planning-agent');
    expect(invocation.env.COPILOT_PLATFORM_REPO_ROOT).toBe(REPO_ROOT);
  });

  it('includes the same focus keys emitted by buildCopilotEnv', () => {
    const focusEnv = {
      platformRepoRoot: '/platform',
      targetReposJson: '["/repo-a","/repo-b"]',
      primaryFocusPath: 'libs/Acme.Models',
      primaryFocusTargetKind: 'directory' as const,
      primaryFocusTargetsJson: '[{"path":"libs/Acme.Models","kind":"directory","role":"anchor"}]',
      writableRootsJson: '[]',
      readonlyContextRootsJson: '[]',
      testTargetPath: 'libs/Acme.Models.Tests',
      testTargetKind: 'directory' as const,
      contextPackPaths: '/context-pack',
      contextPackSearchRoots: '/context-pack',
    };
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      focusEnv,
    });
    const expected = buildCopilotEnv({
      ...focusEnv,
      model: invocation.model,
      agentId: 'planning-agent',
    });

    for (const [key, value] of Object.entries(expected)) {
      expect(invocation.env[key]).toBe(value);
    }
  });

  it('overrides stale inherited COPILOT focus values with launch focusEnv', () => {
    process.env.COPILOT_PRIMARY_FOCUS_PATH = 'stale';

    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      focusEnv: {
        platformRepoRoot: '/platform',
        primaryFocusPath: 'libs/Acme.Models',
      },
    });

    expect(invocation.env.COPILOT_PRIMARY_FOCUS_PATH).toBe('libs/Acme.Models');
  });

  it('preserves additionalEnv as the final override layer', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      focusEnv: {
        platformRepoRoot: '/platform',
        primaryFocusPath: 'libs/Acme.Models',
      },
      additionalEnv: {
        COPILOT_PRIMARY_FOCUS_PATH: 'additional-override',
      },
    });

    expect(invocation.env.COPILOT_PRIMARY_FOCUS_PATH).toBe('additional-override');
  });
});
