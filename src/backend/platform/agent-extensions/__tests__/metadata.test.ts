import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { inspectAgentExtensionMetadata } from '../metadata.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-test-'));
  inspectPluginMetadata.mockClear();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const VALID_SKILL_MD = `---
name: My Skill
description: Does something useful
---
# My Skill
Body content here.
`;

describe('inspectAgentExtensionMetadata (skill)', () => {
  it('extracts name and description from SKILL.md frontmatter', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), VALID_SKILL_MD);
    const result = await inspectAgentExtensionMetadata({
      kind: 'skill',
      runtimePath: tmpDir,
    });
    expect(result.display_name).toBe('My Skill');
    expect(result.description).toBe('Does something useful');
    expect(result.metadata.skill_names).toEqual(['My Skill']);
  });

  it('throws (fail-closed) when SKILL.md is missing', async () => {
    await expect(
      inspectAgentExtensionMetadata({ kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow('SKILL.md');
  });

  it('throws (fail-closed) when SKILL.md has missing name', async () => {
    const content = `---
description: Only description
---
`;
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), content);
    await expect(
      inspectAgentExtensionMetadata({ kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow(/name/);
  });

  it('throws (fail-closed) when SKILL.md has empty description', async () => {
    const content = `---
name: Some Skill
description:
---
`;
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), content);
    await expect(
      inspectAgentExtensionMetadata({ kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow(/description/);
  });

  it('throws when SKILL.md has no frontmatter', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), '# Just a heading\nNo frontmatter.');
    await expect(
      inspectAgentExtensionMetadata({ kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow(/frontmatter/);
  });

  it('includes skill_names in metadata', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), VALID_SKILL_MD);
    const result = await inspectAgentExtensionMetadata({
      kind: 'skill',
      runtimePath: tmpDir,
    });
    expect(result.metadata.skill_names).toBeDefined();
    expect(Array.isArray(result.metadata.skill_names)).toBe(true);
  });

  it('does not include plugin_component_classes for skills', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), VALID_SKILL_MD);
    const result = await inspectAgentExtensionMetadata({
      kind: 'skill',
      runtimePath: tmpDir,
    });
    expect(result.metadata.plugin_component_classes).toBeUndefined();
  });
});

const inspectPluginMetadata = vi.fn(async (runtimePath: string) => ({
    name: 'Test Plugin',
    manifestPath: path.join(runtimePath, 'manifest.json'),
    declaredComponentClasses: ['MyExtension', 'MyOtherExtension'],
    skillPathCount: 3,
}));

describe('inspectAgentExtensionMetadata (plugin)', () => {
  it('returns plugin_component_classes + plugin_skill_count and exposes NO manifest body', async () => {
    const manifestJson = JSON.stringify({
      name: 'Test Plugin',
      internalField: 'SHOULD NOT APPEAR',
    });
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), manifestJson);

    const result = await inspectAgentExtensionMetadata({
      kind: 'plugin',
      runtimePath: tmpDir,
      inspectPluginMetadata,
    });

    expect(result.display_name).toBe('Test Plugin');
    expect(result.description).toBe('Plugin Test Plugin.');
    expect(result.metadata.plugin_component_classes).toEqual(['MyExtension', 'MyOtherExtension']);
    expect(result.metadata.plugin_skill_count).toBe(3);

    // No manifest body content leaked
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain('SHOULD NOT APPEAR');
    expect(resultStr).not.toContain('internalField');
  });

  it('uses provider-supplied plugin descriptions when present', async () => {
    inspectPluginMetadata.mockResolvedValueOnce({
      name: 'Described Plugin',
      description: 'A provider description.',
      manifestPath: path.join(tmpDir, 'manifest.json'),
      declaredComponentClasses: [],
      skillPathCount: 0,
    });

    const result = await inspectAgentExtensionMetadata({
      kind: 'plugin',
      runtimePath: tmpDir,
      inspectPluginMetadata,
    });

    expect(result.description).toBe('A provider description.');
  });
});
