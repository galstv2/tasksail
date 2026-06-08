// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copilotProvider } from '../../../../../../backend/platform/cli-provider/providers/copilot/copilotProvider.js';
import { buildCopilotEnv } from '../../../../../../backend/platform/cli-provider/providers/copilot/envMapper.js';
import type { PlannerLaunchOptions, PlannerLaunchSpec } from '../../../../../../backend/platform/cli-provider/types.js';
import { buildPlannerCliInvocation } from '../../../planner/cliProcess';
import { REPO_ROOT } from '../../../paths';

const SKILL_DIRS_ENV = 'COPILOT_SKILLS_DIRS';

function mockProviderSkillEnv(): void {
  const provider = copilotProvider as typeof copilotProvider & { buildPlannerLaunchSpec(options: PlannerLaunchOptions): PlannerLaunchSpec | null };
  vi.spyOn(provider, 'buildPlannerLaunchSpec').mockImplementation((options) => ({
    agentId: 'planning-agent',
    args: ['--agent', 'planning-agent'],
    launchCwd: REPO_ROOT,
    env: {
      [SKILL_DIRS_ENV]: options.launchExtensions?.skillDirs.join(',') ?? '',
      TASKSAIL_TEST_PROVIDER_KEY: 'provider-value',
    },
  }));
}

