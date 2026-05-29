import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  addAgentExtension,
  deleteAgentExtension,
  listAgentExtensions,
  loadAgentLaunchExtensionAssignments,
  reconcileAgentExtensions,
  reseedAgentExtension,
  saveAgentLaunchExtensionAssignments,
} from '../index.js';
import { buildDefaultFs, materializeExtension } from '../materialize.js';
import type { AgentExtensionFsAdapter, AgentExtensionMutationSeams, AgentExtensionSourceManifestEntry, AgentLaunchExtensionAssignments } from '../types.js';
import { VALID_AGENT_IDS } from '../ids.js';

// Capture every progress() event so we can assert which catalog/reconcile events fire.
const { progressCalls } = vi.hoisted(() => ({
  progressCalls: [] as Array<{ event: string; extra?: Record<string, unknown> }>,
}));

vi.mock('../../core/logger.js', () => {
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    progress(args: { event: string; extra?: Record<string, unknown> }) {
      progressCalls.push(args);
    },
    child() {
      return logger;
    },
  };
  return { createLogger: () => logger };
});

function eventsOf(name: string): Array<{ event: string; extra?: Record<string, unknown> }> {
  return progressCalls.filter((c) => c.event === name);
}

const SKILL_MD = `---
name: Test Skill
description: A skill for testing
---
# Test Skill
`;

const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;

beforeEach(() => {
  progressCalls.length = 0;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-'));
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

function makeLocalSkillEntry(id: string, srcPath: string): AgentExtensionSourceManifestEntry {
  return {
    id,
    kind: 'skill',
    provider_id: 'copilot',
    display_name: id,
    description: 'test',
    enabled: true,
    source: { type: 'local', path: srcPath },
  };
}

function createSkillSrc(id: string): string {
  const srcDir = path.join(tmpDir, `src-${id}`);
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD);
  return srcDir;
}

function writeManifest(entries: AgentExtensionSourceManifestEntry[]): void {
  fs.writeFileSync(
    path.join(tmpDir, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions: entries }),
  );
}

describe('deleteAgentExtension', () => {
  it('throws delete-blocked-by-active-assignment when the extension is assigned', async () => {
    const srcDir = createSkillSrc('del-skill');
    const entry = makeLocalSkillEntry('del-skill', srcDir);

    // Add the extension
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);
    writeManifest([entry]);

    // Assign it to an agent
    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: VALID_AGENT_IDS.map((id) => ({
        agent_id: id,
        extension_ids: id === 'software-engineer' ? ['del-skill'] : [],
      })),
    };
    await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);

    // Delete should fail (no opt-in to clear assignments)
    await expect(deleteAgentExtension(tmpDir, 'del-skill', {}, seams)).rejects.toMatchObject({
      code: 'delete-blocked-by-active-assignment',
    });

    // Manifest entry must still be present
    const manifestRaw = fs.readFileSync(
      path.join(tmpDir, 'config', 'agent-extensions.default.json'),
      'utf-8',
    );
    const manifest = JSON.parse(manifestRaw) as { extensions: { id: string }[] };
    expect(manifest.extensions.some((e) => e.id === 'del-skill')).toBe(true);
  });

  it('deletes successfully when the extension is NOT assigned', async () => {
    const srcDir = createSkillSrc('safe-del');
    const entry = makeLocalSkillEntry('safe-del', srcDir);

    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);
    writeManifest([entry]);

    // Do NOT assign it; delete should succeed
    await deleteAgentExtension(tmpDir, 'safe-del', {}, seams);

    const manifestRaw = fs.readFileSync(
      path.join(tmpDir, 'config', 'agent-extensions.default.json'),
      'utf-8',
    );
    const manifest = JSON.parse(manifestRaw) as { extensions: { id: string }[] };
    expect(manifest.extensions.some((e) => e.id === 'safe-del')).toBe(false);

    // Runtime copy should be removed
    const runtimePath = path.join(tmpDir, '.platform-state', 'skills', 'safe-del');
    expect(fs.existsSync(runtimePath)).toBe(false);
  });
});

