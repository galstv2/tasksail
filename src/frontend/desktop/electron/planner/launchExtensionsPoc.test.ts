// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  resolvePlannerLaunchExtensionsPoc,
  scanExplicitPlannerPocSkillPathForMetadata,
} from './launchExtensionsPoc';

const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: loggerMocks.info,
    warn: loggerMocks.warn,
    error: vi.fn(),
    child: vi.fn(),
  })),
}));

const skill = {
  name: 'deploy-check',
  description: 'Checks deploy readiness.',
  user_invocable: true,
  model_invocable: true,
};
const tmpRoots: string[] = [];

beforeEach(() => {
  loggerMocks.info.mockClear();
  loggerMocks.warn.mockClear();
});

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolvePlannerLaunchExtensionsPoc', () => {
  it('returns no extensions for absent and disabled config', async () => {
    const absentRoot = makeRepoRoot();
    await expect(resolvePlannerLaunchExtensionsPoc(absentRoot)).resolves.toEqual({
      launchExtensions: undefined,
      pluginDirCount: 0,
      skillDirCount: 0,
    });
    expect(loggerMocks.warn).not.toHaveBeenCalled();

    const disabledRoot = makeRepoRoot();
    writeConfig(disabledRoot, {
      schema_version: 1,
      provider_id: 'copilot',
      enabled: false,
      plugin_dirs: ['relative-plugin'],
    });
    await expect(resolvePlannerLaunchExtensionsPoc(disabledRoot)).resolves.toEqual({
      launchExtensions: undefined,
      pluginDirCount: 0,
      skillDirCount: 0,
    });
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('realpaths, dedupes, preserves order, and freezes returned arrays', async () => {
    const repoRoot = makeRepoRoot();
    const pluginA = makePlugin(repoRoot, 'plugin-a');
    const pluginB = makePlugin(repoRoot, 'plugin-b');
    const pluginAlias = path.join(repoRoot, 'plugin-a-link');
    symlinkSync(pluginA, pluginAlias);
    const skillA = mkdir(path.join(repoRoot, 'skill-a'));
    const skillB = mkdir(path.join(repoRoot, 'skill-b'));
    const skillAlias = path.join(repoRoot, 'skill-a-link');
    symlinkSync(skillA, skillAlias);
    writeConfig(repoRoot, enabledConfig({
      plugin_dirs: [pluginA, pluginAlias, pluginB],
      skill_dirs: [skillDir(skillAlias), skillDir(skillA), skillDir(skillB)],
    }));

    const result = await resolvePlannerLaunchExtensionsPoc(repoRoot);

    expect(result.pluginDirCount).toBe(2);
    expect(result.skillDirCount).toBe(2);
    expect(result.launchExtensions?.pluginDirs).toEqual([realpathSync(pluginA), realpathSync(pluginB)]);
    expect(result.launchExtensions?.skillDirs).toEqual([realpathSync(skillA), realpathSync(skillB)]);
    expect(Object.isFrozen(result.launchExtensions?.pluginDirs)).toBe(true);
    expect(Object.isFrozen(result.launchExtensions?.skillDirs)).toBe(true);
    expect(() => (result.launchExtensions!.pluginDirs as string[]).push('/x')).toThrow();
    expect(() => {
      (result.launchExtensions!.skillDirs as string[])[0] = '/x';
    }).toThrow();
  });

  it('uses the planner-neutral config path and falls back to the legacy path', async () => {
    const neutralRoot = makeRepoRoot('tasksail-poc-neutral-path-');
    const neutralPlugin = makePlugin(neutralRoot, 'neutral-plugin');
    writeConfig(neutralRoot, enabledConfig({ plugin_dirs: [neutralPlugin] }));

    await expect(resolvePlannerLaunchExtensionsPoc(neutralRoot)).resolves.toMatchObject({
      pluginDirCount: 1,
      skillDirCount: 0,
    });

    const legacyRoot = makeRepoRoot('tasksail-poc-legacy-path-');
    const legacyPlugin = makePlugin(legacyRoot, 'legacy-plugin');
    writeLegacyConfig(legacyRoot, enabledConfig({ plugin_dirs: [legacyPlugin] }));

    await expect(resolvePlannerLaunchExtensionsPoc(legacyRoot)).resolves.toMatchObject({
      pluginDirCount: 1,
      skillDirCount: 0,
    });

    const precedenceRoot = makeRepoRoot('tasksail-poc-path-precedence-');
    const precedencePlugin = makePlugin(precedenceRoot, 'precedence-plugin');
    writeConfig(precedenceRoot, { schema_version: 1, provider_id: 'copilot', enabled: false, plugin_dirs: [precedencePlugin] });
    writeLegacyConfig(precedenceRoot, enabledConfig({ plugin_dirs: [precedencePlugin] }));

    await expect(resolvePlannerLaunchExtensionsPoc(precedenceRoot)).resolves.toEqual({
      launchExtensions: undefined,
      pluginDirCount: 0,
      skillDirCount: 0,
    });
  });

  it('rejects invalid path, manifest, and cached skill metadata cases', async () => {
    const cases: Array<[string, string, (root: string) => unknown]> = [
      ['malformed-json', 'malformed-json', () => '{ bad json'],
      ['relative-path', 'relative-path', () => enabledConfig({ plugin_dirs: ['relative'] })],
      ['missing-path', 'path-missing', (root) => enabledConfig({ plugin_dirs: [path.join(root, 'missing')] })],
      ['path-not-directory', 'path-not-directory', (root) => {
        const filePath = path.join(root, 'not-dir');
        writeFileSync(filePath, '');
        return enabledConfig({ plugin_dirs: [filePath] });
      }],
      ['task-runtime', 'runtime-path-forbidden', (root) => {
        const dir = makePlugin(path.join(root, '.platform-state', 'runtime'), 'plugin');
        return enabledConfig({ plugin_dirs: [dir] });
      }],
      ['task-worktree', 'runtime-path-forbidden', (root) => {
        const dir = makePlugin(path.join(root, 'AgentWorkSpace', 'tasks', 't1', 'worktrees'), 'plugin');
        return enabledConfig({ plugin_dirs: [dir] });
      }],
      ['missing-manifest', 'plugin-manifest-missing', (root) => {
        const dir = mkdir(path.join(root, 'plain-plugin'));
        return enabledConfig({ plugin_dirs: [dir] });
      }],
      ['malformed-plugin', 'plugin-manifest-invalid', (root) => {
        const dir = mkdir(path.join(root, 'bad-plugin'));
        writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'Bad_Plugin' }));
        return enabledConfig({ plugin_dirs: [dir] });
      }],
      ['empty-skill-metadata', 'skill-metadata-empty', (root) => {
        const dir = mkdir(path.join(root, 'skills'));
        return enabledConfig({ skill_dirs: [{ path: dir, last_scanned_at: new Date(0).toISOString(), discovered_skills: [] }] });
      }],
    ];

    for (const [name, reasonCode, buildConfig] of cases) {
      const repoRoot = makeRepoRoot(`tasksail-poc-${name}-`);
      writeConfig(repoRoot, buildConfig(repoRoot));
      await expect(resolvePlannerLaunchExtensionsPoc(repoRoot)).rejects.toThrow(reasonCode);
      expect(rejectionReasons()).toContain(reasonCode);
      loggerMocks.warn.mockClear();
    }

    const repoRoot = makeRepoRoot('tasksail-poc-multiple-invalid-');
    writeConfig(repoRoot, enabledConfig({
      plugin_dirs: [path.join(repoRoot, 'missing-a'), path.join(repoRoot, 'missing-b')],
    }));
    await expect(resolvePlannerLaunchExtensionsPoc(repoRoot)).rejects.toThrow('path-missing');
    expect(loggerMocks.warn.mock.calls.filter(([event]) => event === 'planner.launch_extensions.poc.rejected_before_session')).toHaveLength(1);
  });

  it('validates curated symlink skill paths by realpath and rejects runtime symlink targets', async () => {
    const repoRoot = makeRepoRoot('tasksail-poc-T20-');
    const canonicalSkill = mkdir(path.join(repoRoot, 'canonical-skill'));
    const linkA = path.join(repoRoot, 'curated-a');
    const linkB = path.join(repoRoot, 'curated-b');
    symlinkSync(canonicalSkill, linkA);
    symlinkSync(canonicalSkill, linkB);
    writeConfig(repoRoot, enabledConfig({ skill_dirs: [skillDir(linkA), skillDir(linkB)] }));
    const result = await resolvePlannerLaunchExtensionsPoc(repoRoot);
    expect(result.launchExtensions?.skillDirs).toEqual([realpathSync(canonicalSkill)]);

    const unsafeRoot = makeRepoRoot('tasksail-poc-T20-');
    const runtimeTarget = mkdir(path.join(unsafeRoot, '.platform-state', 'runtime', 'skill'));
    const safeLookingLink = path.join(unsafeRoot, 'curated-runtime-link');
    symlinkSync(runtimeTarget, safeLookingLink);
    writeConfig(unsafeRoot, enabledConfig({ skill_dirs: [skillDir(safeLookingLink)] }));
    await expect(resolvePlannerLaunchExtensionsPoc(unsafeRoot)).rejects.toThrow('runtime-path-forbidden');
    expect(rejectionReasons()).toContain('runtime-path-forbidden');
  });

  it('pins under-specified schema and cap reason codes', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['schema', { schema_version: 2, provider_id: 'copilot', enabled: true }, 'schema-version-invalid'],
      ['provider', { schema_version: 1, provider_id: 'codex', enabled: true }, 'provider-id-invalid'],
      ['plugin-shape', enabledConfig({ plugin_dirs: 'not-an-array' }), 'field-shape-invalid'],
      ['skill-path', enabledConfig({ skill_dirs: [{ last_scanned_at: 'x', discovered_skills: [skill] }] }), 'field-shape-invalid'],
      ['skill-count', enabledConfig({ skill_dirs: [{ path: '/tmp/x', last_scanned_at: 'x', discovered_skills: Array.from({ length: 201 }, () => skill) }] }), 'field-shape-invalid'],
      ['name-cap', enabledConfig({ skill_dirs: [skillDir('/tmp/x', { ...skill, name: 'x'.repeat(129) })] }), 'field-shape-invalid'],
      ['description-cap', enabledConfig({ skill_dirs: [skillDir('/tmp/x', { ...skill, description: 'x'.repeat(513) })] }), 'field-shape-invalid'],
    ];

    for (const [name, config, reasonCode] of cases) {
      const repoRoot = makeRepoRoot(`tasksail-poc-T22-${name}-`);
      writeConfig(repoRoot, config);
      await expect(resolvePlannerLaunchExtensionsPoc(repoRoot)).rejects.toThrow(reasonCode);
      expect(rejectionReasons()).toContain(reasonCode);
      loggerMocks.warn.mockClear();
    }
  });

  it('distinguishes non-ENOENT config read failures from absent config', async () => {
    const unreadableRoot = makeRepoRoot();
    mkdir(path.join(unreadableRoot, '.platform-state', 'planner-launch-extensions-poc.json'));
    await expect(resolvePlannerLaunchExtensionsPoc(unreadableRoot)).rejects.toThrow('io-read-failed');
    expect(rejectionReasons()).toContain('io-read-failed');

    loggerMocks.warn.mockClear();
    await expect(resolvePlannerLaunchExtensionsPoc(makeRepoRoot())).resolves.toEqual({
      launchExtensions: undefined,
      pluginDirCount: 0,
      skillDirCount: 0,
    });
    expect(rejectionReasons()).not.toContain('io-read-failed');
  });

  it('does not emit plugin component audits when later skill validation rejects', async () => {
    const repoRoot = makeRepoRoot();
    const pluginA = makePlugin(repoRoot, 'plugin-a');
    const pluginB = makePlugin(repoRoot, 'plugin-b');
    const skills = mkdir(path.join(repoRoot, 'skills'));
    writeConfig(repoRoot, enabledConfig({
      plugin_dirs: [pluginA, pluginB],
      skill_dirs: [{ path: skills, last_scanned_at: new Date(0).toISOString(), discovered_skills: [] }],
    }));

    await expect(resolvePlannerLaunchExtensionsPoc(repoRoot)).rejects.toThrow('skill-metadata-empty');
    expect(loggerMocks.info.mock.calls.filter(([event]) => event === 'planner.launch_extensions.poc.plugin_components.declared')).toHaveLength(0);
    expect(loggerMocks.warn.mock.calls.filter(([event]) => event === 'planner.launch_extensions.poc.rejected_before_session')).toHaveLength(1);
  });
});

