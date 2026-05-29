// Phase 2 end-to-end confirmation: catalog import → assignment → per-launch staging.
//
// Proves layers 1–5 of the spec proof-layers decision against the REAL production
// helpers (addAgentExtension / saveAgentLaunchExtensionAssignments /
// createAgentExtensionStage) with no production mocks — only a temp repo and the
// shared phase2 fixture. Live model visibility (layer 6) is proven by the manual
// canary runbook, not here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addAgentExtension,
  createAgentExtensionStage,
  listAgentExtensions,
  loadAgentLaunchExtensionAssignments,
  saveAgentLaunchExtensionAssignments,
} from '../index.js';
import type { AgentExtensionAgentId, AgentLaunchExtensionAssignments } from '../types.js';
import { createPhase2Fixtures, isGitAvailable, type Phase2FixtureHandle } from './phase2Fixture.js';

const NOW = '2026-05-28T00:00:00.000Z';
const ALL_AGENTS: AgentExtensionAgentId[] = [
  'planning-agent',
  'product-manager',
  'software-engineer',
  'software-engineer-verify',
  'qa',
];

let repo: string;
let handle: Phase2FixtureHandle;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-e2e-'));
  fs.mkdirSync(path.join(repo, '.platform-state'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions: [] }),
  );
  handle = createPhase2Fixtures();
});

