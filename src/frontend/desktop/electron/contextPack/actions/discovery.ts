import { resolve } from 'node:path';

import type {
  ContextPackDiscoverPrefillRequest,
  ContextPackDiscoverPrefillResponse,
  ContextPackDiscoveredFocusArea,
  ContextPackDiscoveredHighSignalPath,
  ContextPackDiscoveredRepo,
  ContextPackSkippedRepoMissingGit,
  ContextPackRepoCategory,
  ContextPackRepositoryType,
  ContextPackEstateType,
  ContextPackPickDirectoryRequest,
  ContextPackPickDirectoryResponse,
  DesktopInvokeResult,
} from '../../../src/shared/desktopContract';
import { dialog } from 'electron';
import {
  CONTEXT_ESTATE_DISCOVERY_SCRIPT_PATH,
  portablePathBasename,
  slugifyValue,
  titleizeValue,
  stringArray,
} from '../shared';
import { stringOrNull } from '../../utils';
import {
  isContextPackEstateType,
  isContextPackDiscoveryMode,
  runPythonScriptCommand,
  type PythonScriptRunner,
} from './shared';
import { createLogger } from '../../log/logger';

const log = createLogger('electron/contextPackActions/discovery');

function normalizeRepositoryType(value: unknown): ContextPackRepositoryType | null {
  return value === 'primary' || value === 'support' ? value : null;
}

function normalizeRepoCategory(value: unknown): ContextPackRepoCategory | undefined {
  return value === 'service'
    || value === 'application'
    || value === 'frontend'
    || value === 'library'
    || value === 'infrastructure'
    || value === 'data'
    || value === 'documentation'
    || value === 'tool'
    || value === 'unknown'
    ? value
    : undefined;
}

function normalizeSuggestedSystemLayer(
  value: unknown,
): ContextPackDiscoveredRepo['suggestedSystemLayer'] | undefined {
  return value === 'backend'
    || value === 'frontend'
    || value === 'infrastructure'
    || value === 'database'
    || value === 'documents'
    || value === 'shared'
    ? value
    : undefined;
}

function normalizeClassificationConfidence(
  value: unknown,
): 'high' | 'medium' | 'low' | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

function normalizeDiscoveredRepo(value: Record<string, unknown>): ContextPackDiscoveredRepo {
  const repositoryType = normalizeRepositoryType(value.repository_type);
  return {
    repoId: stringOrNull(value.repo_id) ?? '',
    repoName: stringOrNull(value.repo_name) ?? stringOrNull(value.relative_path) ?? '',
    path: stringOrNull(value.path) ?? '',
    relativePath: stringOrNull(value.relative_path) ?? '',
    highSignalPaths: stringArray(value.high_signal_paths),
    repoCategory: normalizeRepoCategory(value.repo_category),
    repoCategoryConfidence: normalizeClassificationConfidence(value.repo_category_confidence),
    suggestedSystemLayer: normalizeSuggestedSystemLayer(value.suggested_system_layer),
    repositoryType: repositoryType ?? undefined,
    classificationConfidence: normalizeClassificationConfidence(value.classification_confidence),
  };
}

function normalizeDiscoveredFocusArea(value: Record<string, unknown>): ContextPackDiscoveredFocusArea {
  return {
    focusId: stringOrNull(value.focus_id) ?? '',
    focusName: stringOrNull(value.focus_name) ?? stringOrNull(value.relative_path) ?? '',
    focusType: stringOrNull(value.focus_type) ?? 'general',
    path: stringOrNull(value.path) ?? '',
    relativePath: stringOrNull(value.relative_path) ?? '',
    focusCategory: normalizeRepoCategory(value.focus_category),
    group: stringOrNull(value.group) ?? undefined,
    repositoryType: normalizeRepositoryType(value.repository_type) ?? undefined,
  };
}

function normalizeDiscoveredHighSignalPath(value: Record<string, unknown>): ContextPackDiscoveredHighSignalPath {
  return {
    path: stringOrNull(value.path) ?? '',
    relativePath: stringOrNull(value.relative_path) ?? '',
    signalType: stringOrNull(value.signal_type) ?? 'general',
  };
}

