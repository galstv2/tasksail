import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createAgentExtensionStage,
  cleanupAgentExtensionStage,
  recoverAgentExtensionStagesOnStartup,
  assertValidAgentExtensionLaunchId,
  resolveAgentExtensionStageRoot,
  resolveAgentExtensionStageDir,
  stageCopyDirectory,
  saveAgentLaunchExtensionAssignments,
} from '../index.js';
import { createRoleLaunchId } from '../../agent-runner/roleAgent.js';
import type { AgentExtensionAgentId } from '../types.js';

const NOW = '2026-02-02T00:00:00.000Z';
const AGENT: AgentExtensionAgentId = 'software-engineer';
const ALL_AGENTS: AgentExtensionAgentId[] = [
  'planning-agent',
  'product-manager',
  'software-engineer',
  'software-engineer-verify',
  'qa',
];

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stage-test-'));
  fs.mkdirSync(path.join(repo, '.platform-state'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions: [] }),
  );
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

type Ext = { id: string; kind: 'skill' | 'plugin'; enabled?: boolean };

function writeManifest(exts: Ext[]): void {
  const extensions = exts.map((e) => ({
    id: e.id,
    kind: e.kind,
    provider_id: 'copilot',
    display_name: `Name ${e.id}`,
    description: `Desc ${e.id}`,
    enabled: e.enabled ?? true,
    source: { type: 'git', url: 'https://example.com/r.git', ref: 'main' },
  }));
  fs.writeFileSync(
    path.join(repo, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions }, null, 2),
  );
}