afterEach(() => {
  handle?.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

function runtimeSkillDir(id: string): string {
  return path.join(repo, '.platform-state', 'skills', id);
}
function runtimePluginDir(id: string): string {
  return path.join(repo, '.platform-state', 'plugins', id);
}
function receiptPath(kind: 'skills' | 'plugins', id: string): string {
  return path.join(repo, '.platform-state', 'agent-extensions', 'imports', kind, `${id}.json`);
}
function assignmentsFile(): string {
  return path.join(repo, '.platform-state', 'agent-launch-extensions.json');
}

function assignmentsForOneAgent(
  agentId: AgentExtensionAgentId,
  extensionIds: string[],
): AgentLaunchExtensionAssignments {
  return {
    schema_version: 1,
    assignments: ALL_AGENTS.map((id) => ({
      agent_id: id,
      extension_ids: id === agentId ? extensionIds : [],
    })),
  };
}

async function importLocalSkill(): Promise<void> {
  await addAgentExtension(
    repo,
    {
      id: handle.fixture.skill.id,
      kind: 'skill',
      provider_id: 'copilot',
      source: { type: 'local', path: handle.fixture.skill.sourceDir },
    },
    { now: () => NOW },
  );
}

async function importLocalPlugin(): Promise<void> {
  await addAgentExtension(
    repo,
    {
      id: handle.fixture.plugin.id,
      kind: 'plugin',
      provider_id: 'copilot',
      source: { type: 'local', path: handle.fixture.plugin.sourceDir },
    },
    { now: () => NOW },
  );
}

async function importGitSkill(): Promise<void> {
  await addAgentExtension(
    repo,
    {
      id: handle.fixture.gitSkill.id,
      kind: 'skill',
      provider_id: 'copilot',
      source: { type: 'git', url: handle.fixture.gitSkill.bareRepoDir, ref: 'main' },
    },
    { now: () => NOW },
  );
}

describe('Phase 2 confirmation — catalog-local-skill', () => {
  it('imports a local skill into a TaskSail-owned runtime copy with cached metadata and a separate receipt', async () => {
    await importLocalSkill();
    const skill = handle.fixture.skill;

    const listed = await listAgentExtensions(repo);
    const ferret = listed.find((e) => e.id === skill.id);
    expect(ferret).toBeDefined();
    expect(ferret).toMatchObject({
      id: skill.id,
      kind: 'skill',
      provider_id: 'copilot',
      display_name: skill.displayName,
      description: skill.description,
      enabled: true,
      source_type: 'local',
      status: 'available',
    });
    expect(ferret?.metadata.skill_names).toEqual([skill.displayName]);

    // Runtime copy is TaskSail-owned and carries the source content (marker), not the source dir.
    const staged = path.join(runtimeSkillDir(skill.id), 'SKILL.md');
    expect(fs.existsSync(staged)).toBe(true);
    expect(fs.readFileSync(staged, 'utf-8')).toContain(skill.marker);

    // Import receipt is recorded under the catalog surface, separate from any launch payload.
    expect(fs.existsSync(receiptPath('skills', skill.id))).toBe(true);

    // Eligibility: it can be assigned without error.
    await expect(
      saveAgentLaunchExtensionAssignments(repo, assignmentsForOneAgent('planning-agent', [skill.id]), { now: () => NOW }),
    ).resolves.toBeDefined();
  });
});

describe('Phase 2 confirmation — catalog-local-plugin', () => {
  it('imports a local plugin with cached display metadata and a bundled-skill summary count', async () => {
    await importLocalPlugin();
    const plugin = handle.fixture.plugin;

    const listed = await listAgentExtensions(repo);
    const cobalt = listed.find((e) => e.id === plugin.id);
    expect(cobalt).toMatchObject({
      id: plugin.id,
      kind: 'plugin',
      provider_id: 'copilot',
      // Plugin display_name is the lowercase manifest `name`, not the human label.
      display_name: plugin.manifestName,
      description: plugin.description,
      enabled: true,
      source_type: 'local',
      status: 'available',
    });
    // Bundled-skill summary is a COUNT (production does not enumerate plugin skill names).
    expect(cobalt?.metadata.plugin_skill_count).toBe(1);
    expect(cobalt?.metadata.plugin_component_classes).toEqual([]);
    expect(cobalt?.metadata.skill_names).toBeUndefined();

    // Runtime copy carries the manifest and the bundled skill content.
    expect(fs.existsSync(path.join(runtimePluginDir(plugin.id), 'plugin.json'))).toBe(true);
    const bundled = path.join(runtimePluginDir(plugin.id), 'skills', plugin.bundledSkillName, 'SKILL.md');
    expect(fs.existsSync(bundled)).toBe(true);
    expect(fs.readFileSync(bundled, 'utf-8')).toContain(plugin.marker);

    expect(fs.existsSync(receiptPath('plugins', plugin.id))).toBe(true);
  });
});

describe.skipIf(!isGitAvailable())('Phase 2 confirmation — catalog-git-source', () => {
  it('imports a git-backed skill from a local bare repo and records commit metadata in the receipt only', async () => {
    await importGitSkill();
    const gitSkill = handle.fixture.gitSkill;

    const listed = await listAgentExtensions(repo);
    const entry = listed.find((e) => e.id === gitSkill.id);
    expect(entry).toMatchObject({
      id: gitSkill.id,
      kind: 'skill',
      source_type: 'git',
      status: 'available',
      display_name: gitSkill.displayName,
    });

    const runtime = path.join(runtimeSkillDir(gitSkill.id), 'SKILL.md');
    expect(fs.readFileSync(runtime, 'utf-8')).toContain(gitSkill.marker);

    // commit_sha lives in the receipt (catalog surface), resolved from the local repo HEAD.
    const receipt = JSON.parse(fs.readFileSync(receiptPath('skills', gitSkill.id), 'utf-8'));
    expect(receipt.commit_sha).toBe(gitSkill.commitSha);
    expect(receipt.source_type).toBe('git');
  });
});

describe('Phase 2 confirmation — assignment-role-specific', () => {
  it('isolates assignments by agent ID and persists stable extension IDs only (no paths/metadata/markers)', async () => {
    await importLocalSkill();
    await importLocalPlugin();
    const { skill, plugin } = handle.fixture;

    await saveAgentLaunchExtensionAssignments(
      repo,
      {
        schema_version: 1,
        assignments: [
          { agent_id: 'planning-agent', extension_ids: [skill.id] },
          { agent_id: 'product-manager', extension_ids: [] },
          { agent_id: 'software-engineer', extension_ids: [plugin.id] },
          { agent_id: 'software-engineer-verify', extension_ids: [] },
          { agent_id: 'qa', extension_ids: [] },
        ],
      },
      { now: () => NOW },
    );

    const loaded = await loadAgentLaunchExtensionAssignments(repo);
    const byAgent = new Map(loaded.assignments.map((a) => [a.agent_id, a.extension_ids]));
    expect(byAgent.get('planning-agent')).toEqual([skill.id]);
    expect(byAgent.get('software-engineer')).toEqual([plugin.id]);
    expect(byAgent.get('product-manager')).toEqual([]);
    expect(byAgent.get('qa')).toEqual([]);

    // The persisted file stores IDs only — never source dirs, runtime/staged paths, or markers.
    const rawAssignments = fs.readFileSync(assignmentsFile(), 'utf-8');
    expect(rawAssignments).not.toContain(skill.sourceDir);
    expect(rawAssignments).not.toContain(plugin.sourceDir);
    expect(rawAssignments).not.toContain(skill.marker);
    expect(rawAssignments).not.toContain(plugin.marker);
    expect(rawAssignments).not.toContain('.platform-state');
    for (const a of JSON.parse(rawAssignments).assignments) {
      expect(Object.keys(a).sort()).toEqual(['agent_id', 'extension_ids']);
    }
  });
});

describe('Phase 2 confirmation — staging-immutable + cross-role isolation', () => {
  async function importAndAssignAll(): Promise<void> {
    await importLocalSkill();
    await importLocalPlugin();
    const { skill, plugin } = handle.fixture;
    await saveAgentLaunchExtensionAssignments(
      repo,
      {
        schema_version: 1,
        assignments: [
          { agent_id: 'planning-agent', extension_ids: [skill.id] },
          { agent_id: 'product-manager', extension_ids: [] },
          { agent_id: 'software-engineer', extension_ids: [plugin.id] },
          { agent_id: 'software-engineer-verify', extension_ids: [] },
          { agent_id: 'qa', extension_ids: [] },
        ],
      },
      { now: () => NOW },
    );
  }

  it('stages only the assigned skill for planning-agent and copies content once', async () => {
    await importAndAssignAll();
    const { skill, plugin } = handle.fixture;

    const stage = await createAgentExtensionStage({ repoRoot: repo, agentId: 'planning-agent', launchId: 'launch-plan', now: () => NOW });
    const stageDir = stage.stageDir as string;

    expect(stage.launchExtensions?.skillDirs).toEqual([path.join(stageDir, 'skills')]);
    expect(stage.launchExtensions?.pluginDirs).toEqual([]);
    const stagedSkill = path.join(stageDir, 'skills', skill.id, 'SKILL.md');
    expect(fs.readFileSync(stagedSkill, 'utf-8')).toContain(skill.marker);

    // Cross-role isolation: the plugin assigned to software-engineer is absent here.
    expect(fs.existsSync(path.join(stageDir, 'plugins', plugin.id))).toBe(false);
    expect(stage.availabilityEntries.map((e) => e.id)).toEqual([skill.id]);

    await stage.cleanup();
    expect(fs.existsSync(stageDir)).toBe(false);
  });

  it('stages only the assigned plugin for software-engineer', async () => {
    await importAndAssignAll();
    const { skill, plugin } = handle.fixture;

    const stage = await createAgentExtensionStage({ repoRoot: repo, agentId: 'software-engineer', launchId: 'launch-swe', now: () => NOW });
    const stageDir = stage.stageDir as string;

    expect(stage.launchExtensions?.pluginDirs).toEqual([path.join(stageDir, 'plugins', plugin.id)]);
    expect(stage.launchExtensions?.skillDirs).toEqual([]);
    expect(fs.existsSync(path.join(stageDir, 'plugins', plugin.id, 'plugin.json'))).toBe(true);
    // Cross-role isolation: the skill assigned to planning-agent is absent here.
    expect(fs.existsSync(path.join(stageDir, 'skills', skill.id))).toBe(false);
    expect(stage.availabilityEntries.map((e) => e.id)).toEqual([plugin.id]);

    await stage.cleanup();
  });

  it('keeps the staged snapshot unchanged when the canonical runtime copy is edited after staging', async () => {
    await importAndAssignAll();
    const { skill } = handle.fixture;

    const stage = await createAgentExtensionStage({ repoRoot: repo, agentId: 'planning-agent', launchId: 'launch-snap', now: () => NOW });
    const stagedSkill = path.join(stage.stageDir as string, 'skills', skill.id, 'SKILL.md');

    // Mutate the canonical runtime copy after staging.
    fs.writeFileSync(
      path.join(runtimeSkillDir(skill.id), 'SKILL.md'),
      `---\nname: ${skill.displayName}\ndescription: ${skill.description}\n---\n\nMUTATED-AFTER-STAGE\n`,
    );

    const stagedContent = fs.readFileSync(stagedSkill, 'utf-8');
    expect(stagedContent).toContain(skill.marker);
    expect(stagedContent).not.toContain('MUTATED-AFTER-STAGE');

    await stage.cleanup();
  });

  it('produces a no-op stage for an agent with no assignment (negative case)', async () => {
    await importAndAssignAll();

    const stage = await createAgentExtensionStage({ repoRoot: repo, agentId: 'product-manager', launchId: 'launch-none', now: () => NOW });
    expect(stage.stageDir).toBeNull();
    expect(stage.launchExtensions).toBeUndefined();
    expect(stage.availabilityEntries).toEqual([]);
    await expect(stage.cleanup()).resolves.toBeUndefined();
  });
});
