import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentLaunchExtensionDirs, PlannerLaunchExtensionDirs } from '../../../types.js';
import { buildCopilotPlannerLaunchSpec } from '../plannerAdapter.js';
import {
  buildCopilotLaunchExtensionArgs,
  buildCopilotLaunchExtensionEnv,
  buildCopilotPlannerLaunchExtensionArgs,
  buildCopilotPlannerLaunchExtensionEnv,
  readCopilotPluginManifestSummary,
} from '../launchExtensions.js';

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'tasksail-poc-G1-'));
  return tempDir;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

function makePlugin(root: string, name: string): string {
  const pluginDir = path.join(root, name);
  mkdirSync(pluginDir, { recursive: true });
  return pluginDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('Copilot planner launch extensions', () => {
  it('renders repeated plugin dir pairs after add-dir roots and before boundary/output flags', () => {
    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
      allowedRoots: ['/repo-a', '/repo-b'],
      resumeSessionId: 'copilot-session-1',
      launchExtensions: {
        pluginDirs: ['/plugins/alpha', '/plugins/beta'],
        skillDirs: [],
      },
    });

    expect(spec.args).toEqual(expect.arrayContaining([
      '--plugin-dir', '/plugins/alpha',
      '--plugin-dir', '/plugins/beta',
    ]));
    expect(spec.args.slice(
      spec.args.lastIndexOf('--add-dir') + 2,
      spec.args.indexOf('--disallow-temp-dir'),
    )).toEqual([
      '--plugin-dir', '/plugins/alpha',
      '--plugin-dir', '/plugins/beta',
    ]);
  });

  it('renders skill dirs as one comma-joined env value in order', () => {
    expect(buildCopilotPlannerLaunchExtensionEnv({
      pluginDirs: [],
      skillDirs: ['/skills/alpha', '/skills/beta'],
    })).toEqual({
      COPILOT_SKILLS_DIRS: '/skills/alpha,/skills/beta',
    });

    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
      launchExtensions: {
        pluginDirs: [],
        skillDirs: ['/skills/alpha', '/skills/beta'],
      },
    });

    expect(spec.env?.COPILOT_SKILLS_DIRS).toBe('/skills/alpha,/skills/beta');
  });

  it('emits no extension args or env for missing or empty launch extensions', () => {
    const base = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
    });
    const empty = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
      launchExtensions: {
        pluginDirs: [],
        skillDirs: [],
      },
    });

    expect(buildCopilotPlannerLaunchExtensionArgs(undefined)).toEqual([]);
    expect(buildCopilotPlannerLaunchExtensionEnv(undefined)).toEqual({});
    expect(empty.args).toEqual(base.args);
    expect(empty.env).toEqual(base.env);
    expect(empty.args).not.toContain('--plugin-dir');
    expect(empty.env).not.toHaveProperty('COPILOT_SKILLS_DIRS');
  });

  it.each([
    'plugin.json',
    path.join('.plugin', 'plugin.json'),
    path.join('.github', 'plugin', 'plugin.json'),
    path.join('.claude-plugin', 'plugin.json'),
  ])('accepts Copilot plugin manifests at %s', async (manifestLocation) => {
    const root = makeTempDir();
    const pluginDir = makePlugin(root, 'plugin');
    writeJson(path.join(pluginDir, manifestLocation), {
      name: 'valid-plugin',
      description: 'Plugin-visible description.',
      version: '1.0.0',
      hooks: {},
    });

    await expect(readCopilotPluginManifestSummary(pluginDir)).resolves.toMatchObject({
      manifestPath: path.join(pluginDir, manifestLocation),
      name: 'valid-plugin',
      description: 'Plugin-visible description.',
      version: '1.0.0',
      skillPathCount: 0,
      declaredComponentClasses: ['hooks'],
    });
  });

  it('uses the lowest-index manifest location when multiple manifests exist', async () => {
    const root = makeTempDir();
    const pluginDir = makePlugin(root, 'plugin');
    writeJson(path.join(pluginDir, 'plugin.json'), { name: 'first-plugin', hooks: {} });
    writeJson(path.join(pluginDir, '.plugin', 'plugin.json'), { name: 'second-plugin', hooks: {} });

    await expect(readCopilotPluginManifestSummary(pluginDir)).resolves.toMatchObject({
      manifestPath: path.join(pluginDir, 'plugin.json'),
      name: 'first-plugin',
    });
  });

  it('uses the lowest-index valid manifest when earlier candidates are invalid', async () => {
    const root = makeTempDir();
    const pluginDir = makePlugin(root, 'plugin');
    writeFileSync(path.join(pluginDir, 'plugin.json'), '{ bad json', 'utf8');
    writeJson(path.join(pluginDir, '.plugin', 'plugin.json'), { name: 'valid-plugin', hooks: {} });

    await expect(readCopilotPluginManifestSummary(pluginDir)).resolves.toMatchObject({
      manifestPath: path.join(pluginDir, '.plugin', 'plugin.json'),
      name: 'valid-plugin',
    });
  });

  it('rejects skill component paths that escape the plugin directory', async () => {
    const root = makeTempDir();
    const pluginDir = makePlugin(root, 'plugin');
    writeJson(path.join(pluginDir, 'plugin.json'), {
      name: 'escaping-plugin',
      skills: ['../outside'],
    });

    await expect(readCopilotPluginManifestSummary(pluginDir)).rejects.toMatchObject({
      reasonCode: 'plugin-skill-path-escape',
    });
  });

  it('rejects absolute skill component paths outside the plugin directory', async () => {
    const root = makeTempDir();
    const pluginDir = makePlugin(root, 'plugin');
    const externalDir = path.join(root, 'external-skill');
    mkdirSync(externalDir, { recursive: true });
    writeJson(path.join(pluginDir, 'plugin.json'), {
      name: 'absolute-escaping-plugin',
      skills: [externalDir],
    });

    await expect(readCopilotPluginManifestSummary(pluginDir)).rejects.toMatchObject({
      reasonCode: 'plugin-skill-path-escape',
    });
  });

  it('rejects symlinked skill component paths that escape the plugin directory', async () => {
    const root = makeTempDir();
    const pluginDir = makePlugin(root, 'plugin');
    const externalDir = path.join(root, 'external-skill');
    mkdirSync(externalDir, { recursive: true });
    symlinkSync(externalDir, path.join(pluginDir, 'linked-skill'), 'dir');
    writeJson(path.join(pluginDir, 'plugin.json'), {
      name: 'symlink-plugin',
      skills: ['linked-skill'],
    });

    await expect(readCopilotPluginManifestSummary(pluginDir)).rejects.toMatchObject({
      reasonCode: 'plugin-skill-path-escape',
    });
  });
});