describe('buildPlannerCliInvocation planner env contract', () => {
  const restoredEnvKeys = [
    'COPILOT_PRIMARY_FOCUS_PATH',
    'COPILOT_PRIMARY_FOCUS_TARGETS_JSON',
    'COPILOT_HANDOFFS_DIR',
  ];
  const originalEnvValues = new Map(restoredEnvKeys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('strips caller-supplied skills env while preserving other final overrides when launch extensions are present', () => {
    mockProviderSkillEnv();

    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      launchExtensions: { pluginDirs: [], skillDirs: ['/safe/skills'] },
      additionalEnv: {
        [SKILL_DIRS_ENV]: 'poison',
        TASKSAIL_TEST_PROVIDER_KEY: 'caller-override',
      },
    });

    expect(invocation.env[SKILL_DIRS_ENV]).toBe('/safe/skills');
    expect(invocation.env.TASKSAIL_TEST_PROVIDER_KEY).toBe('caller-override');
  });

  it('strips caller-supplied skills env when launch extensions are absent', () => {
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      additionalEnv: {
        [SKILL_DIRS_ENV]: 'poison',
        TASKSAIL_TEST_PROVIDER_KEY: 'caller-value',
      },
    });

    expect(invocation.env).not.toHaveProperty(SKILL_DIRS_ENV);
    expect(invocation.env.TASKSAIL_TEST_PROVIDER_KEY).toBe('caller-value');
  });

  it('renders staged pluginDirs and skillDirs through the existing Copilot launch-extension contract', () => {
    // Mirrors what the per-launch staging gate produces: launch-local staged directories.
    const launchExtensions = {
      pluginDirs: ['/stage/launch/plugins/p1', '/stage/launch/plugins/p2'],
      skillDirs: ['/stage/launch/skills'],
    };

    const invocation = buildPlannerCliInvocation({ prompt: 'Plan the task.', launchExtensions });

    // Each staged plugin dir reaches the real Copilot provider as a repeated --plugin-dir pair.
    for (const pluginDir of launchExtensions.pluginDirs) {
      const dirIndex = invocation.args.indexOf(pluginDir);
      expect(dirIndex).toBeGreaterThan(0);
      expect(invocation.args[dirIndex - 1]).toBe('--plugin-dir');
    }
    // The staged skills dir reaches the provider as the comma-joined COPILOT_SKILLS_DIRS env value.
    expect(invocation.env[SKILL_DIRS_ENV]).toBe('/stage/launch/skills');
  });

  it('strips ambient skills env unless provider launch extensions set it', () => {
    const prior = process.env[SKILL_DIRS_ENV];
    process.env[SKILL_DIRS_ENV] = 'ambient-poison';
    try {
      expect(buildPlannerCliInvocation({ prompt: 'Plan the task.' }).env)
        .not.toHaveProperty(SKILL_DIRS_ENV);

      mockProviderSkillEnv();
      const invocation = buildPlannerCliInvocation({ prompt: 'Plan the task.', launchExtensions: { pluginDirs: [], skillDirs: ['/safe/skills'] } });
      expect(invocation.env[SKILL_DIRS_ENV]).toBe('/safe/skills');
    } finally {
      if (prior === undefined) {
        delete process.env[SKILL_DIRS_ENV];
      } else {
        process.env[SKILL_DIRS_ENV] = prior;
      }
    }
  });

  // Env contract for skill/plugin launch-extension rendering.

  it('phase2: COPILOT_SKILLS_DIRS is set only by the provider, not by inheritedPlannerEnv, when skillDirs present', () => {
    // Confirms COPILOT_SKILLS_DIRS is in COPILOT_CONTROLLED_ENV_KEYS (stripped from inherited
    // env) and populated only via the provider launch spec when skillDirs are supplied.
    const priorValue = process.env[SKILL_DIRS_ENV];
    process.env[SKILL_DIRS_ENV] = 'stale-inherited-value';
    try {
      mockProviderSkillEnv();
      const invocation = buildPlannerCliInvocation({
        prompt: 'Plan the task.',
        launchExtensions: { pluginDirs: [], skillDirs: ['/stage/skills/phase2-ferret'] },
      });

      // Provider set it via launchSpec.env — inherited stale value must be gone.
      expect(invocation.env[SKILL_DIRS_ENV]).toBe('/stage/skills/phase2-ferret');
      expect(invocation.env[SKILL_DIRS_ENV]).not.toContain('stale-inherited-value');
    } finally {
      if (priorValue === undefined) {
        delete process.env[SKILL_DIRS_ENV];
      } else {
        process.env[SKILL_DIRS_ENV] = priorValue;
      }
    }
  });

  it('phase2: COPILOT_SKILLS_DIRS is absent when skillDirs is empty (real provider path)', () => {
    // Empty skillDirs must not set the env key — buildCopilotLaunchExtensionEnv returns {}
    // when skillDirs is empty. Uses the real provider (no mock) to confirm production behavior.
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      launchExtensions: { pluginDirs: ['/stage/plugins/p1'], skillDirs: [] },
    });

    // No skillDirs → COPILOT_SKILLS_DIRS must be absent.
    expect(invocation.env).not.toHaveProperty(SKILL_DIRS_ENV);
    // pluginDirs still produce --plugin-dir args.
    const pIdx = invocation.args.indexOf('/stage/plugins/p1');
    expect(pIdx).toBeGreaterThan(0);
    expect(invocation.args[pIdx - 1]).toBe('--plugin-dir');
  });

  it('phase2: COPILOT_SKILLS_DIRS is not in the runtime manifest env (not in COPILOT_RUNTIME_MANIFEST_ENV_VARS)', () => {
    // COPILOT_SKILLS_DIRS is a controlled env key (stripped from inherited process.env) but is
    // NOT part of the runtime manifest env vars that travel through invocation.env to the CLI.
    // This confirms the provider-isolation contract: it is set only by the provider launch spec.
    mockProviderSkillEnv();
    const invocation = buildPlannerCliInvocation({
      prompt: 'Plan the task.',
      launchExtensions: { pluginDirs: [], skillDirs: ['/stage/skills/ferret'] },
    });

    // The env value must come from the provider launch spec (our mock), not from any
    // runtime-manifest pass-through that would duplicate or override it.
    expect(invocation.env[SKILL_DIRS_ENV]).toBe('/stage/skills/ferret');
    // The invocation env must not contain a second copy under a different key.
    const occurrences = Object.values(invocation.env).filter(
      (v) => typeof v === 'string' && v.includes('/stage/skills/ferret'),
    );
    expect(occurrences).toHaveLength(1);
  });
});