describe('scanExplicitPlannerPocSkillPathForMetadata', () => {
  it('reads only direct child skill frontmatter from the explicit root', async () => {
    const root = makeRepoRoot();
    writeSkillFile(root, 'ignored-root');
    const direct = mkdir(path.join(root, 'direct-skill'));
    writeSkillFile(direct, 'direct-skill', 'Useful metadata.', true);
    const nestedParent = mkdir(path.join(root, 'nested-parent'));
    const nested = mkdir(path.join(nestedParent, 'nested-skill'));
    writeSkillFile(nested, 'nested-skill');
    const automatic = mkdir(path.join(root, '.github', 'skills', 'auto-skill'));
    writeSkillFile(automatic, 'auto-skill');

    const metadata = await scanExplicitPlannerPocSkillPathForMetadata(root);

    expect(metadata).toEqual([{
      name: 'direct-skill',
      description: 'Useful metadata.',
      user_invocable: true,
      model_invocable: false,
    }]);
    expect(JSON.stringify(metadata)).not.toContain('Markdown body');
    expect(JSON.stringify(metadata)).not.toContain('auto-skill');
    expect(JSON.stringify(metadata)).not.toContain('nested-skill');
  });
});

function makeRepoRoot(prefix = 'tasksail-poc-'): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function mkdir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(repoRoot: string, config: unknown): void {
  const stateDir = mkdir(path.join(repoRoot, '.platform-state'));
  writeFileSync(
    path.join(stateDir, 'planner-launch-extensions-poc.json'),
    typeof config === 'string' ? config : JSON.stringify(config),
  );
}

