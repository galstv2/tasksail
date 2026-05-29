// Phase 2 Lily launch confirmation (lily-positive / lily-negative).
//
// Drives resolveLilyPlannerLaunchExtensions against the REAL backend staging path with a
// temp-repo fixture: production assignment + staging helpers only — never the Phase 1 POC
// resolver. Proves planning-agent assignments produce staged launchExtensions and a
// first-turn, metadata-only availability note, and that an unassigned planning-agent
// produces no stage, no launchExtensions, and no note.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveLilyPlannerLaunchExtensions } from './plannerLaunchExtensions';
import { resolveAgentExtensionStageDir } from '../../../backend/platform/agent-extensions/stage.js';
import { createPhase2ElectronFixture, type Phase2ElectronFixture } from './__tests__/phase2ExtensionFixture';

let f: Phase2ElectronFixture;

beforeEach(() => {
  f = createPhase2ElectronFixture();
});

afterEach(() => {
  f.cleanup();
});

describe('resolveLilyPlannerLaunchExtensions — lily-positive', () => {
  it('stages only planning-agent assignments and builds a metadata-only first-turn note', async () => {
    f.assignTo('planning-agent', [f.skill.id, f.plugin.id]);

    const res = await resolveLilyPlannerLaunchExtensions({
      repoRoot: f.repo,
      plannerSessionId: 'lily-phase2-pos',
      providerId: 'copilot',
    });

    expect(res.skillCount).toBe(1);
    expect(res.pluginCount).toBe(1);
    expect([...res.extensionIds].sort()).toEqual([f.plugin.id, f.skill.id].sort());
    expect(res.launchExtensions).toBeDefined();
    expect(res.launchExtensions?.skillDirs).toHaveLength(1);
    expect(res.launchExtensions?.pluginDirs).toHaveLength(1);

    // Staged content was copied (marker present in the staged skill), proving real staging ran.
    const skillDir = res.launchExtensions?.skillDirs[0] as string;
    const stagedSkill = path.join(skillDir, f.skill.id, 'SKILL.md');
    expect(fs.readFileSync(stagedSkill, 'utf-8')).toContain(f.skill.marker);

    // The availability note is metadata-only: names/kinds/descriptions, never bodies/paths/markers.
    const note = res.availabilityNote as string;
    expect(note).toContain('Optional Skills And Plugins Available This Session');
    expect(note).toContain(`- Skill: ${f.skill.displayName} - ${f.skill.description}`);
    expect(note).toContain(`- Plugin: ${f.plugin.displayName} - ${f.plugin.description}`);
    // Metadata-only: the note never carries fixture markers, staged/source paths, or the
    // repo path. (Provider env names / launch flags cannot appear: the note is built solely
    // from display names + descriptions + static text — provider rendering is covered by the
    // Copilot provider tests, which are the only place those literals belong.)
    expect(note).not.toContain(f.skill.marker);
    expect(note).not.toContain(f.plugin.marker);
    expect(note).not.toContain('.platform-state');
    expect(note).not.toContain(f.repo);

    // Cleanup removes the launch-local stage.
    const stageDir = resolveAgentExtensionStageDir(f.repo, 'lily-phase2-pos');
    expect(fs.existsSync(stageDir)).toBe(true);
    await res.cleanup();
    expect(fs.existsSync(stageDir)).toBe(false);
  });
});

describe('resolveLilyPlannerLaunchExtensions — lily-negative', () => {
  it('produces no stage, no launchExtensions, and no note when planning-agent has no assignment', async () => {
    f.assignTo('planning-agent', []); // explicit empty planning-agent assignment

    const res = await resolveLilyPlannerLaunchExtensions({
      repoRoot: f.repo,
      plannerSessionId: 'lily-phase2-neg',
      providerId: 'copilot',
    });

    expect(res.launchExtensions).toBeUndefined();
    expect(res.availabilityNote).toBeUndefined();
    expect(res.skillCount).toBe(0);
    expect(res.pluginCount).toBe(0);
    expect(res.extensionIds).toEqual([]);
    expect(fs.existsSync(resolveAgentExtensionStageDir(f.repo, 'lily-phase2-neg'))).toBe(false);
    await expect(res.cleanup()).resolves.toBeUndefined();
  });

  it('does not give Lily another agent\'s assignments (cross-role isolation)', async () => {
    // The same extensions are assigned to software-engineer, not planning-agent.
    f.assignTo('software-engineer', [f.skill.id, f.plugin.id]);

    const res = await resolveLilyPlannerLaunchExtensions({
      repoRoot: f.repo,
      plannerSessionId: 'lily-phase2-cross',
      providerId: 'copilot',
    });

    expect(res.launchExtensions).toBeUndefined();
    expect(res.availabilityNote).toBeUndefined();
    expect(res.extensionIds).toEqual([]);
    await res.cleanup();
  });
});
