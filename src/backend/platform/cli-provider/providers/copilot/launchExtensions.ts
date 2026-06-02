import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { isRecord, isMissingPathError } from '../../../core/guards.js';
import { safeJsonParse } from '../../../core/io.js';
import { canonicalRoot, isPathWithinBoundary } from '../../../core/paths.js';
import type { AgentLaunchExtensionDirs } from '../../types.js';

const COPILOT_SKILLS_DIRS_ENV_KEY = 'COPILOT_SKILLS_DIRS';
const COPILOT_PLUGIN_DIR_FLAG = '--plugin-dir';
const MANIFEST_MAX_BYTES = 64 * 1024;
const MANIFEST_LOCATIONS = [
  'plugin.json',
  path.join('.plugin', 'plugin.json'),
  path.join('.github', 'plugin', 'plugin.json'),
  path.join('.claude-plugin', 'plugin.json'),
] as const;
const MANIFEST_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const NON_SKILL_COMPONENT_CLASSES = ['agents', 'hooks', 'lsp', 'mcp'] as const;

export type CopilotPluginManifestSummary = {
  manifestPath: string;
  name: string;
  description?: string;
  version?: string;
  skillPathCount: number;
  declaredComponentClasses: string[];
};

export type CopilotLaunchExtensionReasonCode =
  | 'plugin-manifest-missing'
  | 'plugin-manifest-invalid'
  | 'plugin-skill-path-escape';

export type CopilotLaunchExtensionError = Error & {
  reasonCode: CopilotLaunchExtensionReasonCode;
};

type ManifestCandidate =
  | { status: 'missing'; index: number }
  | { status: 'invalid'; index: number; reasonCode: CopilotLaunchExtensionReasonCode; message: string }
  | { status: 'loaded'; index: number; manifestPath: string; raw: string };

function launchExtensionError(
  message: string,
  reasonCode: CopilotLaunchExtensionReasonCode,
): CopilotLaunchExtensionError {
  const error = new Error(message) as CopilotLaunchExtensionError;
  error.reasonCode = reasonCode;
  return error;
}

export function buildCopilotLaunchExtensionArgs(
  launchExtensions: AgentLaunchExtensionDirs | undefined,
): string[] {
  return (launchExtensions?.pluginDirs ?? [])
    .flatMap((pluginDir) => [COPILOT_PLUGIN_DIR_FLAG, pluginDir]);
}

export function buildCopilotLaunchExtensionEnv(
  launchExtensions: AgentLaunchExtensionDirs | undefined,
): Record<string, string> {
  const skillDirs = launchExtensions?.skillDirs ?? [];
  return skillDirs.length > 0
    ? { [COPILOT_SKILLS_DIRS_ENV_KEY]: skillDirs.join(',') }
    : {};
}

// Backward-compatible aliases for the Lily planner adapter (plannerAdapter.ts)
// and existing planner launch-extension tests. The role-agent launch path uses
// the provider-generic names above.
export const buildCopilotPlannerLaunchExtensionArgs = buildCopilotLaunchExtensionArgs;
export const buildCopilotPlannerLaunchExtensionEnv = buildCopilotLaunchExtensionEnv;

async function readManifestCandidate(pluginDir: string, location: string, index: number): Promise<ManifestCandidate> {
  const manifestPath = path.resolve(pluginDir, location);

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(manifestPath, 'r');
  } catch (err) {
    if (isMissingPathError(err)) {
      return { status: 'missing', index };
    }
    return {
      status: 'invalid',
      index,
      reasonCode: 'plugin-manifest-invalid',
      message: 'Copilot plugin manifest could not be read.',
    };
  }

  try {
    const manifestStat = await handle.stat();
    if (!manifestStat.isFile()) {
      return {
        status: 'invalid',
        index,
        reasonCode: 'plugin-manifest-invalid',
        message: 'Copilot plugin manifest path is not a file.',
      };
    }
    if (manifestStat.size > MANIFEST_MAX_BYTES) {
      return {
        status: 'invalid',
        index,
        reasonCode: 'plugin-manifest-invalid',
        message: 'Copilot plugin manifest exceeds the maximum size.',
      };
    }
    const buffer = Buffer.alloc(MANIFEST_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MANIFEST_MAX_BYTES) {
      return {
        status: 'invalid',
        index,
        reasonCode: 'plugin-manifest-invalid',
        message: 'Copilot plugin manifest exceeds the maximum size.',
      };
    }
    return {
      status: 'loaded',
      index,
      manifestPath,
      raw: buffer.subarray(0, bytesRead).toString('utf8'),
    };
  } catch {
    return {
      status: 'invalid',
      index,
      reasonCode: 'plugin-manifest-invalid',
      message: 'Copilot plugin manifest could not be read.',
    };
  } finally {
    await handle.close();
  }
}