function writeLegacyConfig(repoRoot: string, config: unknown): void {
  const stateDir = mkdir(path.join(repoRoot, '.platform-state'));
  writeFileSync(
    path.join(stateDir, 'lily-launch-extensions-poc.json'),
    typeof config === 'string' ? config : JSON.stringify(config),
  );
}

function enabledConfig(extra: Record<string, unknown>): Record<string, unknown> {
  return { schema_version: 1, provider_id: 'copilot', enabled: true, ...extra };
}

function makePlugin(root: string, name: string): string {
  const dir = mkdir(path.join(root, name));
  writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name, hooks: {} }));
  return dir;
}

function skillDir(skillPath: string, metadata = skill): Record<string, unknown> {
  return {
    path: skillPath,
    last_scanned_at: new Date(0).toISOString(),
    discovered_skills: [metadata],
  };
}

function writeSkillFile(dir: string, name: string, description = 'Description.', disabled = false): void {
  writeFileSync(path.join(dir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'user-invocable: true',
    `disable-model-invocation: ${disabled}`,
    '---',
    'Markdown body that must not be returned.',
  ].join('\n'));
}

function rejectionReasons(): string[] {
  return loggerMocks.warn.mock.calls
    .filter(([event]) => event === 'planner.launch_extensions.poc.rejected_before_session')
    .map(([, payload]) => (payload as { reasonCode: string }).reasonCode);
}
