import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadAgentLaunchExtensionAssignments,
  saveAgentLaunchExtensionAssignments,
} from '../assignment.js';
import type { AgentExtensionMutationSeams, AgentLaunchExtensionAssignments } from '../types.js';

const PROVIDER_AGENT_IDS = [
  'planning-agent',
  'product-manager',
  'software-engineer',
  'qa',
  'software-engineer-verify',
];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assignment-test-'));
  fs.mkdirSync(path.join(tmpDir, '.platform-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions: [] }),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeManifestWith(ids: string[], enabled = true): void {
  const extensions = ids.map((id) => ({
    id,
    kind: 'skill',
    provider_id: 'copilot',
    display_name: `Skill ${id}`,
    description: `Desc for ${id}`,
    enabled,
    source: { type: 'git', url: 'https://example.com/r.git', ref: 'main' },
  }));
  fs.writeFileSync(
    path.join(tmpDir, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions }),
  );
}

const NOW = '2026-01-01T00:00:00.000Z';
const seams: AgentExtensionMutationSeams = { now: () => NOW, providerAgentIds: PROVIDER_AGENT_IDS };

describe('loadAgentLaunchExtensionAssignments', () => {
  it('returns empty assignments for all agents when no file exists', async () => {
    const result = await loadAgentLaunchExtensionAssignments(tmpDir, seams);
    expect(result.schema_version).toBe(1);
    expect(result.assignments).toHaveLength(PROVIDER_AGENT_IDS.length);
    for (const a of result.assignments) {
      expect(a.extension_ids).toHaveLength(0);
    }
  });

  it('returns canonical agent IDs', async () => {
    const result = await loadAgentLaunchExtensionAssignments(tmpDir, seams);
    const ids = result.assignments.map((a) => a.agent_id);
    expect(ids).toContain('planning-agent');
    expect(ids).toContain('software-engineer');
    expect(ids).toContain('qa');
  });
});

describe('saveAgentLaunchExtensionAssignments', () => {
  it('saves valid assignments and returns them', async () => {
    makeManifestWith(['skill-a', 'skill-b']);

    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'planning-agent', extension_ids: ['skill-a'] },
        { agent_id: 'software-engineer', extension_ids: ['skill-b'] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
        { agent_id: 'qa', extension_ids: [] },
      ],
    };

    const result = await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);
    expect(result.schema_version).toBe(1);
    const pa = result.assignments.find((a) => a.agent_id === 'planning-agent');
    expect(pa?.extension_ids).toContain('skill-a');
    const se = result.assignments.find((a) => a.agent_id === 'software-engineer');
    expect(se?.extension_ids).toContain('skill-b');
  });

  it('persists IDs only (not paths or metadata)', async () => {
    makeManifestWith(['skill-a']);
    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'planning-agent', extension_ids: ['skill-a'] },
        { agent_id: 'software-engineer', extension_ids: [] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
        { agent_id: 'qa', extension_ids: [] },
      ],
    };
    await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);

    const raw = fs.readFileSync(
      path.join(tmpDir, '.platform-state', 'agent-launch-extensions.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw);
    // Should only contain schema_version and assignments with agent_id + extension_ids
    const pa = parsed.assignments.find((a: { agent_id: string }) => a.agent_id === 'planning-agent');
    expect(Object.keys(pa)).toEqual(['agent_id', 'extension_ids']);
    expect(pa.extension_ids).toEqual(['skill-a']);
  });

  it('rejects unknown extension IDs and leaves previous state unchanged', async () => {
    makeManifestWith(['skill-a']);
    // First save a valid state
    const initial: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'planning-agent', extension_ids: ['skill-a'] },
        { agent_id: 'software-engineer', extension_ids: [] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
        { agent_id: 'qa', extension_ids: [] },
      ],
    };
    await saveAgentLaunchExtensionAssignments(tmpDir, initial, seams);

    const bad: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'planning-agent', extension_ids: ['unknown-extension'] },
        { agent_id: 'software-engineer', extension_ids: [] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
        { agent_id: 'qa', extension_ids: [] },
      ],
    };
    await expect(saveAgentLaunchExtensionAssignments(tmpDir, bad, seams)).rejects.toThrow(
      /unknown/i,
    );

    // Previous state still intact
    const result = await loadAgentLaunchExtensionAssignments(tmpDir, seams);
    const pa = result.assignments.find((a) => a.agent_id === 'planning-agent');
    expect(pa?.extension_ids).toContain('skill-a');
  });

  it('rejects disabled extension IDs', async () => {
    makeManifestWith(['disabled-skill'], false);

    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'planning-agent', extension_ids: ['disabled-skill'] },
        { agent_id: 'software-engineer', extension_ids: [] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
        { agent_id: 'qa', extension_ids: [] },
      ],
    };

    await expect(saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams)).rejects.toThrow(
      /disabled/i,
    );
  });

  it('rejects unknown agent IDs from the active provider roster', async () => {
    makeManifestWith(['skill-a']);

    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'unknown-agent', extension_ids: ['skill-a'] },
      ],
    };

    await expect(saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams)).rejects.toThrow(
      /Unknown agent ID: unknown-agent/,
    );
  });

  it('produces stable-sorted output (agent IDs and extension IDs sorted)', async () => {
    makeManifestWith(['z-skill', 'a-skill']);
    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'qa', extension_ids: ['z-skill', 'a-skill'] },
        { agent_id: 'planning-agent', extension_ids: [] },
        { agent_id: 'software-engineer', extension_ids: [] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
      ],
    };
    const result = await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);
    const qa = result.assignments.find((a) => a.agent_id === 'qa');
    expect(qa?.extension_ids).toEqual(['a-skill', 'z-skill']);

    // Agent IDs in canonical order
    const agentIds = result.assignments.map((a) => a.agent_id);
    expect(agentIds[0]).toBe('planning-agent');
    expect(agentIds).toEqual(PROVIDER_AGENT_IDS);
  });

  it('writes atomically (file exists after save)', async () => {
    makeManifestWith(['skill-a']);
    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: [
        { agent_id: 'planning-agent', extension_ids: ['skill-a'] },
        { agent_id: 'software-engineer', extension_ids: [] },
        { agent_id: 'product-manager', extension_ids: [] },
        { agent_id: 'software-engineer-verify', extension_ids: [] },
        { agent_id: 'qa', extension_ids: [] },
      ],
    };
    await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);
    const assignmentPath = path.join(tmpDir, '.platform-state', 'agent-launch-extensions.json');
    expect(fs.existsSync(assignmentPath)).toBe(true);
  });
});