function normalizeSkippedRepoMissingGit(value: Record<string, unknown>): ContextPackSkippedRepoMissingGit {
  return {
    repoName: stringOrNull(value.repo_name) ?? '',
    path: stringOrNull(value.path) ?? '',
    relativePath: stringOrNull(value.relative_path) ?? '',
    message: stringOrNull(value.message) ?? '',
  };
}

export function buildContextPackDiscoveryArgs(
  payload: ContextPackDiscoverPrefillRequest['payload'],
): string[] {
  return [CONTEXT_ESTATE_DISCOVERY_SCRIPT_PATH, '--root', payload.rootPath, '--mode', payload.mode, '--format', 'json'];
}

export async function pickContextPackDirectoryAction(
  payload: ContextPackPickDirectoryRequest['payload'],
): Promise<DesktopInvokeResult> {
  try {
    const result = await dialog.showOpenDialog({
      title: payload.purpose === 'discovery-root'
        ? 'Choose a context-estate discovery root'
        : 'Choose a context-pack directory',
      defaultPath: payload.defaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });

    const selectedPath = result.canceled ? null : result.filePaths[0] ? resolve(result.filePaths[0]) : null;
    const response: ContextPackPickDirectoryResponse = {
      action: 'contextPack.pickDirectory',
      mode: result.canceled ? 'cancelled' : 'selected',
      message: result.canceled ? 'Directory selection was cancelled.' : 'Directory selected for context-pack creation.',
      purpose: payload.purpose,
      selectedPath,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    log.warn('context-pack.pick-directory.failed', {
      purpose: payload.purpose,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      action: 'contextPack.pickDirectory',
      error: error instanceof Error ? error.message : 'Directory selection failed unexpectedly.',
    };
  }
}

export async function executeContextPackDiscoveryAction(
  payload: ContextPackDiscoverPrefillRequest['payload'],
  runner: PythonScriptRunner = runPythonScriptCommand,
): Promise<DesktopInvokeResult> {
  const normalizedRootPath = resolve(payload.rootPath);
  const suggestedName = portablePathBasename(normalizedRootPath);
  try {
    const result = await runner(buildContextPackDiscoveryArgs({ rootPath: normalizedRootPath, mode: payload.mode }));
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    const fallbackEstateType: ContextPackEstateType = isContextPackEstateType(payload.mode)
      ? payload.mode
      : 'monolith';
    const estateType = isContextPackEstateType(parsed.estate_type)
      ? parsed.estate_type
      : fallbackEstateType;
    const discoveryMode = isContextPackDiscoveryMode(parsed.discovery_mode)
      ? parsed.discovery_mode
      : payload.mode;
    const response: ContextPackDiscoverPrefillResponse = {
      action: 'contextPack.discoverPrefill',
      mode: 'discovered',
      message: estateType.startsWith('distributed')
        ? 'Discovery found candidate repositories for a distributed estate.'
        : 'Discovery found focus areas for a monolith root.',
      rootPath: normalizedRootPath,
      discoveryMode,
      estateType,
      suggestedContextPackId: slugifyValue(suggestedName || 'context-pack'),
      suggestedDisplayName: titleizeValue(suggestedName || 'context pack'),
      rootRepoCategory: normalizeRepoCategory(parsed.root_repo_category),
      warnings: stringArray(parsed.warnings),
      candidateRepos: Array.isArray(parsed.candidate_repos)
        ? parsed.candidate_repos
          .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
          .map((repo) => normalizeDiscoveredRepo(repo))
        : [],
      candidateFocusAreas: Array.isArray(parsed.candidate_focus_areas)
        ? parsed.candidate_focus_areas
          .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
          .map(normalizeDiscoveredFocusArea)
        : [],
      highSignalPaths: Array.isArray(parsed.high_signal_paths)
        ? parsed.high_signal_paths
          .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
          .map(normalizeDiscoveredHighSignalPath)
        : [],
      skippedReposMissingGit: Array.isArray(parsed.skipped_repos_missing_git)
        ? parsed.skipped_repos_missing_git
          .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
          .map(normalizeSkippedRepoMissingGit)
        : [],
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    log.warn('context-pack.discovery.failed', {
      rootPath: normalizedRootPath,
      mode: payload.mode,
      reason: stderr || (error instanceof Error ? error.message : String(error)),
    });
    return {
      ok: false,
      action: 'contextPack.discoverPrefill',
      error: stderr || (error instanceof Error ? error.message : 'Context-pack discovery failed unexpectedly.'),
    };
  }
}
