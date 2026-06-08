// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extensionError } from '../../../../backend/platform/agent-extensions/ids.js';
import {
  applyPlannerLaunchAvailabilityNoteToFirstTurn,
  buildPlannerLaunchAvailabilityNote,
  PLANNER_EXTENSIONS_UNAVAILABLE_MESSAGE,
  resolvePlannerLaunchExtensions,
} from './launchExtensions';

const loggerMocks = vi.hoisted(() => {
  const info = vi.fn();
  const warn = vi.fn();
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info,
    warn,
    error: vi.fn(),
    child: vi.fn(),
  }));
  return { info, warn, createLogger };
});

const stageMocks = vi.hoisted(() => ({ createAgentExtensionStage: vi.fn() }));
const providerMocks = vi.hoisted(() => ({
  getActiveProvider: vi.fn((): { id: string; plannerAgentId: () => string | null } => ({
    id: 'copilot',
    plannerAgentId: () => 'planning-agent',
  })),
}));

vi.mock('../log/logger', () => ({ createLogger: loggerMocks.createLogger }));
vi.mock('../../../../backend/platform/agent-extensions/stage.js', () => ({
  createAgentExtensionStage: stageMocks.createAgentExtensionStage,
}));
vi.mock('../../../../backend/platform/cli-provider/index.js', () => ({
  getActiveProvider: providerMocks.getActiveProvider,
}));

type FakeAvailabilityEntry = {
  id: string;
  kind: 'skill' | 'plugin';
  display_name: string;
  description: string;
  metadata: { skill_names?: string[]; plugin_skill_count?: number };
};

type FakeStage = {
  launchId: string;
  agentId: string;
  stageDir: string | null;
  launchExtensions: { pluginDirs: string[]; skillDirs: string[] } | undefined;
  availabilityEntries: FakeAvailabilityEntry[];
  cleanup: ReturnType<typeof vi.fn>;
};

