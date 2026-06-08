import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';
import type { CliProvider, PlannerLaunchExtensionDirs } from '../../../../backend/platform/cli-provider/types.js';
import { canonicalRoot, isMissingPathError, isPathWithinBoundary, isRecord, readTextFile, safeJsonParse } from '../../../../backend/platform/core/index.js';
import { createLogger } from '../log/logger';

export type ResolvedPlannerLaunchExtensionsPoc = {
  launchExtensions: PlannerLaunchExtensionDirs | undefined; pluginDirCount: number; skillDirCount: number;
};
export type PlannerPocSkillMetadata = {
  name: string; description: string; user_invocable: boolean; model_invocable: boolean;
};

type ReasonCode =
  | 'malformed-json'
  | 'schema-version-invalid'
  | 'provider-id-invalid'
  | 'field-shape-invalid'
  | 'relative-path'
  | 'path-missing'
  | 'path-not-directory'
  | 'realpath-failed'
  | 'runtime-path-forbidden'
  | 'plugin-manifest-missing'
  | 'plugin-manifest-invalid'
  | 'plugin-skill-path-escape'
  | 'skill-metadata-empty'
  | 'io-read-failed';

type PathCategory = 'plugin' | 'skill';
type SkillDirConfig = { path: string; discovered_skills: PlannerPocSkillMetadata[] };
class PocRejection extends Error {
  constructor(
    readonly reasonCode: ReasonCode,
    readonly extra: { fieldName?: string; pathCategory?: PathCategory } = {},
  ) {
    super(`Planner launch extensions are invalid: ${reasonCode}`);
  }
}
const PLANNER_LAUNCH_EXTENSIONS_POC_CONFIG_PATH = '.platform-state/planner-launch-extensions-poc.json';
const LEGACY_PLANNER_LAUNCH_EXTENSIONS_POC_CONFIG_PATH = ['.platform-state/', 'lily', '-launch-extensions-poc.json'].join('');
const CONFIG_SOURCE = 'planner-poc-file';
const MAX_DIRS = 50;
const MAX_SKILLS = 200;
const MAX_NAME = 128;
const MAX_DESCRIPTION = 512;
const MAX_METADATA_BYTES = 64 * 1024;
const log = createLogger('electron/plannerLaunchExtensionsPoc');

export async function resolvePlannerLaunchExtensionsPoc(
  repoRoot = process.cwd(),
): Promise<ResolvedPlannerLaunchExtensionsPoc> {
  const provider = getActiveProvider(repoRoot);
  try {
    return await resolvePlannerLaunchExtensionsPocUnchecked(repoRoot, provider);
  } catch (error) {
    if (error instanceof PocRejection) {
      log.warn('planner.launch_extensions.poc.rejected_before_session', {
        providerId: provider.id,
        reasonCode: error.reasonCode,
        configSource: CONFIG_SOURCE,
        ...error.extra,
      });
    }
    throw error;
  }
}

