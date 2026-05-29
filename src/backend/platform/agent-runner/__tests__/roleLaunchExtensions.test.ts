import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AgentId } from '../../core/index.js';

const { createAgentExtensionStage, loadAgentLaunchExtensionAssignments, logInfo } = vi.hoisted(() => ({
  createAgentExtensionStage: vi.fn(),
  loadAgentLaunchExtensionAssignments: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../../agent-extensions/stage.js', () => ({
  createAgentExtensionStage,
}));

vi.mock('../../agent-extensions/assignment.js', () => ({
  loadAgentLaunchExtensionAssignments,
}));

vi.mock('../../core/logger.js', () => ({
  createLogger: () => ({ info: logInfo, warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child() { return this; } }),
}));

// Assignment store where at least one agent owns an extension, so the lock-free
// pre-check proceeds to mapping + staging.
function assignmentsWithSome(): { schema_version: 1; assignments: Array<{ agent_id: string; extension_ids: string[] }> } {
  return { schema_version: 1, assignments: [{ agent_id: 'software-engineer', extension_ids: ['ext-1'] }] };
}

// Empty assignment store (no agent owns anything) — pre-check short-circuits.
function assignmentsEmpty(): { schema_version: 1; assignments: Array<{ agent_id: string; extension_ids: string[] }> } {
  return { schema_version: 1, assignments: [{ agent_id: 'software-engineer', extension_ids: [] }] };
}

import { AgentExtensionError } from '../../agent-extensions/ids.js';
import { toRegistryId } from '../metadata.js';
import {
  buildRoleAgentLaunchAvailabilityNote,
  cleanupRoleAgentLaunchExtensions,
  prependRoleAgentLaunchAvailabilityNote,
  resolveRoleAgentLaunchExtensions,
  roleAgentToExtensionAgentId,
  type RoleAgentLaunchExtensionResolution,
} from '../roleLaunchExtensions.js';

describe('roleAgentToExtensionAgentId', () => {
  it('maps role agents to their registry assignment IDs sourced from toRegistryId', () => {
    expect(roleAgentToExtensionAgentId('alice')).toBe('product-manager');
    expect(roleAgentToExtensionAgentId('dalton')).toBe('software-engineer');
    expect(roleAgentToExtensionAgentId('dalton-verify')).toBe('software-engineer-verify');
    expect(roleAgentToExtensionAgentId('ron')).toBe('qa');
    // Identity against the canonical registry-id map proves there is no second map.
    expect(roleAgentToExtensionAgentId('alice')).toBe(toRegistryId('alice'));
    expect(roleAgentToExtensionAgentId('ron')).toBe(toRegistryId('ron'));
  });

  it('returns undefined for planning-agent (lily) so Lily is never staged here', () => {
    expect(roleAgentToExtensionAgentId('lily')).toBeUndefined();
  });

  it('returns undefined for an unmapped runtime agent ID', () => {
    expect(roleAgentToExtensionAgentId('ghost' as unknown as AgentId)).toBeUndefined();
  });
});

describe('resolveRoleAgentLaunchExtensions', () => {
  beforeEach(() => {
    createAgentExtensionStage.mockReset();
    loadAgentLaunchExtensionAssignments.mockReset();
    logInfo.mockReset();
  });

  it('maps the agent, emits the none log, and short-circuits without staging when no agent has assignments', async () => {
    loadAgentLaunchExtensionAssignments.mockResolvedValue(assignmentsEmpty());

    const res = await resolveRoleAgentLaunchExtensions({
      repoRoot: '/repo',
      runtimeAgentId: 'dalton',
      stageLaunchId: 'L0',
    });

    expect(res).toMatchObject({
      stageLaunchId: 'L0',
      assignmentAgentId: 'software-engineer',
      launchExtensions: undefined,
      availabilityNote: undefined,
      extensionIds: [],
    });
    // No staging lock acquired when the store is empty, but the content-safe
    // none log still fires with the mapped assignment agent id.
    expect(createAgentExtensionStage).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith('agent.launch_extensions.none', {
      agentId: 'dalton',
      assignmentAgentId: 'software-engineer',
      launchId: 'L0',
    });
  });

  it('returns a no-op resolution when the agent maps but the staging helper reports no enabled assignments', async () => {
    loadAgentLaunchExtensionAssignments.mockResolvedValue(assignmentsWithSome());
    createAgentExtensionStage.mockResolvedValue({
      launchId: 'L1',
      agentId: 'software-engineer',
      stageDir: null,
      launchExtensions: undefined,
      availabilityEntries: [],
      cleanup: vi.fn().mockResolvedValue(undefined),
    });

    const res = await resolveRoleAgentLaunchExtensions({
      repoRoot: '/repo',
      runtimeAgentId: 'dalton',
      stageLaunchId: 'L1',
    });

    expect(res).toMatchObject({
      stageLaunchId: 'L1',
      assignmentAgentId: 'software-engineer',
      launchExtensions: undefined,
      availabilityNote: undefined,
      extensionIds: [],
      skillCount: 0,
      pluginCount: 0,
    });
    expect(createAgentExtensionStage).toHaveBeenCalledWith({
      repoRoot: '/repo',
      agentId: 'software-engineer',
      launchId: 'L1',
    });
  });

  it('returns counts, ids, note, and launchExtensions for assigned extensions', async () => {
    loadAgentLaunchExtensionAssignments.mockResolvedValue(assignmentsWithSome());
    const cleanup = vi.fn().mockResolvedValue(undefined);
    createAgentExtensionStage.mockResolvedValue({
      launchId: 'L2',
      agentId: 'qa',
      stageDir: '/stage/L2',
      launchExtensions: { pluginDirs: ['/stage/L2/plugins/p1'], skillDirs: ['/stage/L2/skills'] },
      availabilityEntries: [
        { id: 'sk1', kind: 'skill', display_name: 'Skill One', description: 'does X', metadata: {} },
        {
          id: 'pl1',
          kind: 'plugin',
          display_name: 'Plugin One',
          description: 'does Y',
          metadata: { skill_names: ['bundledA', 'bundledB'] },
        },
      ],
      cleanup,
    });

    const res = await resolveRoleAgentLaunchExtensions({
      repoRoot: '/repo',
      runtimeAgentId: 'ron',
      stageLaunchId: 'L2',
    });

    expect(res.assignmentAgentId).toBe('qa');
    expect(res.skillCount).toBe(1);
    expect(res.pluginCount).toBe(1);
    expect(res.extensionIds).toEqual(['sk1', 'pl1']);
    expect(res.launchExtensions).toEqual({
      pluginDirs: ['/stage/L2/plugins/p1'],
      skillDirs: ['/stage/L2/skills'],
    });
    expect(res.availabilityNote).toContain('- Skill: Skill One - does X');
    expect(res.availabilityNote).toContain('- Plugin: Plugin One - does Y');
    expect(res.availabilityNote).toContain('Bundled skills: bundledA, bundledB');
    expect(res.cleanup).toBe(cleanup);
  });

  it('returns a no-op and does not stage when the runtime agent is out of scope (lily)', async () => {
    loadAgentLaunchExtensionAssignments.mockResolvedValue(assignmentsWithSome());

    const res = await resolveRoleAgentLaunchExtensions({
      repoRoot: '/repo',
      runtimeAgentId: 'lily',
      stageLaunchId: 'L3',
    });

    expect(res).toMatchObject({
      stageLaunchId: 'L3',
      assignmentAgentId: undefined,
      launchExtensions: undefined,
    });
    expect(createAgentExtensionStage).not.toHaveBeenCalled();
  });
});

