import { describe, expect, it } from 'vitest';

import { buildCopilotPlannerLaunchSpec } from '../plannerAdapter.js';

describe('buildCopilotPlannerLaunchSpec planner env contract', () => {
  it('emits base planner provider env without focus metadata', () => {
    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
    });

    expect(spec.env).toMatchObject({
      COPILOT_MODEL: 'claude-sonnet-4.6',
      COPILOT_AGENT_ID: 'planning-agent',
      COPILOT_PLATFORM_REPO_ROOT: '/repo',
    });
    expect(spec.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGETS_JSON');
  });

  it('emits structured focus metadata through the shared Copilot env mapper', () => {
    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
      focusEnv: {
        platformRepoRoot: '/platform',
        targetReposJson: '["/repo-a","/repo-b"]',
        primaryFocusPath: 'libs/Acme.Models',
        primaryFocusTargetKind: 'directory',
        primaryFocusTargetsJson: '[{"path":"libs/Acme.Models","kind":"directory","role":"anchor"}]',
        writableRootsJson: '[]',
        readonlyContextRootsJson: '[]',
        testTargetPath: 'libs/Acme.Models.Tests',
        testTargetKind: 'directory',
        contextPackPaths: '/context-pack',
        contextPackSearchRoots: '/context-pack',
      },
    });

    expect(spec.env).toMatchObject({
      COPILOT_MODEL: 'claude-sonnet-4.6',
      COPILOT_AGENT_ID: 'planning-agent',
      COPILOT_PLATFORM_REPO_ROOT: '/platform',
      COPILOT_TARGET_REPOS_JSON: '["/repo-a","/repo-b"]',
      COPILOT_PRIMARY_FOCUS_PATH: 'libs/Acme.Models',
      COPILOT_PRIMARY_FOCUS_TARGET_KIND: 'directory',
      COPILOT_PRIMARY_FOCUS_TARGETS_JSON: '[{"path":"libs/Acme.Models","kind":"directory","role":"anchor"}]',
      COPILOT_WRITABLE_ROOTS_JSON: '[]',
      COPILOT_READONLY_CONTEXT_ROOTS_JSON: '[]',
      COPILOT_TEST_TARGET_PATH: 'libs/Acme.Models.Tests',
      COPILOT_TEST_TARGET_KIND: 'directory',
      COPILOT_CONTEXT_PACK_PATHS: '/context-pack',
      COPILOT_CONTEXT_PACK_SEARCH_ROOTS: '/context-pack',
    });
  });

  it('omits undefined optional focus fields without leaking string values', () => {
    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
      focusEnv: {
        platformRepoRoot: '/platform',
        primaryFocusPath: undefined,
        primaryFocusTargetKind: undefined,
        primaryFocusTargetsJson: undefined,
      },
    });

    expect(spec.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(spec.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGET_KIND');
    expect(spec.env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGETS_JSON');
    expect(Object.values(spec.env ?? {})).not.toContain('undefined');
  });

  it('keeps planner-owned identity fields authoritative', () => {
    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
      focusEnv: {
        platformRepoRoot: '/platform',
      },
    });

    expect(spec.env?.COPILOT_MODEL).toBe('claude-sonnet-4.6');
    expect(spec.env?.COPILOT_AGENT_ID).toBe('planning-agent');
  });

  it('emits planner effort only for non-empty non-none values and never through env', () => {
    const withEffort = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      reasoningEffort: 'high',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
    });
    expect(withEffort.args).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(withEffort.env).not.toHaveProperty('COPILOT_REASONING_EFFORT');

    for (const reasoningEffort of [undefined, '', 'none']) {
      const spec = buildCopilotPlannerLaunchSpec({
        model: 'claude-sonnet-4.6',
        reasoningEffort,
        promptMode: 'one-shot',
        contextPackBoundaryEnforced: true,
        workingDirectory: '/repo',
      });
      expect(spec.args).not.toContain('--effort');
      expect(Object.keys(spec.env ?? {}).join('\n')).not.toMatch(/REASONING|EFFORT/u);
    }
  });
});