describe('listAgentExtensions commit_sha status', () => {
  it('reports status unavailable for a git entry whose receipt lacks commit_sha', async () => {
    // Create a local entry (not git), materialize it, then patch the receipt to look like a
    // git entry with no commit_sha — simulating a receipt written before FIX 5
    const entry: AgentExtensionSourceManifestEntry = {
      id: 'no-sha-skill',
      kind: 'skill',
      provider_id: 'copilot',
      display_name: 'no-sha-skill',
      description: 'test',
      enabled: true,
      source: { type: 'git', url: 'https://example.com/r.git', ref: 'main' },
    };

    const seams: AgentExtensionMutationSeams = { now: () => NOW };

    // Materialize using a fake git execFile (no subpath, just clones SKILL.md)
    const fakeExecFile = async (
      _file: string,
      args: string[],
      _options: { cwd: string },
    ): Promise<{ stdout: string; stderr: string }> => {
      if (args[0] === 'clone') {
        const targetDir = args[args.length - 1];
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'SKILL.md'), SKILL_MD);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc123\n', stderr: '' };
      }
      throw new Error(`Unexpected: ${args.join(' ')}`);
    };

    await materializeExtension(tmpDir, entry, { ...seams, execFile: fakeExecFile });

    // Patch the receipt: remove commit_sha to simulate old receipt
    const receiptPath = path.join(
      tmpDir,
      '.platform-state',
      'agent-extensions',
      'imports',
      'skills',
      'no-sha-skill.json',
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
    delete receipt.commit_sha;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    writeManifest([entry]);

    const results = await listAgentExtensions(tmpDir, seams);
    const found = results.find((r) => r.id === 'no-sha-skill');
    expect(found).toBeDefined();
    expect(found?.status).toBe('unavailable');
  });
});

describe('catalog event emission (F4)', () => {
  it('addAgentExtension emits exactly one catalog.added and no catalog.reseeded', async () => {
    const srcDir = createSkillSrc('evt-add');
    await addAgentExtension(
      tmpDir,
      { id: 'evt-add', kind: 'skill', provider_id: 'copilot', source: { type: 'local', path: srcDir } },
      { now: () => NOW },
    );

    expect(eventsOf('agent_extensions.catalog.added')).toHaveLength(1);
    expect(eventsOf('agent_extensions.catalog.reseeded')).toHaveLength(0);
  });

  it('reseedAgentExtension emits catalog.reseeded and not catalog.added', async () => {
    const srcDir = createSkillSrc('evt-reseed');
    const entry = makeLocalSkillEntry('evt-reseed', srcDir);
    await materializeExtension(tmpDir, entry, { now: () => NOW });
    writeManifest([entry]);
    progressCalls.length = 0; // ignore setup materialize

    await reseedAgentExtension(tmpDir, 'evt-reseed', { now: () => NOW });

    expect(eventsOf('agent_extensions.catalog.reseeded')).toHaveLength(1);
    expect(eventsOf('agent_extensions.catalog.added')).toHaveLength(0);
  });

  it('reconcile materializing a missing copy emits no catalog.added/reseeded', async () => {
    const srcDir = createSkillSrc('evt-recon');
    const entry = makeLocalSkillEntry('evt-recon', srcDir);
    writeManifest([entry]); // manifest entry present, runtime copy absent
    progressCalls.length = 0;

    const result = await reconcileAgentExtensions(tmpDir, { now: () => NOW });
    expect(result.materialized).toBe(1);
    expect(eventsOf('agent_extensions.catalog.added')).toHaveLength(0);
    expect(eventsOf('agent_extensions.catalog.reseeded')).toHaveLength(0);
    expect(eventsOf('agent_extensions.reconcile.completed').length).toBeGreaterThanOrEqual(1);
  });
});