describe('buildRoleAgentLaunchAvailabilityNote', () => {
  it('returns undefined for no entries', () => {
    expect(buildRoleAgentLaunchAvailabilityNote([])).toBeUndefined();
  });

  it('includes names, kinds, descriptions, and cached bundled skill names only', () => {
    const note = buildRoleAgentLaunchAvailabilityNote([
      { id: 's', kind: 'skill', display_name: 'My Skill', description: 'Skill desc', metadata: {} },
      {
        id: 'p',
        kind: 'plugin',
        display_name: 'My Plugin',
        description: 'Plugin desc',
        metadata: { skill_names: ['b1', 'b2'], plugin_component_classes: ['hooks'] },
      },
    ])!;

    expect(note).toContain('- Skill: My Skill - Skill desc');
    expect(note).toContain('- Plugin: My Plugin - Plugin desc');
    expect(note).toContain('  Bundled skills: b1, b2');
    expect(note).toContain('do not change your assignment');
    // Never leaks staged/source paths, manifests, provider env names, or .platform-state.
    expect(note).not.toMatch(/\.platform-state|COPILOT_SKILLS_DIRS|--plugin-dir|plugin\.json|runtime_path|staged_path/);
  });

  it('omits the bundled-skills line for plugins without cached skill names', () => {
    const note = buildRoleAgentLaunchAvailabilityNote([
      { id: 'p', kind: 'plugin', display_name: 'NoBundle', description: 'd', metadata: {} },
    ])!;
    expect(note).not.toContain('Bundled skills:');
  });
});

describe('prependRoleAgentLaunchAvailabilityNote', () => {
  it('prepends the note with a separator', () => {
    expect(prependRoleAgentLaunchAvailabilityNote({ prompt: 'PROMPT', availabilityNote: 'NOTE' }))
      .toBe('NOTE\n\n---\n\nPROMPT');
  });

  it('returns the prompt unchanged when there is no note', () => {
    expect(prependRoleAgentLaunchAvailabilityNote({ prompt: 'PROMPT' })).toBe('PROMPT');
  });
});

describe('cleanupRoleAgentLaunchExtensions', () => {
  it('is a no-op for an undefined resolution', async () => {
    await expect(
      cleanupRoleAgentLaunchExtensions(undefined, { repoRoot: '/r', agentId: 'dalton' }),
    ).resolves.toBeUndefined();
  });

  it('calls cleanup once and swallows cleanup failures without throwing', async () => {
    const cleanup = vi.fn().mockRejectedValue(new AgentExtensionError('stage-cleanup-rejected', 'refused'));
    const resolution: RoleAgentLaunchExtensionResolution = {
      stageLaunchId: 'L',
      assignmentAgentId: 'qa',
      launchExtensions: undefined,
      availabilityNote: undefined,
      extensionIds: [],
      skillCount: 0,
      pluginCount: 0,
      cleanup,
    };

    await expect(
      cleanupRoleAgentLaunchExtensions(resolution, { repoRoot: '/r', agentId: 'ron', launchId: 'L' }),
    ).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