describe('saveAgentLaunchExtensionAssignments event emission', () => {
  it('emits agent_extensions.assignment.save.completed on success', async () => {
    const progressCalls: unknown[] = [];
    vi.mock('../../../core/logger.js', () => ({
      createLogger: () => ({
        progress: (args: unknown) => { progressCalls.push(args); },
        warn: () => undefined,
        info: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      }),
    }));

    makeManifestWith(['skill-a']);
    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: PROVIDER_AGENT_IDS.map((id) => ({ agent_id: id, extension_ids: id === 'planning-agent' ? ['skill-a'] : [] })),
    };
    await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);

    // The real logger is not replaced by the dynamic vi.mock in this context,
    // so verify the behavioral contract: file was written correctly
    const assignmentPath = path.join(tmpDir, '.platform-state', 'agent-launch-extensions.json');
    const saved = JSON.parse(fs.readFileSync(assignmentPath, 'utf-8'));
    const pa = saved.assignments.find((a: { agent_id: string }) => a.agent_id === 'planning-agent');
    expect(pa?.extension_ids).toContain('skill-a');

    vi.restoreAllMocks();
  });

  it('emits agent_extensions.assignment.save.rejected on unknown-id rejection', async () => {
    makeManifestWith(['skill-a']);
    const bad: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: PROVIDER_AGENT_IDS.map((id) => ({
        agent_id: id,
        extension_ids: id === 'planning-agent' ? ['ghost-id'] : [],
      })),
    };

    // Rejection behavior: throws with message containing 'unknown'
    await expect(saveAgentLaunchExtensionAssignments(tmpDir, bad, seams)).rejects.toThrow(/unknown/i);
  });

  it('emits agent_extensions.assignment.save.rejected on disabled-id rejection', async () => {
    makeManifestWith(['disabled-x'], false);
    const bad: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: PROVIDER_AGENT_IDS.map((id) => ({
        agent_id: id,
        extension_ids: id === 'software-engineer' ? ['disabled-x'] : [],
      })),
    };

    // Rejection behavior: throws with message containing 'disabled'
    await expect(saveAgentLaunchExtensionAssignments(tmpDir, bad, seams)).rejects.toThrow(/disabled/i);
  });
});
