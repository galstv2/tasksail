import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { materializeExtension, readImportReceipt, buildDefaultFs } from '../materialize.js';
import type {
  AgentExtensionFsAdapter,
  AgentExtensionMutationSeams,
  AgentExtensionSourceManifestEntry,
} from '../types.js';

function buildFsAdapter(_root: string): AgentExtensionFsAdapter {
  const realFs = buildDefaultFs();
  return {
    ...realFs,
  };
}

const SKILL_MD_CONTENT = `---
name: Test Skill
description: A skill for testing
---
# Test Skill
Some content here.
`;

const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'materialize-test-'));
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

function makeLocalSkillSource(srcDir: string): AgentExtensionSourceManifestEntry {
  return {
    id: 'test-skill',
    kind: 'skill',
    provider_id: 'copilot',
    display_name: 'Test Skill',
    description: 'A test skill',
    enabled: true,
    source: { type: 'local', path: srcDir },
  };
}

function makeDirectAttachmentEntry(configPath: string): AgentExtensionSourceManifestEntry {
  return {
    id: 'direct-skill',
    kind: 'skill',
    provider_id: 'copilot',
    display_name: 'Direct Skill',
    description: 'A direct attachment skill',
    enabled: true,
    source: { type: 'direct-attachment', config_path: configPath },
  };
}

describe('materializeExtension (local source)', () => {
  it('materializes a local skill source and writes receipt outside runtime dir', async () => {
    const srcDir = path.join(tmpDir, 'my-skill-src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD_CONTENT);

    const entry = makeLocalSkillSource(srcDir);
    const fsAdapter = buildFsAdapter(tmpDir);
    const seams: AgentExtensionMutationSeams = {
      now: () => NOW,
      fs: fsAdapter,
    };

    const result = await materializeExtension(tmpDir, entry, seams);

    const expectedRuntimePath = path.join(tmpDir, '.platform-state', 'skills', 'test-skill');
    expect(result.runtime_path).toBe(expectedRuntimePath);
    expect(fs.existsSync(path.join(expectedRuntimePath, 'SKILL.md'))).toBe(true);

    const receiptPath = path.join(
      tmpDir,
      '.platform-state',
      'agent-extensions',
      'imports',
      'skills',
      'test-skill.json',
    );
    expect(fs.existsSync(receiptPath)).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
    expect(receipt.id).toBe('test-skill');
    expect(receipt.kind).toBe('skill');
    expect(receipt.imported_at).toBe(NOW);
    expect(receipt.source_digest).toBeTruthy();
    expect(receiptPath).not.toContain(expectedRuntimePath);
  });

  it('computes a deterministic source_digest', async () => {
    const srcDir = path.join(tmpDir, 'skill-digest');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD_CONTENT);

    const entry = makeLocalSkillSource(srcDir);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };

    await materializeExtension(tmpDir, entry, seams);

    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-digest2-'));
    try {
      fs.mkdirSync(path.join(tmpDir2, '.platform-state'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir2, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir2, 'config', 'agent-extensions.default.json'),
        JSON.stringify({ schema_version: 1, extensions: [] }),
      );
      await materializeExtension(tmpDir2, makeLocalSkillSource(srcDir), seams);

      const receipt1 = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'test-skill.json'), 'utf-8'),
      );
      const receipt2 = JSON.parse(
        fs.readFileSync(path.join(tmpDir2, '.platform-state', 'agent-extensions', 'imports', 'skills', 'test-skill.json'), 'utf-8'),
      );
      expect(receipt1.source_digest).toBe(receipt2.source_digest);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it('uses remove-before-rename: leaves no partial dir on re-materialize', async () => {
    const srcDir = path.join(tmpDir, 'skill-replace');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD_CONTENT);

    const entry = makeLocalSkillSource(srcDir);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };

    await materializeExtension(tmpDir, entry, seams);
    const targetDir = path.join(tmpDir, '.platform-state', 'skills', 'test-skill');
    expect(fs.existsSync(targetDir)).toBe(true);

    fs.writeFileSync(path.join(targetDir, 'stale.txt'), 'stale');
    await materializeExtension(tmpDir, entry, seams);

    const files = fs.readdirSync(targetDir);
    expect(files).not.toContain('stale.txt');
    expect(files).toContain('SKILL.md');
  });

  it('throws and cleans up temp dir if local source path does not exist', async () => {
    const entry: AgentExtensionSourceManifestEntry = {
      id: 'missing-skill',
      kind: 'skill',
      provider_id: 'copilot',
      display_name: 'Missing',
      description: 'Missing',
      enabled: true,
      source: { type: 'local', path: '/nonexistent/path/12345' },
    };

    await expect(materializeExtension(tmpDir, entry)).rejects.toThrow();

    const tempDir = path.join(tmpDir, '.platform-state', 'agent-extensions');
    if (fs.existsSync(tempDir)) {
      const tmpEntries = fs.readdirSync(tempDir).filter((n) => n.startsWith('.tmp-'));
      expect(tmpEntries).toHaveLength(0);
    }
  });
});