async function resolvePlannerLaunchExtensionsPocUnchecked(
  repoRoot: string,
  provider: Pick<CliProvider, 'id' | 'inspectPluginMetadata'>,
): Promise<ResolvedPlannerLaunchExtensionsPoc> {
  const config = await readPlannerLaunchExtensionsPocConfig(repoRoot);
  const { raw } = config;
  if (raw === undefined) {
    return emptyResult();
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw, config.relativePath);
  } catch {
    rejectPoc('malformed-json');
  }
  if (!isRecord(parsed)) {
    rejectPoc('field-shape-invalid');
  }
  if (parsed.enabled === false) {
    return emptyResult();
  }
  if (parsed.schema_version !== 1) {
    rejectPoc('schema-version-invalid', { fieldName: 'schema_version' });
  }
  if (parsed.provider_id !== provider.id) {
    rejectPoc('provider-id-invalid', { fieldName: 'provider_id' });
  }
  if (parsed.enabled !== true) {
    rejectPoc('field-shape-invalid', { fieldName: 'enabled' });
  }

  const pluginDirs = readPluginDirs(parsed.plugin_dirs);
  const skillDirs = readSkillDirs(parsed.skill_dirs);
  if (pluginDirs.length === 0 && skillDirs.length === 0) {
    return emptyResult();
  }

  const canonicalRepoRoot = canonicalRoot(repoRoot);
  const forbiddenAnchors = [
    canonicalRoot(path.join(canonicalRepoRoot, 'AgentWorkSpace', 'tasks')),
    canonicalRoot(path.join(canonicalRepoRoot, '.platform-state', 'runtime')),
  ];
  const [resolvedPlugins, resolvedSkills] = await Promise.all([
    Promise.all(pluginDirs.map((dir) => resolveSelectedDir(dir, 'plugin', forbiddenAnchors))),
    Promise.all(skillDirs.map((entry) => resolveSelectedDir(entry.path, 'skill', forbiddenAnchors))),
  ]);
  const uniquePlugins = dedupe(resolvedPlugins);
  const uniqueSkills = dedupe(resolvedSkills);
  const manifests = await Promise.all(uniquePlugins.map((pluginDir) => readPluginManifestOrReject(pluginDir, provider)));

  for (const [index, manifest] of manifests.entries()) {
    log.info('planner.launch_extensions.poc.plugin_components.declared', {
      providerId: provider.id,
      pluginIndex: index,
      declaredComponentClasses: manifest.declaredComponentClasses,
      skillPathCount: manifest.skillPathCount,
    });
  }

  const launchExtensions = Object.freeze({
    pluginDirs: Object.freeze([...uniquePlugins]),
    skillDirs: Object.freeze([...uniqueSkills]),
  });
  return {
    launchExtensions,
    pluginDirCount: uniquePlugins.length,
    skillDirCount: uniqueSkills.length,
  };
}

async function readPlannerLaunchExtensionsPocConfig(
  repoRoot: string,
): Promise<{ raw: string | undefined; relativePath: string }> {
  for (const relativePath of [PLANNER_LAUNCH_EXTENSIONS_POC_CONFIG_PATH, LEGACY_PLANNER_LAUNCH_EXTENSIONS_POC_CONFIG_PATH]) {
    try {
      const raw = await readTextFile(path.join(repoRoot, relativePath));
      if (raw !== undefined) {
        return { raw, relativePath };
      }
    } catch {
      rejectPoc('io-read-failed');
    }
  }

  return { raw: undefined, relativePath: PLANNER_LAUNCH_EXTENSIONS_POC_CONFIG_PATH };
}

export async function scanExplicitPlannerPocSkillPathForMetadata(
  skillPath: string,
): Promise<PlannerPocSkillMetadata[]> {
  const entries = await readdir(skillPath, { withFileTypes: true });
  const metadata = await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory()) {
      return undefined;
    }
    return readSkillMetadata(path.join(skillPath, entry.name, 'SKILL.md'));
  }));
  return metadata.filter((entry): entry is PlannerPocSkillMetadata => entry !== undefined);
}

function readPluginDirs(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_DIRS) {
    rejectPoc('field-shape-invalid', { fieldName: 'plugin_dirs' });
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      rejectPoc('field-shape-invalid', { fieldName: 'plugin_dirs' });
    }
  }
  return value;
}

function readSkillDirs(value: unknown): SkillDirConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_DIRS) {
    rejectPoc('field-shape-invalid', { fieldName: 'skill_dirs' });
  }
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.path !== 'string' ||
      typeof entry.last_scanned_at !== 'string' || entry.last_scanned_at.length === 0 ||
      !Array.isArray(entry.discovered_skills) || entry.discovered_skills.length > MAX_SKILLS) {
      rejectPoc('field-shape-invalid', { fieldName: 'skill_dirs' });
    }
    const discovered = entry.discovered_skills.map(readCachedSkillMetadata);
    if (discovered.length === 0) {
      rejectPoc('skill-metadata-empty', { fieldName: 'discovered_skills', pathCategory: 'skill' });
    }
    return { path: entry.path, discovered_skills: discovered };
  });
}

