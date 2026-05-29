import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  recoverAgentExtensionStagesOnStartup,
  createAgentExtensionStage,
  stageCopyDirectory,
  resolveAgentExtensionStageRoot,
  resolveAgentExtensionStageDir,
} from '../index.js';
import type { AgentExtensionAgentId } from '../types.js';

const NOW = '2026-03-03T00:00:00.000Z';
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
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-stage-recover-'));
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

describe('recoverAgentExtensionStagesOnStartup', () => {
  it('returns zero counts when the stage root does not exist', async () => {
    const result = await recoverAgentExtensionStagesOnStartup(repo);
    expect(result).toEqual({ removedStageCount: 0, skippedEntryCount: 0 });
  });

  it('removes created, creating, manifestless, and partially copied stage directories', async () => {
    const root = resolveAgentExtensionStageRoot(repo);
    fs.mkdirSync(root, { recursive: true });

    fs.mkdirSync(path.join(root, 'created'), { recursive: true });
    fs.writeFileSync(path.join(root, 'created', 'manifest.json'), JSON.stringify({ status: 'created' }));

    fs.mkdirSync(path.join(root, 'creating'), { recursive: true });
    fs.writeFileSync(path.join(root, 'creating', 'manifest.json'), JSON.stringify({ status: 'creating' }));

    fs.mkdirSync(path.join(root, 'manifestless'), { recursive: true });

    fs.mkdirSync(path.join(root, 'partial', 'skills', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'partial', 'skills', 'x', 'SKILL.md'), 'partial');

    const result = await recoverAgentExtensionStagesOnStartup(repo);

    expect(result.removedStageCount).toBe(4);
    expect(result.skippedEntryCount).toBe(0);
    expect(fs.readdirSync(root)).toHaveLength(0);
  });

  it('skips non-directory entries and reports skippedEntryCount, never following symlinks', async () => {
    const root = resolveAgentExtensionStageRoot(repo);
    fs.mkdirSync(root, { recursive: true });

    fs.mkdirSync(path.join(root, 'a-dir'), { recursive: true });
    fs.writeFileSync(path.join(root, 'loose-file.txt'), 'x');

    // A symlink to an external directory is a non-directory Dirent → skipped, not followed.
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-recover-target-'));
    fs.writeFileSync(path.join(externalDir, 'keep.txt'), 'keep');
    fs.symlinkSync(externalDir, path.join(root, 'a-symlink'), 'dir');

    const result = await recoverAgentExtensionStagesOnStartup(repo);

    expect(result.removedStageCount).toBe(1); // only a-dir
    expect(result.skippedEntryCount).toBe(2); // loose-file + symlink
    expect(fs.existsSync(path.join(root, 'a-dir'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'loose-file.txt'))).toBe(true);
    expect(fs.existsSync(path.join(externalDir, 'keep.txt'))).toBe(true); // target untouched

    fs.rmSync(externalDir, { recursive: true, force: true });
  });

  it('acquires withAgentExtensionsLock so recovery is mutually exclusive with stage creation', async () => {
    // manifest + runtime copy + assignment for a real staging operation
    fs.writeFileSync(
      path.join(repo, 'config', 'agent-extensions.default.json'),
      JSON.stringify({
        schema_version: 1,
        extensions: [
          {
            id: 'skill-a',
            kind: 'skill',
            provider_id: 'copilot',
            display_name: 'Name skill-a',
            description: 'Desc skill-a',
            enabled: true,
            source: { type: 'git', url: 'https://example.com/r.git', ref: 'main' },
          },
        ],
      }),
    );
    const skillDir = path.join(repo, '.platform-state', 'skills', 'skill-a');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: Name skill-a\ndescription: Desc skill-a\n---\nbody\n`);
    fs.writeFileSync(
      path.join(repo, '.platform-state', 'agent-launch-extensions.json'),
      JSON.stringify({
        schema_version: 1,
        assignments: ALL_AGENTS.map((agent_id) => ({
          agent_id,
          extension_ids: agent_id === AGENT ? ['skill-a'] : [],
        })),
      }),
    );

    let copyStarted = false;
    let releaseCopy!: () => void;
    const gate = new Promise<void>((res) => { releaseCopy = res; });
    const copyDirectory = async (src: string, dst: string): Promise<void> => {
      copyStarted = true;
      await gate;
      await stageCopyDirectory(src, dst);
    };

    const stageP = createAgentExtensionStage({ repoRoot: repo, agentId: AGENT, launchId: 'lock-vs-recover', now: () => NOW, copyDirectory });
    await waitFor(() => copyStarted);

    // Staging holds the lock; recovery must block until staging releases it.
    const recoverP = recoverAgentExtensionStagesOnStartup(repo);
    await delay(150);

    const stageDir = resolveAgentExtensionStageDir(repo, 'lock-vs-recover');
    // Manifest-first means the (locked) staging operation has created the dir already.
    expect(fs.existsSync(path.join(stageDir, 'manifest.json'))).toBe(true);

    releaseCopy();
    const [stageRes, recoverRes] = await Promise.all([stageP, recoverP]);

    // Mutual exclusion: recovery ran only AFTER staging finished and released the lock, so it
    // removed the now-completed stage dir. If recovery had run concurrently, staging would have
    // recreated the dir afterward and it would still exist here.
    expect(stageRes.stageDir).toBe(stageDir);
    expect(recoverRes.removedStageCount).toBe(1);
    expect(fs.existsSync(stageDir)).toBe(false);
  }, 20000);
});