describe('materializeExtension (direct-attachment)', () => {
  it('copies SKILL.md from config_path into the runtime dir', async () => {
    const configDir = path.join(tmpDir, 'config', 'skill-authored', 'direct-skill');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'SKILL.md'), SKILL_MD_CONTENT);

    const entry = makeDirectAttachmentEntry('config/skill-authored/direct-skill/SKILL.md');
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    const result = await materializeExtension(tmpDir, entry, seams);

    const runtimeSkillMd = path.join(result.runtime_path, 'SKILL.md');
    expect(fs.existsSync(runtimeSkillMd)).toBe(true);
  });
});

describe('materializeExtension (git source)', () => {
  it('writes commit_sha from rev-parse into the receipt', async () => {
    const FAKE_SHA = 'abc1234def5678901234567890123456789abcde';

    // Inject an execFile seam that fakes git clone and rev-parse
    const fakeExecFile = async (
      _file: string,
      args: string[],
      _options: { cwd: string },
    ): Promise<{ stdout: string; stderr: string }> => {
      if (args[0] === 'clone') {
        const targetDir = args[args.length - 1];
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'SKILL.md'), SKILL_MD_CONTENT);
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { stdout: `${FAKE_SHA}\n`, stderr: '' };
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    };

    const entry: AgentExtensionSourceManifestEntry = {
      id: 'git-skill',
      kind: 'skill',
      provider_id: 'copilot',
      display_name: 'Git Skill',
      description: 'Git skill',
      enabled: true,
      source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
    };

    const seams: AgentExtensionMutationSeams = { now: () => NOW, execFile: fakeExecFile };
    await materializeExtension(tmpDir, entry, seams);

    const fsAdapter = buildDefaultFs();
    const receipt = await readImportReceipt(tmpDir, 'skill', 'git-skill', fsAdapter);
    expect(receipt).not.toBeNull();
    expect(receipt?.commit_sha).toBe(FAKE_SHA);
  });

  it('honors source_subpath: only the subdir content is materialized', async () => {
    // execFile seam: clone creates a subdir within targetDir
    const fakeExecFile = async (
      _file: string,
      args: string[],
      _options: { cwd: string },
    ): Promise<{ stdout: string; stderr: string }> => {
      if (args[0] === 'clone') {
        const targetDir = args[args.length - 1];
        fs.mkdirSync(path.join(targetDir, 'subdir'), { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'subdir', 'SKILL.md'), SKILL_MD_CONTENT);
        fs.writeFileSync(path.join(targetDir, 'root-only.txt'), 'should not appear');
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'deadbeef00000000000000000000000000000000\n', stderr: '' };
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    };

    const entry: AgentExtensionSourceManifestEntry = {
      id: 'subpath-skill',
      kind: 'skill',
      provider_id: 'copilot',
      display_name: 'Subpath Skill',
      description: 'Subpath skill',
      enabled: true,
      source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main', source_subpath: 'subdir' },
    };

    const seams: AgentExtensionMutationSeams = { now: () => NOW, execFile: fakeExecFile };
    const result = await materializeExtension(tmpDir, entry, seams);

    // The skill document must be present in runtime dir
    expect(fs.existsSync(path.join(result.runtime_path, 'SKILL.md'))).toBe(true);
    // root-only.txt must NOT appear (only subdir content was copied)
    expect(fs.existsSync(path.join(result.runtime_path, 'root-only.txt'))).toBe(false);
  });

  it('throws source-subpath-escape when source_subpath is a traversal path', async () => {
    // The traversal is rejected at the parse/containment layer before git is called
    // Use a local source for determinism (avoids real git)
    const srcDir = path.join(tmpDir, 'traversal-src');
    fs.mkdirSync(srcDir, { recursive: true });
    // Create target that would be "escaped" to
    fs.mkdirSync(path.join(tmpDir, 'escape-target'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD_CONTENT);

    const entry: AgentExtensionSourceManifestEntry = {
      id: 'traversal-skill',
      kind: 'skill',
      provider_id: 'copilot',
      display_name: 'Traversal Skill',
      description: 'Traversal skill',
      enabled: true,
      source: { type: 'local', path: srcDir, source_subpath: '../escape-target' },
    };

    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await expect(materializeExtension(tmpDir, entry, seams)).rejects.toMatchObject({
      code: 'source-subpath-escape',
    });
  });
});

describe('readImportReceipt', () => {
  it('returns null when receipt does not exist', async () => {
    const fsAdapter = buildDefaultFs();
    const result = await readImportReceipt(tmpDir, 'skill', 'nonexistent', fsAdapter);
    expect(result).toBeNull();
  });

  it('returns null for malformed receipt JSON', async () => {
    const receiptDir = path.join(tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills');
    fs.mkdirSync(receiptDir, { recursive: true });
    fs.writeFileSync(path.join(receiptDir, 'bad.json'), '{ broken');
    const fsAdapter = buildDefaultFs();
    const result = await readImportReceipt(tmpDir, 'skill', 'bad', fsAdapter);
    expect(result).toBeNull();
  });

  it('reads back a written receipt correctly', async () => {
    const srcDir = path.join(tmpDir, 'skill-receipt');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD_CONTENT);

    const entry = makeLocalSkillSource(srcDir);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);

    const fsAdapter = buildDefaultFs();
    const receipt = await readImportReceipt(tmpDir, 'skill', 'test-skill', fsAdapter);
    expect(receipt).not.toBeNull();
    expect(receipt?.id).toBe('test-skill');
    expect(receipt?.imported_at).toBe(NOW);
  });
});
