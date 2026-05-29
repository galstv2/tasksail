import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { inspectAgentExtensionMetadata } from '../metadata.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-test-'));
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
      providerId: 'copilot',
      kind: 'skill',
      runtimePath: tmpDir,
    });
    expect(result.display_name).toBe('My Skill');
    expect(result.description).toBe('Does something useful');
    expect(result.metadata.skill_names).toEqual(['My Skill']);
  });

  it('does not return SKILL.md body content', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), VALID_SKILL_MD);
    const result = await inspectAgentExtensionMetadata({
      providerId: 'copilot',
      kind: 'skill',
      runtimePath: tmpDir,
    });
    // Ensure no body content leaked
    expect(JSON.stringify(result)).not.toContain('Body content here');
  });

  it('throws (fail-closed) when SKILL.md is missing', async () => {
    await expect(
      inspectAgentExtensionMetadata({ providerId: 'copilot', kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow('SKILL.md');
  });

  it('throws (fail-closed) when SKILL.md has missing name', async () => {
    const content = `---
description: Only description
---
`;
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), content);
    await expect(
      inspectAgentExtensionMetadata({ providerId: 'copilot', kind: 'skill', runtimePath: tmpDir }),
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
      inspectAgentExtensionMetadata({ providerId: 'copilot', kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow(/description/);
  });

  it('throws when SKILL.md has no frontmatter', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), '# Just a heading\nNo frontmatter.');
    await expect(
      inspectAgentExtensionMetadata({ providerId: 'copilot', kind: 'skill', runtimePath: tmpDir }),
    ).rejects.toThrow(/frontmatter/);
  });

  it('includes skill_names in metadata', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), VALID_SKILL_MD);
    const result = await inspectAgentExtensionMetadata({
      providerId: 'copilot',
      kind: 'skill',
      runtimePath: tmpDir,
    });
    expect(result.metadata.skill_names).toBeDefined();
    expect(Array.isArray(result.metadata.skill_names)).toBe(true);
  });

  it('does not include plugin_component_classes for skills', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), VALID_SKILL_MD);
    const result = await inspectAgentExtensionMetadata({
      providerId: 'copilot',
      kind: 'skill',
      runtimePath: tmpDir,
    });
    expect(result.metadata.plugin_component_classes).toBeUndefined();
  });
});

// Plugin-kind test uses vi.mock hoisting — must be at top level (see Vitest docs)
vi.mock('../../cli-provider/providers/copilot/launchExtensions.js', () => ({
  readCopilotPluginManifestSummary: vi.fn(async (runtimePath: string) => ({
    name: 'Test Plugin',
    manifestPath: path.join(runtimePath, 'manifest.json'),
    declaredComponentClasses: ['MyExtension', 'MyOtherExtension'],
    skillPathCount: 3,
  })),
}));

describe('inspectAgentExtensionMetadata (plugin)', () => {
  it('returns plugin_component_classes + plugin_skill_count and exposes NO manifest body', async () => {
    const MOCK_DESCRIPTION = 'A test plugin description.';

    // Write a manifest.json so the description read succeeds
    const manifestJson = JSON.stringify({
      name: 'Test Plugin',
      description: MOCK_DESCRIPTION,
      internalField: 'SHOULD NOT APPEAR',
    });
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), manifestJson);

    const result = await inspectAgentExtensionMetadata({
      providerId: 'copilot',
      kind: 'plugin',
      runtimePath: tmpDir,
    });

    expect(result.display_name).toBe('Test Plugin');
    expect(result.description).toBe(MOCK_DESCRIPTION);
    expect(result.metadata.plugin_component_classes).toEqual(['MyExtension', 'MyOtherExtension']);
    expect(result.metadata.plugin_skill_count).toBe(3);

    // No manifest body content leaked
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain('SHOULD NOT APPEAR');
    expect(resultStr).not.toContain('internalField');
  });
});