describe('addAgentExtension direct-attachment (F1)', () => {
  const SKILL_MARKDOWN = `---\nname: Direct\ndescription: A direct skill\n---\n# Direct\n`;

  it('writes config/skill-authored/<id>/SKILL.md atomically inside the transaction', async () => {
    const entry = await addAgentExtension(
      tmpDir,
      { id: 'direct-1', kind: 'skill', provider_id: 'copilot', source: { type: 'direct-attachment', skill_markdown: SKILL_MARKDOWN } },
      { now: () => NOW },
    );

    expect(entry.status).toBe('available');
    expect(entry.source_type).toBe('direct-attachment');

    const authoredPath = path.join(tmpDir, 'config', 'skill-authored', 'direct-1', 'SKILL.md');
    expect(fs.existsSync(authoredPath)).toBe(true);
    expect(fs.readFileSync(authoredPath, 'utf-8')).toBe(SKILL_MARKDOWN);

    // Runtime copy materialized from the authored file
    expect(
      fs.existsSync(path.join(tmpDir, '.platform-state', 'skills', 'direct-1', 'SKILL.md')),
    ).toBe(true);
  });

  it('does not write or overwrite the authored SKILL.md when the ID already exists', async () => {
    const existingDir = createSkillSrc('dup-direct');
    const existing = makeLocalSkillEntry('dup-direct', existingDir);
    await materializeExtension(tmpDir, existing, { now: () => NOW });
    writeManifest([existing]);

    // Pre-create authored file with sentinel content to detect any overwrite
    const authoredPath = path.join(tmpDir, 'config', 'skill-authored', 'dup-direct', 'SKILL.md');
    fs.mkdirSync(path.dirname(authoredPath), { recursive: true });
    fs.writeFileSync(authoredPath, 'SENTINEL');

    await expect(
      addAgentExtension(
        tmpDir,
        { id: 'dup-direct', kind: 'skill', provider_id: 'copilot', source: { type: 'direct-attachment', skill_markdown: SKILL_MARKDOWN } },
        { now: () => NOW },
      ),
    ).rejects.toThrow(/already exists/i);

    // Duplicate-ID check precedes the authored write — file is untouched.
    expect(fs.readFileSync(authoredPath, 'utf-8')).toBe('SENTINEL');
  });

  it('removes the authored SKILL.md when materialization fails (no orphan)', async () => {
    // Frontmatter without a description fails skill metadata validation inside materialize.
    const BAD_MARKDOWN = `---\nname: NoDesc\n---\n# Missing description\n`;
    const authoredPath = path.join(tmpDir, 'config', 'skill-authored', 'bad-direct', 'SKILL.md');

    await expect(
      addAgentExtension(
        tmpDir,
        { id: 'bad-direct', kind: 'skill', provider_id: 'copilot', source: { type: 'direct-attachment', skill_markdown: BAD_MARKDOWN } },
        { now: () => NOW },
      ),
    ).rejects.toThrow();

    // No orphaned authored file or directory, and no manifest entry.
    expect(fs.existsSync(authoredPath)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'config', 'skill-authored', 'bad-direct'))).toBe(false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'config', 'agent-extensions.default.json'), 'utf-8'),
    ) as { extensions: { id: string }[] };
    expect(manifest.extensions.some((e) => e.id === 'bad-direct')).toBe(false);
  });

  it('cleans up runtime copy, receipt, and authored file when the final manifest write fails', async () => {
    const GOOD_MARKDOWN = `---\nname: Good\ndescription: A good skill\n---\n# Good\n`;
    // fs seam that fails only the durable manifest write, after materialization succeeds.
    const realFs = buildDefaultFs();
    const failManifestFs: AgentExtensionFsAdapter = {
      ...realFs,
      writeTextFileAtomic: async (filePath, contents) => {
        if (filePath.endsWith('agent-extensions.default.json')) {
          throw new Error('simulated manifest write failure');
        }
        return realFs.writeTextFileAtomic(filePath, contents);
      },
    };

    await expect(
      addAgentExtension(
        tmpDir,
        { id: 'manifest-fail', kind: 'skill', provider_id: 'copilot', source: { type: 'direct-attachment', skill_markdown: GOOD_MARKDOWN } },
        { now: () => NOW, fs: failManifestFs },
      ),
    ).rejects.toThrow();

    // No inert residue: runtime copy, receipt, and authored file are all removed.
    expect(fs.existsSync(path.join(tmpDir, '.platform-state', 'skills', 'manifest-fail'))).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'manifest-fail.json')),
    ).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'config', 'skill-authored', 'manifest-fail'))).toBe(false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'config', 'agent-extensions.default.json'), 'utf-8'),
    ) as { extensions: { id: string }[] };
    expect(manifest.extensions.some((e) => e.id === 'manifest-fail')).toBe(false);
  });
});