function readSkillPaths(manifest: Record<string, unknown>): string[] {
  const skills = manifest.skills;
  if (skills === undefined) {
    return [];
  }
  if (typeof skills === 'string') {
    const trimmed = skills.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(skills)) {
    throw launchExtensionError('Copilot plugin manifest skills field is invalid.', 'plugin-manifest-invalid');
  }

  const skillPaths: string[] = [];
  for (const skillPath of skills) {
    if (typeof skillPath !== 'string') {
      throw launchExtensionError('Copilot plugin manifest skills field is invalid.', 'plugin-manifest-invalid');
    }
    const trimmed = skillPath.trim();
    if (trimmed) {
      skillPaths.push(trimmed);
    }
  }
  return skillPaths;
}

function declaredNonSkillComponentClasses(manifest: Record<string, unknown>): string[] {
  return NON_SKILL_COMPONENT_CLASSES.filter((componentClass) => (
    Object.prototype.hasOwnProperty.call(manifest, componentClass)
  ));
}

function validateSkillPath(pluginRealpath: string, skillPath: string): void {
  const componentPath = path.isAbsolute(skillPath)
    ? skillPath
    : path.join(pluginRealpath, skillPath);
  const componentRealpath = canonicalRoot(componentPath);

  if (!isPathWithinBoundary(pluginRealpath, componentRealpath)) {
    throw launchExtensionError(
      'Copilot plugin manifest skill path escapes the plugin directory.',
      'plugin-skill-path-escape',
    );
  }
  if (!existsSync(componentRealpath)) {
    throw launchExtensionError(
      'Copilot plugin manifest skill path does not exist.',
      'plugin-manifest-invalid',
    );
  }
}

function parseManifestSummary(
  pluginDir: string,
  manifestPath: string,
  raw: string,
): CopilotPluginManifestSummary {
  let parsed: unknown;
  try {
    parsed = safeJsonParse<unknown>(raw, manifestPath);
  } catch {
    throw launchExtensionError('Copilot plugin manifest is malformed JSON.', 'plugin-manifest-invalid');
  }

  if (!isRecord(parsed) ||
    typeof parsed.name !== 'string' ||
    !MANIFEST_NAME_PATTERN.test(parsed.name)) {
    throw launchExtensionError('Copilot plugin manifest name is invalid.', 'plugin-manifest-invalid');
  }

  const skillPaths = readSkillPaths(parsed);
  const declaredComponentClasses = declaredNonSkillComponentClasses(parsed);
  if (skillPaths.length === 0 && declaredComponentClasses.length === 0) {
    throw launchExtensionError(
      'Copilot plugin manifest declares no recognized capability classes.',
      'plugin-manifest-invalid',
    );
  }

  const pluginRealpath = canonicalRoot(pluginDir);
  for (const skillPath of skillPaths) {
    validateSkillPath(pluginRealpath, skillPath);
  }

  return {
    manifestPath,
    name: parsed.name,
    description: typeof parsed.description === 'string' && parsed.description.trim() !== ''
      ? parsed.description.trim()
      : undefined,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    skillPathCount: skillPaths.length,
    declaredComponentClasses,
  };
}

export async function readCopilotPluginManifestSummary(
  pluginDir: string,
): Promise<CopilotPluginManifestSummary> {
  const candidates = await Promise.all(
    MANIFEST_LOCATIONS.map((location, index) => readManifestCandidate(pluginDir, location, index)),
  );
  let firstInvalid: { message: string; reasonCode: CopilotLaunchExtensionReasonCode } | null = null;

  for (const candidate of candidates) {
    if (candidate.status === 'missing') {
      continue;
    }
    if (candidate.status === 'invalid') {
      firstInvalid ??= { message: candidate.message, reasonCode: candidate.reasonCode };
      continue;
    }
    try {
      return parseManifestSummary(pluginDir, candidate.manifestPath, candidate.raw);
    } catch (error) {
      if (!firstInvalid && isRecord(error) &&
        (error.reasonCode === 'plugin-manifest-invalid' ||
          error.reasonCode === 'plugin-skill-path-escape')) {
        firstInvalid = {
          message: error instanceof Error ? error.message : 'Copilot plugin manifest is invalid.',
          reasonCode: error.reasonCode,
        };
      }
    }
  }

  if (firstInvalid) {
    throw launchExtensionError(firstInvalid.message, firstInvalid.reasonCode);
  }

  throw launchExtensionError('Copilot plugin manifest is missing.', 'plugin-manifest-missing');
}