function readCachedSkillMetadata(value: unknown): PlannerPocSkillMetadata {
  if (!isRecord(value) ||
    typeof value.name !== 'string' || value.name.length > MAX_NAME ||
    typeof value.description !== 'string' || value.description.length > MAX_DESCRIPTION ||
    typeof value.user_invocable !== 'boolean' ||
    typeof value.model_invocable !== 'boolean') {
    rejectPoc('field-shape-invalid', { fieldName: 'discovered_skills' });
  }
  return {
    name: value.name,
    description: value.description,
    user_invocable: value.user_invocable,
    model_invocable: value.model_invocable,
  };
}

async function resolveSelectedDir(
  selectedPath: string,
  pathCategory: PathCategory,
  forbiddenAnchors: readonly string[],
): Promise<string> {
  if (!path.isAbsolute(selectedPath)) {
    rejectPoc('relative-path', { pathCategory });
  }
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(selectedPath);
  } catch (error) {
    rejectPoc(isMissingPathError(error) ? 'path-missing' : 'realpath-failed', { pathCategory });
  }
  const selectedStat = await statSelectedDir(resolvedPath, pathCategory);
  if (!selectedStat.isDirectory()) {
    rejectPoc('path-not-directory', { pathCategory });
  }
  if (forbiddenAnchors.some((anchor) => isPathWithinBoundary(anchor, resolvedPath))) {
    rejectPoc('runtime-path-forbidden', { pathCategory });
  }
  return resolvedPath;
}

async function statSelectedDir(selectedPath: string, pathCategory: PathCategory) {
  try {
    return await stat(selectedPath);
  } catch (error) {
    rejectPoc(isMissingPathError(error) ? 'path-missing' : 'realpath-failed', { pathCategory });
  }
}

async function readPluginManifestOrReject(
  pluginDir: string,
  provider: Pick<CliProvider, 'inspectPluginMetadata'>,
) {
  try {
    return await provider.inspectPluginMetadata(pluginDir);
  } catch (error) {
    const reasonCode = pluginManifestReasonCode(error);
    rejectPoc(reasonCode, { pathCategory: 'plugin' });
  }
}

function pluginManifestReasonCode(error: unknown): ReasonCode {
  if (error instanceof Error && 'reasonCode' in error) {
    const code = (error as { reasonCode: unknown }).reasonCode;
    if (code === 'plugin-manifest-missing' ||
      code === 'plugin-manifest-invalid' ||
      code === 'plugin-skill-path-escape') {
      return code;
    }
  }
  return 'plugin-manifest-invalid';
}

async function readSkillMetadata(skillFilePath: string): Promise<PlannerPocSkillMetadata | undefined> {
  const text = await readFilePrefix(skillFilePath, MAX_METADATA_BYTES);
  if (text === undefined) {
    return undefined;
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (frontmatter === undefined) {
    return undefined;
  }
  const fields = readSimpleYamlFields(frontmatter);
  const name = fields.get('name');
  if (name === undefined) {
    return undefined;
  }
  return {
    name,
    description: fields.get('description') ?? '',
    user_invocable: fields.get('user-invocable') === 'true',
    model_invocable: fields.get('disable-model-invocation') !== 'true',
  };
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<string | undefined> {
  try {
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

function readSimpleYamlFields(frontmatter: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) {
      fields.set(match[1]!, stripYamlScalar(match[2]!));
    }
  }
  return fields;
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function dedupe(paths: readonly string[]): string[] { return [...new Set(paths)]; }

function rejectPoc(
  reasonCode: ReasonCode,
  extra: { fieldName?: string; pathCategory?: PathCategory } = {},
): never {
  throw new PocRejection(reasonCode, extra);
}

function emptyResult(): ResolvedPlannerLaunchExtensionsPoc { return { launchExtensions: undefined, pluginDirCount: 0, skillDirCount: 0 }; }