describe('deleteAgentExtension with removeAssignments (F2)', () => {
  it('clears assignments first, then removes runtime copy, receipt, and manifest entry', async () => {
    const srcDir = createSkillSrc('del-unassign');
    const entry = makeLocalSkillEntry('del-unassign', srcDir);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);
    writeManifest([entry]);

    const assignments: AgentLaunchExtensionAssignments = {
      schema_version: 1,
      assignments: VALID_AGENT_IDS.map((id) => ({
        agent_id: id,
        extension_ids: id === 'software-engineer' || id === 'qa' ? ['del-unassign'] : [],
      })),
    };
    await saveAgentLaunchExtensionAssignments(tmpDir, assignments, seams);

    await deleteAgentExtension(tmpDir, 'del-unassign', { removeAssignments: true }, seams);

    // Assignment file no longer references the deleted id for any agent
    const after = await loadAgentLaunchExtensionAssignments(tmpDir, seams);
    expect(after.assignments.every((a) => !a.extension_ids.includes('del-unassign'))).toBe(true);

    // Manifest entry removed
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'config', 'agent-extensions.default.json'), 'utf-8'),
    ) as { extensions: { id: string }[] };
    expect(manifest.extensions.some((e) => e.id === 'del-unassign')).toBe(false);

    // Runtime copy + receipt removed
    expect(fs.existsSync(path.join(tmpDir, '.platform-state', 'skills', 'del-unassign'))).toBe(false);
    expect(
      fs.existsSync(
        path.join(tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'del-unassign.json'),
      ),
    ).toBe(false);
  });
});

describe('listAgentExtensions receipt consistency (F3)', () => {
  it('reports unavailable when the receipt source_type does not match the entry', async () => {
    const srcDir = createSkillSrc('mismatch');
    const entry = makeLocalSkillEntry('mismatch', srcDir);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);
    writeManifest([entry]);

    // Corrupt the receipt so its source_type no longer matches the (local) entry.
    const receiptPath = path.join(
      tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'mismatch.json',
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
    receipt.source_type = 'git';
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    const results = await listAgentExtensions(tmpDir, seams);
    expect(results.find((r) => r.id === 'mismatch')?.status).toBe('unavailable');
  });

  it('reports unavailable when the receipt is missing source_digest', async () => {
    const srcDir = createSkillSrc('no-digest');
    const entry = makeLocalSkillEntry('no-digest', srcDir);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);
    writeManifest([entry]);

    // source_digest is "populated on every successful import"; a receipt without it
    // is not a valid import receipt and must not make the entry appear available.
    const receiptPath = path.join(
      tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'no-digest.json',
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
    delete receipt.source_digest;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    const results = await listAgentExtensions(tmpDir, seams);
    expect(results.find((r) => r.id === 'no-digest')?.status).toBe('unavailable');
  });
});