describe('Copilot generic launch extension helpers', () => {
  it('renders repeated --plugin-dir pairs in input order', () => {
    expect(buildCopilotLaunchExtensionArgs({ pluginDirs: ['/p/a', '/p/b'], skillDirs: [] }))
      .toEqual(['--plugin-dir', '/p/a', '--plugin-dir', '/p/b']);
    expect(buildCopilotLaunchExtensionArgs(undefined)).toEqual([]);
    expect(buildCopilotLaunchExtensionArgs({ pluginDirs: [], skillDirs: ['/s'] })).toEqual([]);
  });

  it('renders skill dirs as one comma-joined COPILOT_SKILLS_DIRS value', () => {
    expect(buildCopilotLaunchExtensionEnv({ pluginDirs: [], skillDirs: ['/s/a', '/s/b'] }))
      .toEqual({ COPILOT_SKILLS_DIRS: '/s/a,/s/b' });
    expect(buildCopilotLaunchExtensionEnv(undefined)).toEqual({});
    expect(buildCopilotLaunchExtensionEnv({ pluginDirs: ['/p'], skillDirs: [] })).toEqual({});
  });

  it('preserves planner helper exports as aliases of the generic helpers', () => {
    expect(buildCopilotPlannerLaunchExtensionArgs).toBe(buildCopilotLaunchExtensionArgs);
    expect(buildCopilotPlannerLaunchExtensionEnv).toBe(buildCopilotLaunchExtensionEnv);
  });

  it('keeps PlannerLaunchExtensionDirs type-identical to AgentLaunchExtensionDirs', () => {
    // Bidirectional assignability fails to compile if the alias ever diverges.
    const agentShape: AgentLaunchExtensionDirs = { pluginDirs: ['/p'], skillDirs: ['/s'] };
    const plannerShape: PlannerLaunchExtensionDirs = agentShape;
    const backToAgent: AgentLaunchExtensionDirs = plannerShape;
    expect(backToAgent).toEqual(agentShape);
  });
});