function writeRuntimeSkill(id: string, body = 'default-body'): string {
  const dir = path.join(repo, '.platform-state', 'skills', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: Name ${id}\ndescription: Desc ${id}\n---\n${body}\n`,
  );
  return dir;
}

function writeRuntimePlugin(id: string): string {
  const dir = path.join(repo, '.platform-state', 'plugins', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ name: `Name ${id}`, description: `Desc ${id}` }, null, 2),
  );
  return dir;
}

function writeAssignments(byAgent: Partial<Record<AgentExtensionAgentId, string[]>>): void {
  const assignments = ALL_AGENTS.map((agent_id) => ({
    agent_id,
    extension_ids: byAgent[agent_id] ?? [],
  }));
  fs.writeFileSync(
    path.join(repo, '.platform-state', 'agent-launch-extensions.json'),
    JSON.stringify({ schema_version: 1, assignments }, null, 2),
  );
}

function stageOf(launchId: string): string {
  return resolveAgentExtensionStageDir(repo, launchId);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await delay(5);
  }
}

describe('createAgentExtensionStage — empty and basic shapes', () => {
  it('returns no stage dir, undefined launchExtensions, and a no-op cleanup when no enabled assignments', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({}); // software-engineer has no assignments

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-empty', now: () => NOW });

    expect(res.stageDir).toBeNull();
    expect(res.launchExtensions).toBeUndefined();
    expect(res.availabilityEntries).toEqual([]);
    await expect(res.cleanup()).resolves.toBeUndefined();
    expect(fs.existsSync(stageOf('launch-empty'))).toBe(false);
  });

  it('stages one assigned skill and returns skillDirs [stageDir/skills]', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a', 'hello-skill');
    writeAssignments({ [AGENT]: ['skill-a'] });

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-1', now: () => NOW });
    const stageDir = stageOf('launch-1');

    expect(res.stageDir).toBe(stageDir);
    expect(res.launchExtensions?.skillDirs).toEqual([path.join(stageDir, 'skills')]);
    expect(res.launchExtensions?.pluginDirs).toEqual([]);
    const staged = path.join(stageDir, 'skills', 'skill-a', 'SKILL.md');
    expect(fs.existsSync(staged)).toBe(true);
    expect(fs.readFileSync(staged, 'utf-8')).toContain('hello-skill');
  });

  it('stages multiple assigned skills under the same parent in deterministic ID order', async () => {
    writeManifest([
      { id: 'z-skill', kind: 'skill' },
      { id: 'a-skill', kind: 'skill' },
      { id: 'm-skill', kind: 'skill' },
    ]);
    writeRuntimeSkill('z-skill');
    writeRuntimeSkill('a-skill');
    writeRuntimeSkill('m-skill');
    writeAssignments({ [AGENT]: ['z-skill', 'a-skill', 'm-skill'] });

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-multi', now: () => NOW });
    const stageDir = res.stageDir as string;

    for (const id of ['a-skill', 'm-skill', 'z-skill']) {
      expect(fs.existsSync(path.join(stageDir, 'skills', id, 'SKILL.md'))).toBe(true);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf-8'));
    expect(manifest.entries.map((e: { id: string }) => e.id)).toEqual(['a-skill', 'm-skill', 'z-skill']);
    expect(res.launchExtensions?.skillDirs).toEqual([path.join(stageDir, 'skills')]);
  });

  it('stages one assigned plugin and returns that child directory in pluginDirs', async () => {
    writeManifest([{ id: 'plug-a', kind: 'plugin' }]);
    writeRuntimePlugin('plug-a');
    writeAssignments({ [AGENT]: ['plug-a'] });

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-plug', now: () => NOW });
    const stageDir = res.stageDir as string;

    expect(res.launchExtensions?.pluginDirs).toEqual([path.join(stageDir, 'plugins', 'plug-a')]);
    expect(res.launchExtensions?.skillDirs).toEqual([]);
    expect(fs.existsSync(path.join(stageDir, 'plugins', 'plug-a', 'plugin.json'))).toBe(true);
  });

  it('stages mixed skills and plugins and returns both arrays without raw catalog source paths', async () => {
    writeManifest([
      { id: 'skill-a', kind: 'skill' },
      { id: 'plug-a', kind: 'plugin' },
    ]);
    writeRuntimeSkill('skill-a');
    writeRuntimePlugin('plug-a');
    writeAssignments({ [AGENT]: ['skill-a', 'plug-a'] });

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-mix', now: () => NOW });
    const stageDir = res.stageDir as string;

    expect(res.launchExtensions?.skillDirs).toEqual([path.join(stageDir, 'skills')]);
    expect(res.launchExtensions?.pluginDirs).toEqual([path.join(stageDir, 'plugins', 'plug-a')]);

    const all = [...(res.launchExtensions?.skillDirs ?? []), ...(res.launchExtensions?.pluginDirs ?? [])];
    for (const d of all) {
      // Every returned dir is under the launch-local stage, never the canonical runtime copy.
      expect(d.startsWith(stageDir)).toBe(true);
      expect(d).not.toContain(path.join('.platform-state', 'skills', 'skill-a'));
      expect(d).not.toContain(path.join('.platform-state', 'plugins', 'plug-a'));
    }
  });

  it('keeps staged copies unchanged when the canonical runtime copy is edited after stage creation', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    const canonicalDir = writeRuntimeSkill('skill-a', 'original-content');
    writeAssignments({ [AGENT]: ['skill-a'] });

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-snap', now: () => NOW });
    const stagedSkill = path.join(res.stageDir as string, 'skills', 'skill-a', 'SKILL.md');

    fs.writeFileSync(
      path.join(canonicalDir, 'SKILL.md'),
      `---\nname: Name skill-a\ndescription: Desc skill-a\n---\nMUTATED-AFTER-STAGE\n`,
    );

    const stagedContent = fs.readFileSync(stagedSkill, 'utf-8');
    expect(stagedContent).toContain('original-content');
    expect(stagedContent).not.toContain('MUTATED-AFTER-STAGE');
  });
});

describe('createAgentExtensionStage — shared lock and validation', () => {
  it('serializes a concurrent assignment save behind active stage creation via the shared lock', async () => {
    writeManifest([
      { id: 'skill-a', kind: 'skill' },
      { id: 'skill-b', kind: 'skill' },
    ]);
    writeRuntimeSkill('skill-a');
    writeRuntimeSkill('skill-b');
    writeAssignments({ [AGENT]: ['skill-a'] });

    const order: string[] = [];
    let releaseCopy!: () => void;
    const gate = new Promise<void>((res) => { releaseCopy = res; });
    const copyDirectory = async (src: string, dst: string): Promise<void> => {
      order.push('copy:start');
      await gate;
      await stageCopyDirectory(src, dst);
      order.push('copy:end');
    };

    const stageP = createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-lock', now: () => NOW, copyDirectory });
    await waitFor(() => order.includes('copy:start'));

    // saveAgentLaunchExtensionAssignments (a catalog/assignment mutation) acquires the SAME
    // withAgentExtensionsLock that reseed and delete acquire, so it must wait behind staging.
    const saveP = saveAgentLaunchExtensionAssignments(
      repo,
      {
        schema_version: 1,
        assignments: [
          { agent_id: 'planning-agent', extension_ids: ['skill-b'] },
          { agent_id: 'product-manager', extension_ids: [] },
          { agent_id: 'software-engineer', extension_ids: ['skill-a'] },
          { agent_id: 'software-engineer-verify', extension_ids: [] },
          { agent_id: 'qa', extension_ids: [] },
        ],
      },
      { now: () => NOW },
    ).then(() => { order.push('save:done'); });

    await delay(150);
    expect(order).not.toContain('save:done'); // blocked behind staging

    releaseCopy();
    await Promise.all([stageP, saveP]);
    expect(order).toEqual(['copy:start', 'copy:end', 'save:done']);
  }, 20000);

  it('completes stage creation without re-acquiring the non-reentrant lock (no self-deadlock)', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['skill-a'] });

    // The lock-free read helpers (loadAssignments, loadAgentExtensionRuntimeCatalogForStaging)
    // run inside the single held lock. A re-acquire would spin to the retry ceiling and exceed
    // the test timeout; a fast successful resolve proves no self-deadlock.
    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-nodl', now: () => NOW });
    expect(res.stageDir).toBe(stageOf('launch-nodl'));
    expect(res.launchExtensions?.skillDirs).toHaveLength(1);
  });

  it('rejects invalid launch IDs before any filesystem mutation', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['skill-a'] });

    for (const bad of ['bad id!', '..', '.', '', 'a/../b']) {
      await expect(
        createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: bad, now: () => NOW }),
      ).rejects.toThrow(/invalid launch id/i);
    }
    // Validation fails before the lock and before the stage root is created.
    expect(fs.existsSync(resolveAgentExtensionStageRoot(repo))).toBe(false);
  });

  it('rejects unknown assignment IDs and removes the partial stage directory', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['ghost-id'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-unknown', now: () => NOW }),
    ).rejects.toThrow(/catalog/i);
    expect(fs.existsSync(stageOf('launch-unknown'))).toBe(false);
  });

  it('rejects disabled assignment IDs', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill', enabled: false }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['skill-a'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-disabled', now: () => NOW }),
    ).rejects.toThrow(/disabled/i);
    expect(fs.existsSync(stageOf('launch-disabled'))).toBe(false);
  });

  it('rejects a missing canonical runtime directory', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    // intentionally do not create .platform-state/skills/skill-a
    writeAssignments({ [AGENT]: ['skill-a'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-missing', now: () => NOW }),
    ).rejects.toThrow(/missing/i);
    expect(fs.existsSync(stageOf('launch-missing'))).toBe(false);
  });

  it('rejects a canonical runtime path that escapes the kind-specific root', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    // Make the runtime "copy" a symlink to a directory outside .platform-state/skills.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-outside-'));
    fs.writeFileSync(path.join(outside, 'SKILL.md'), `---\nname: x\ndescription: y\n---\nz\n`);
    fs.mkdirSync(path.join(repo, '.platform-state', 'skills'), { recursive: true });
    fs.symlinkSync(outside, path.join(repo, '.platform-state', 'skills', 'skill-a'), 'dir');
    writeAssignments({ [AGENT]: ['skill-a'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-escape', now: () => NOW }),
    ).rejects.toThrow(/escape|platform-state root/i);
    expect(fs.existsSync(stageOf('launch-escape'))).toBe(false);

    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('rejects symlinks inside a skill runtime copy', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    const dir = writeRuntimeSkill('skill-a');
    const target = path.join(repo, '.platform-state', 'skill-secret.txt');
    fs.writeFileSync(target, 'secret');
    fs.symlinkSync(target, path.join(dir, 'link.txt'));
    writeAssignments({ [AGENT]: ['skill-a'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-symin-s', now: () => NOW }),
    ).rejects.toThrow(/symlink/i);
    expect(fs.existsSync(stageOf('launch-symin-s'))).toBe(false);
  });

  it('rejects symlinks inside a plugin runtime copy', async () => {
    writeManifest([{ id: 'plug-a', kind: 'plugin' }]);
    const dir = writeRuntimePlugin('plug-a');
    const target = path.join(repo, '.platform-state', 'plugin-secret.txt');
    fs.writeFileSync(target, 'secret');
    fs.symlinkSync(target, path.join(dir, 'link.txt'));
    writeAssignments({ [AGENT]: ['plug-a'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-symin-p', now: () => NOW }),
    ).rejects.toThrow(/symlink/i);
    expect(fs.existsSync(stageOf('launch-symin-p'))).toBe(false);
  });

  it('rejects a skill runtime root that is itself a symlink to another dir inside the kind root', async () => {
    writeManifest([{ id: 'skill-link', kind: 'skill' }]);
    // Real target dir inside the SAME kind root, so the canonical-containment check passes;
    // only a root lstat distinguishes the symlinked runtime root from a real directory.
    const realDir = writeRuntimeSkill('skill-real');
    fs.symlinkSync(realDir, path.join(repo, '.platform-state', 'skills', 'skill-link'), 'dir');
    writeAssignments({ [AGENT]: ['skill-link'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-rootlink-s', now: () => NOW }),
    ).rejects.toThrow(/symlink/i);
    expect(fs.existsSync(stageOf('launch-rootlink-s'))).toBe(false);
  });

  it('rejects a plugin runtime root that is itself a symlink to another dir inside the kind root', async () => {
    writeManifest([{ id: 'plug-link', kind: 'plugin' }]);
    const realDir = writeRuntimePlugin('plug-real');
    fs.symlinkSync(realDir, path.join(repo, '.platform-state', 'plugins', 'plug-link'), 'dir');
    writeAssignments({ [AGENT]: ['plug-link'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-rootlink-p', now: () => NOW }),
    ).rejects.toThrow(/symlink/i);
    expect(fs.existsSync(stageOf('launch-rootlink-p'))).toBe(false);
  });

  it('rejects a runtime root that is a regular file rather than a directory', async () => {
    writeManifest([{ id: 'skill-file', kind: 'skill' }]);
    fs.mkdirSync(path.join(repo, '.platform-state', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.platform-state', 'skills', 'skill-file'), 'not a dir');
    writeAssignments({ [AGENT]: ['skill-file'] });

    await expect(
      createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-notdir', now: () => NOW }),
    ).rejects.toThrow(/not a directory/i);
    expect(fs.existsSync(stageOf('launch-notdir'))).toBe(false);
  });
});

describe('createAgentExtensionStage — manifest, failure, re-stage', () => {
  it('writes manifest status creating before copy and updates to created after copy', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['skill-a'] });

    const stageDir = stageOf('launch-manifest');
    let statusDuringCopy: string | undefined;
    const copyDirectory = async (src: string, dst: string): Promise<void> => {
      const m = JSON.parse(fs.readFileSync(path.join(stageDir, 'manifest.json'), 'utf-8'));
      statusDuringCopy = m.status;
      await stageCopyDirectory(src, dst);
    };

    const res = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-manifest', now: () => NOW, copyDirectory });

    expect(statusDuringCopy).toBe('creating');
    const finalManifest = JSON.parse(fs.readFileSync(path.join(res.stageDir as string, 'manifest.json'), 'utf-8'));
    expect(finalManifest.status).toBe('created');
    expect(finalManifest.created_at).toBe(NOW);
    expect(finalManifest.launch_id).toBe('launch-manifest');
    expect(finalManifest.agent_id).toBe(AGENT);
    expect(finalManifest.schema_version).toBe(1);
  });

  it('removes the partial stage directory and throws a content-safe error when copy fails', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['skill-a'] });

    const copyDirectory = async (): Promise<void> => {
      throw new Error('ENOSPC: no space left on device, copy /private/var/secret-source/path');
    };

    let caught: Error | undefined;
    try {
      await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'launch-copyfail', now: () => NOW, copyDirectory });
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    // Content-safe: the raw filesystem path from the copy error does not leak out.
    expect(caught?.message ?? '').not.toContain('secret-source');
    expect(caught?.message ?? '').toMatch(/copy/i);
    expect(fs.existsSync(stageOf('launch-copyfail'))).toBe(false);
  });

  it('re-stages over a pre-existing stage directory by replacing it, never merging prior contents', async () => {
    writeManifest([
      { id: 'skill-a', kind: 'skill' },
      { id: 'skill-b', kind: 'skill' },
    ]);
    writeRuntimeSkill('skill-a');
    writeRuntimeSkill('skill-b');

    writeAssignments({ [AGENT]: ['skill-a'] });
    const first = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'reuse', now: () => NOW });
    expect(fs.existsSync(path.join(first.stageDir as string, 'skills', 'skill-a'))).toBe(true);

    // Reuse the same launch ID (role-agent retries do this) with a different assignment.
    writeAssignments({ [AGENT]: ['skill-b'] });
    const second = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'reuse', now: () => NOW });

    expect(second.stageDir).toBe(first.stageDir);
    expect(fs.existsSync(path.join(second.stageDir as string, 'skills', 'skill-b'))).toBe(true);
    // The prior attempt's skill-a must be gone — replace, not merge.
    expect(fs.existsSync(path.join(second.stageDir as string, 'skills', 'skill-a'))).toBe(false);
  });
});

describe('cleanupAgentExtensionStage', () => {
  it('succeeds for a missing stage directory', async () => {
    await expect(cleanupAgentExtensionStage({ repoRoot: repo, launchId: 'never-staged' })).resolves.toBeUndefined();
  });

  it('removes only the matching launch directory', async () => {
    writeManifest([{ id: 'skill-a', kind: 'skill' }]);
    writeRuntimeSkill('skill-a');
    writeAssignments({ [AGENT]: ['skill-a'] });

    const a = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'keep-a', now: () => NOW });
    const b = await createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'remove-b', now: () => NOW });

    await cleanupAgentExtensionStage({ repoRoot: repo, launchId: 'remove-b' });
    expect(fs.existsSync(b.stageDir as string)).toBe(false);
    expect(fs.existsSync(a.stageDir as string)).toBe(true);
  });

  it('refuses to remove a path outside the stage root', async () => {
    // The parent of the stage root holds a sentinel that must survive a traversal launchId.
    const runtimeDir = path.join(repo, '.platform-state', 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'keep.txt'), 'keep');

    await expect(cleanupAgentExtensionStage({ repoRoot: repo, launchId: '..' })).rejects.toThrow();
    expect(fs.existsSync(path.join(runtimeDir, 'keep.txt'))).toBe(true);
  });
});

describe('launch-id validation and default copy', () => {
  it('accepts createRoleLaunchId output so future launch-id reuse stays valid', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => assertValidAgentExtensionLaunchId(createRoleLaunchId())).not.toThrow();
    }
  });

  it('default copyDirectory copies symlinks verbatim without dereferencing their targets', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cp-src-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cp-ext-'));
    fs.writeFileSync(path.join(external, 'secret.txt'), 'TOP-SECRET');
    fs.writeFileSync(path.join(src, 'real.txt'), 'real');
    fs.symlinkSync(path.join(external, 'secret.txt'), path.join(src, 'link.txt'));

    const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cp-dst-')), 'out');
    await stageCopyDirectory(src, dst);

    expect(fs.existsSync(path.join(dst, 'real.txt'))).toBe(true);
    // The symlink is reproduced as a symlink — its target contents are not pulled in.
    expect(fs.lstatSync(path.join(dst, 'link.txt')).isSymbolicLink()).toBe(true);

    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
    fs.rmSync(path.dirname(dst), { recursive: true, force: true });
  });
});

describe('recoverAgentExtensionStagesOnStartup', () => {
  function stageRoot(): string {
    return resolveAgentExtensionStageRoot(repo);
  }

  it('returns zero counts when the stage root does not exist', async () => {
    const result = await recoverAgentExtensionStagesOnStartup(repo);
    expect(result).toEqual({ removedStageCount: 0, skippedEntryCount: 0 });
  });

  it('removes leaked real stage directories left by a prior crashed launch', async () => {
    const leaked = path.join(stageRoot(), 'leaked-launch');
    fs.mkdirSync(path.join(leaked, 'skills', 'skill-a'), { recursive: true });
    fs.writeFileSync(path.join(leaked, 'skills', 'skill-a', 'SKILL.md'), 'leftover');

    const result = await recoverAgentExtensionStagesOnStartup(repo);
    expect(result.removedStageCount).toBe(1);
    expect(fs.existsSync(leaked)).toBe(false);
  });

  it('skips a non-directory entry under the stage root and leaves it in place', async () => {
    fs.mkdirSync(stageRoot(), { recursive: true });
    const loose = path.join(stageRoot(), 'loose.txt');
    fs.writeFileSync(loose, 'not a stage');

    const result = await recoverAgentExtensionStagesOnStartup(repo);
    expect(result.removedStageCount).toBe(0);
    expect(result.skippedEntryCount).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(loose)).toBe(true);
  });

  it('skips a symlinked stage entry without following it, while still removing real leaked dirs', async () => {
    fs.mkdirSync(stageRoot(), { recursive: true });
    // External dir the symlink points at — must survive (recovery never follows symlinks).
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-recover-out-'));
    fs.writeFileSync(path.join(external, 'keep.txt'), 'keep');
    fs.symlinkSync(external, path.join(stageRoot(), 'linkdir'), 'dir');
    // A real leaked stage dir alongside the symlink.
    fs.mkdirSync(path.join(stageRoot(), 'real-leak'), { recursive: true });

    const result = await recoverAgentExtensionStagesOnStartup(repo);
    expect(result.removedStageCount).toBe(1);
    expect(result.skippedEntryCount).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(external, 'keep.txt'))).toBe(true);
    expect(fs.existsSync(path.join(stageRoot(), 'real-leak'))).toBe(false);

    fs.rmSync(external, { recursive: true, force: true });
  });
});