function stageResult(overrides: Partial<FakeStage> = {}): FakeStage {
  return {
    launchId: 'planner-1',
    agentId: 'planning-agent',
    stageDir: '/repo/.platform-state/runtime/agent-extension-stage/planner-1',
    launchExtensions: { pluginDirs: [], skillDirs: [] },
    availabilityEntries: [],
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function clockFrom(...msValues: number[]): () => Date {
  let index = 0;
  return () => new Date(msValues[index++] ?? msValues[msValues.length - 1]);
}

function infoCall(event: string): Record<string, unknown> | undefined {
  const call = loggerMocks.info.mock.calls.find((c) => c[0] === event);
  return call?.[1] as Record<string, unknown> | undefined;
}

function warnCall(event: string): Record<string, unknown> | undefined {
  const call = loggerMocks.warn.mock.calls.find((c) => c[0] === event);
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  loggerMocks.info.mockClear();
  loggerMocks.warn.mockClear();
  loggerMocks.createLogger.mockClear();
  stageMocks.createAgentExtensionStage.mockReset();
  providerMocks.getActiveProvider.mockReset();
  providerMocks.getActiveProvider.mockReturnValue({
    id: 'copilot',
    plannerAgentId: () => 'planning-agent',
  });
});

describe('resolvePlannerLaunchExtensions', () => {
  it('returns no launchExtensions and no availabilityNote when planner has no enabled assignments', async () => {
    stageMocks.createAgentExtensionStage.mockResolvedValue(
      stageResult({ stageDir: null, launchExtensions: undefined, availabilityEntries: [] }),
    );

    const resolved = await resolvePlannerLaunchExtensions({
      repoRoot: '/repo',
      plannerSessionId: 'planner-1',
      providerId: 'copilot',
    });

    expect(resolved.launchExtensions).toBeUndefined();
    expect(resolved.availabilityNote).toBeUndefined();
    expect(resolved.skillCount).toBe(0);
    expect(resolved.pluginCount).toBe(0);
    expect(resolved.extensionIds).toEqual([]);
  });

  it('calls createAgentExtensionStage with agentId planning-agent and launchId plannerSessionId', async () => {
    stageMocks.createAgentExtensionStage.mockResolvedValue(stageResult());

    await resolvePlannerLaunchExtensions({
      repoRoot: '/repo',
      plannerSessionId: 'planner-42',
      providerId: 'copilot',
    });

    expect(stageMocks.createAgentExtensionStage).toHaveBeenCalledWith({
      repoRoot: '/repo',
      agentId: 'planning-agent',
      launchId: 'planner-42',
    });
  });

  it('fails loudly when the active provider has no planner agent id', async () => {
    providerMocks.getActiveProvider.mockReturnValue({
      id: 'copilot',
      plannerAgentId: () => null,
    });

    await expect(
      resolvePlannerLaunchExtensions({
        repoRoot: '/repo',
        plannerSessionId: 'planner-1',
        providerId: 'copilot',
      }),
    ).rejects.toThrow('Active provider has no planner agent id; planner launch extensions are not supported.');
    expect(stageMocks.createAgentExtensionStage).not.toHaveBeenCalled();
  });

  it('builds a note with only display names, Skill or Plugin kind, cached descriptions, and cached plugin bundled skill names', async () => {
    stageMocks.createAgentExtensionStage.mockResolvedValue(
      stageResult({
        launchExtensions: { pluginDirs: ['/stage/plugins/plug-x'], skillDirs: ['/stage/skills'] },
        availabilityEntries: [
          { id: 'skill-a', kind: 'skill', display_name: 'Deploy Check', description: 'Checks deploy readiness.', metadata: {} },
          {
            id: 'plug-x',
            kind: 'plugin',
            display_name: 'Release Kit',
            description: 'Release automation.',
            metadata: { plugin_skill_count: 2, skill_names: ['cut-release', 'tag-build'] },
          },
        ],
      }),
    );

    const { availabilityNote } = await resolvePlannerLaunchExtensions({
      repoRoot: '/repo',
      plannerSessionId: 'planner-1',
      providerId: 'copilot',
    });

    expect(availabilityNote).toContain('Optional Skills And Plugins Available This Session');
    expect(availabilityNote).toContain('- Skill: Deploy Check - Checks deploy readiness.');
    expect(availabilityNote).toContain('- Plugin: Release Kit - Release automation.');
    expect(availabilityNote).toContain('Bundled skills: cut-release, tag-build');
    // The footer preserves authority of existing scope/workflow rules.
    expect(availabilityNote).toContain('remain authoritative.');
  });

  it('logs resolve.completed with each plugin bundledSkillCount and never the bundled skill names', async () => {
    stageMocks.createAgentExtensionStage.mockResolvedValue(
      stageResult({
        availabilityEntries: [
          {
            id: 'plug-x',
            kind: 'plugin',
            display_name: 'Release Kit',
            description: 'Release automation.',
            metadata: { plugin_skill_count: 3, skill_names: ['cut-release', 'tag-build', 'notify'] },
          },
        ],
      }),
    );

    await resolvePlannerLaunchExtensions({
      repoRoot: '/repo',
      plannerSessionId: 'planner-1',
      providerId: 'copilot',
    });

    const completed = infoCall('planner.launch_extensions.resolve.completed');
    expect(completed?.pluginComponents).toEqual([{ pluginId: 'plug-x', bundledSkillCount: 3 }]);
    const serialized = JSON.stringify(loggerMocks.info.mock.calls);
    expect(serialized).not.toContain('cut-release');
    expect(serialized).not.toContain('skill_names');
  });

  it('stamps providerId and agentId via logger context and computes deterministic elapsedMs from the injected clock', async () => {
    const stage = stageResult();
    stageMocks.createAgentExtensionStage.mockResolvedValue(stage);

    const resolved = await resolvePlannerLaunchExtensions({
      repoRoot: '/repo',
      plannerSessionId: 'planner-1',
      providerId: 'copilot',
      now: clockFrom(1000, 1015, 1020, 1027),
    });

    // providerId + agentId travel through the logger CONTEXT (canonical provider_id/agent_id),
    // never as ad-hoc extras on individual events.
    expect(loggerMocks.createLogger).toHaveBeenCalledWith('electron/plannerLaunchExtensions', {
      providerId: 'copilot',
      agentId: 'planning-agent',
    });
    const completed = infoCall('planner.launch_extensions.resolve.completed');
    expect(completed?.elapsedMs).toBe(15);
    expect(completed).not.toHaveProperty('providerId');
    expect(completed).not.toHaveProperty('agentId');

    await resolved.cleanup();
    const cleanupCompleted = infoCall('planner.launch_extensions.cleanup.completed');
    expect(cleanupCompleted?.elapsedMs).toBe(7);
    expect(cleanupCompleted).not.toHaveProperty('providerId');
    expect(stage.cleanup).toHaveBeenCalledTimes(1);
  });

  it('never leaks staged paths, runtime paths, source URLs, or bodies into the availability note', async () => {
    stageMocks.createAgentExtensionStage.mockResolvedValue(
      stageResult({
        stageDir: '/repo/.platform-state/runtime/agent-extension-stage/planner-1',
        launchExtensions: {
          pluginDirs: ['/repo/.platform-state/runtime/agent-extension-stage/planner-1/plugins/plug-x'],
          skillDirs: ['/repo/.platform-state/runtime/agent-extension-stage/planner-1/skills'],
        },
        availabilityEntries: [
          { id: 'plug-x', kind: 'plugin', display_name: 'Release Kit', description: 'Release automation.', metadata: { plugin_skill_count: 1, skill_names: ['cut-release'] } },
        ],
      }),
    );

    const { availabilityNote } = await resolvePlannerLaunchExtensions({
      repoRoot: '/repo',
      plannerSessionId: 'planner-1',
      providerId: 'copilot',
    });

    expect(availabilityNote).toBeDefined();
    for (const forbidden of ['.platform-state', 'agent-extension-stage', '/plugins/', '/skills', 'SKILL.md', 'plugin.json', 'COPILOT_SKILLS_DIRS', '--plugin-dir', 'https://']) {
      expect(availabilityNote).not.toContain(forbidden);
    }
  });

  it('fails closed and logs resolve.failed when an enabled assigned entry lacks cached display metadata', async () => {
    stageMocks.createAgentExtensionStage.mockRejectedValue(
      extensionError('incomplete-catalog-entry', 'An assigned extension is missing cached metadata.'),
    );

    await expect(
      resolvePlannerLaunchExtensions({
        repoRoot: '/repo',
        plannerSessionId: 'planner-1',
        providerId: 'copilot',
      }),
    ).rejects.toThrow(PLANNER_EXTENSIONS_UNAVAILABLE_MESSAGE);

    const failed = warnCall('planner.launch_extensions.resolve.failed');
    expect(failed?.reasonCode).toBe('incomplete-catalog-entry');
    expect(failed?.plannerSessionId).toBe('planner-1');
  });
});

describe('buildPlannerLaunchAvailabilityNote', () => {
  it('returns undefined for an empty entry list', () => {
    expect(buildPlannerLaunchAvailabilityNote([])).toBeUndefined();
  });
});

describe('applyPlannerLaunchAvailabilityNoteToFirstTurn', () => {
  it('prepends the note then applies the fresh-session wrap', () => {
    const result = applyPlannerLaunchAvailabilityNoteToFirstTurn({
      guideText: 'GUIDE',
      availabilityNote: 'NOTE',
      wrapFreshSession: (text) => `WRAP(${text})`,
    });
    expect(result).toBe('WRAP(NOTE\n\nGUIDE)');
  });

  it('only applies the wrap when no note is present', () => {
    const result = applyPlannerLaunchAvailabilityNoteToFirstTurn({
      guideText: 'GUIDE',
      wrapFreshSession: (text) => `WRAP(${text})`,
    });
    expect(result).toBe('WRAP(GUIDE)');
  });
});
