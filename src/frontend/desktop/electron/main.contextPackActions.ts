/**
 * Context pack execution actions: create, reseed, workspace switch, discovery, pick directory.
 */
import { execFile } from 'node:child_process';
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { dialog } from 'electron';

import {
  type ContextPackApplyResponse,
  type ContextPackClearResponse,
  type ContextPackCreateExecutionResult,
  type ContextPackCreateRequest,
  type ContextPackCreateResponse,
  type ContextPackDiscoverPrefillRequest,
  type ContextPackDiscoverPrefillResponse,
  type ContextPackDiscoveredFocusArea,
  type ContextPackDiscoveredHighSignalPath,
  type ContextPackDiscoveredRepo,
  type ContextPackRepositoryType,
  type ContextPackPickDirectoryRequest,
  type ContextPackPickDirectoryResponse,
  type PlannerPickMarkdownFileResponse,
  type ContextPackPreviewResponse,
  type ContextPackReseedExecutionResult,
  type ContextPackReseedPayload,
  type ContextPackReseedResponse,
  type ContextPackSwitchExecutionResult,
  type ContextPackSwitchPayload,
  type ContextPackDeepFocusDerivedRoot,
  type ContextPackDeepFocusState,
  type ContextPackFocusTargetKind,
  type ContextPackPrimaryFocusTarget,
  type DesktopInvokeResult,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { numberOrNull, stringOrNull } from './utils';
import { writeTextFileAtomic } from '../../../backend/platform/core/io';
import { setActiveContextPackEnv } from '../../../backend/platform/context-pack/activate';
import { rebuildAgentMirror } from '../../../backend/platform/context-pack/rebuildAgentMirror';
import { deriveWritableRootsFromFocusedSelection } from '../../../backend/platform/context-pack/focusedRepo';
import {
  normalizeRelativePath,
  normalizePrimaryFocusTargets,
  normalizeSupportTargets,
  validateTestTarget,
  type FocusTarget,
} from '../../../backend/platform/context-pack/deepFocusNormalization';
import {
  CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH,
  CONTEXT_ESTATE_DISCOVERY_SCRIPT_PATH,
  QMD_SEED_PLAN_SCRIPT_PATH,
  portablePathBasename,
  REPO_CONTEXT_APP_PATH,
  REPO_CONTEXT_PYTHON_BIN,
  type ScriptResult,
  type ContextPackWorkspaceScriptRunner,
  type ContextPackReseedRunner,
  type PythonScriptRunner,
  type ApprovedContextPackDirReader,
  toRepoRelativePath,
  stringArray,
  slugifyValue,
  titleizeValue,
  readDeepFocusPath,
} from './main.contextPackShared';
import { listAvailableContextPacks } from './main.contextPackCatalog';

const execFileAsync = promisify(execFile);

function normalizeDeepFocusTarget(target: FocusTarget): FocusTarget {
  return {
    path: normalizeRelativePath(target.path),
    kind: target.kind,
  };
}

function cloneFocusTarget(target: FocusTarget | null | undefined): FocusTarget | null | undefined {
  if (target === null) {
    return null;
  }
  if (target === undefined) {
    return undefined;
  }
  return normalizeDeepFocusTarget(target);
}

function clonePrimaryFocusTarget(
  target: ContextPackPrimaryFocusTarget,
): ContextPackPrimaryFocusTarget {
  const testTarget = cloneFocusTarget(target.testTarget);
  return {
    path: normalizeRelativePath(target.path),
    kind: target.kind,
    ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
    ...(target.repoId ? { repoId: target.repoId } : {}),
    ...(target.focusId ? { focusId: target.focusId } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(testTarget !== undefined ? { testTarget } : {}),
    ...(target.supportTargets && target.supportTargets.length > 0
      ? { supportTargets: target.supportTargets.map(normalizeDeepFocusTarget) }
      : {}),
  };
}

function withScopedFieldsFromRawTargets(
  normalizedTargets: ContextPackPrimaryFocusTarget[],
  rawTargets: readonly ContextPackPrimaryFocusTarget[] | undefined,
): ContextPackPrimaryFocusTarget[] {
  if (!rawTargets || rawTargets.length === 0) {
    return normalizedTargets;
  }
  const rawByKey = new Map<string, ContextPackPrimaryFocusTarget>();
  for (const rawTarget of rawTargets) {
    rawByKey.set(`${normalizeRelativePath(rawTarget.path)}\0${rawTarget.kind}`, rawTarget);
  }
  return normalizedTargets.map((target) => {
    const rawTarget = rawByKey.get(`${target.path}\0${target.kind}`);
    if (!rawTarget) {
      return target;
    }
    const testTarget = cloneFocusTarget(rawTarget.testTarget);
    return {
      ...target,
      ...(testTarget !== undefined ? { testTarget } : {}),
      ...(rawTarget.supportTargets && rawTarget.supportTargets.length > 0
        ? { supportTargets: rawTarget.supportTargets.map(normalizeDeepFocusTarget) }
        : {}),
    };
  });
}

function mirrorSinglePrimaryScopedFields(
  selectedFocusTargets: ContextPackPrimaryFocusTarget[],
  selectedTestTarget: FocusTarget | null | undefined,
  selectedSupportTargets: FocusTarget[],
): {
  selectedTestTarget: FocusTarget | null | undefined;
  selectedSupportTargets: FocusTarget[];
} {
  if (selectedFocusTargets.length !== 1) {
    return { selectedTestTarget, selectedSupportTargets };
  }
  const [primary] = selectedFocusTargets;
  return {
    selectedTestTarget:
      selectedTestTarget === undefined && primary?.testTarget !== undefined
        ? cloneFocusTarget(primary.testTarget)
        : selectedTestTarget,
    selectedSupportTargets:
      selectedSupportTargets.length === 0 && primary?.supportTargets && primary.supportTargets.length > 0
        ? primary.supportTargets.map(normalizeDeepFocusTarget)
        : selectedSupportTargets,
  };
}

function toWorkspaceSyncTarget(target: FocusTarget): Record<string, unknown> {
  return {
    path: target.path,
    kind: target.kind,
  };
}

function toWorkspaceSyncPrimaryTarget(target: ContextPackPrimaryFocusTarget): Record<string, unknown> {
  const testTarget = cloneFocusTarget(target.testTarget);
  return {
    path: target.path,
    kind: target.kind,
    ...(target.repoLocalPath ? { repo_local_path: target.repoLocalPath } : {}),
    ...(target.repoId ? { repo_id: target.repoId } : {}),
    ...(target.focusId ? { focus_id: target.focusId } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(testTarget !== undefined ? { test_target: testTarget } : {}),
    ...(target.supportTargets && target.supportTargets.length > 0
      ? { support_targets: target.supportTargets.map(toWorkspaceSyncTarget) }
      : {}),
  };
}

function readSnakeOrCamelString(
  value: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): string | undefined {
  const raw = Object.prototype.hasOwnProperty.call(value, snakeKey)
    ? value[snakeKey]
    : value[camelKey];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function normalizeContextPackSwitchPayload(
  payload: ContextPackSwitchPayload,
): ContextPackSwitchPayload {
  const selectedFocusPath = normalizeRelativePath(payload.selectedFocusPath ?? '');

  if (
    selectedFocusPath
    && payload.selectedFocusTargetKind !== 'directory'
    && payload.selectedFocusTargetKind !== 'file'
  ) {
    // Only enforce when deep focus is active
    if (payload.deepFocusEnabled === true) {
      throw new Error('Deep Focus apply requires selectedFocusTargetKind to be directory or file.');
    }
  }

  const selectedTestTarget = payload.selectedTestTarget === undefined
    ? undefined
    : payload.selectedTestTarget === null
      ? null
      : normalizeDeepFocusTarget(payload.selectedTestTarget);
  const selectedPrimaryKind = payload.selectedFocusTargetKind ?? 'directory';
  const hasExplicitPrimaryTargets = Array.isArray(payload.selectedFocusTargets);
  const normalizedPrimaryTargetsWithoutScopedFields = payload.deepFocusEnabled === true
    ? normalizePrimaryFocusTargets({
        rawTargets: hasExplicitPrimaryTargets ? payload.selectedFocusTargets : undefined,
        legacyPath: selectedFocusPath,
        legacyKind: selectedPrimaryKind,
      }).targets
    : (payload.selectedFocusTargets ?? []).map((target) => ({
        path: normalizeRelativePath(target.path),
        kind: target.kind,
        ...(target.role ? { role: target.role } : {}),
      }));
  const normalizedPrimaryTargets = withScopedFieldsFromRawTargets(
    normalizedPrimaryTargetsWithoutScopedFields as ContextPackPrimaryFocusTarget[],
    payload.selectedFocusTargets,
  );
  const anchorTarget = normalizedPrimaryTargets.find((target) => target.role === 'anchor')
    ?? normalizedPrimaryTargets[0];

  if (payload.deepFocusEnabled === true && selectedTestTarget) {
    const validation = validateTestTarget({
      primaryPath: anchorTarget?.path ?? selectedFocusPath,
      primaryKind: anchorTarget?.kind ?? selectedPrimaryKind,
      testTarget: selectedTestTarget,
    });
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
  }

  // Only run deep focus validation/normalization when deep focus is active.
  // When off, persist the raw targets unchanged so they survive the toggle.
  const selectedSupportTargets = payload.deepFocusEnabled === true
    ? normalizeSupportTargets({
        primaryPath: selectedFocusPath,
        primaryKind: selectedPrimaryKind,
        primaryTargets: normalizedPrimaryTargets,
        testTarget: selectedTestTarget ?? undefined,
        rawTargets: payload.selectedSupportTargets ?? [],
      }).map(({ path, kind }) => ({ path, kind }))
    : (payload.selectedSupportTargets ?? []).map((t) => ({
        path: normalizeRelativePath(t.path),
        kind: t.kind,
      }));
  const mirrored = mirrorSinglePrimaryScopedFields(
    normalizedPrimaryTargets,
    selectedTestTarget,
    selectedSupportTargets,
  );

  return {
    ...payload,
    deepFocusEnabled: payload.deepFocusEnabled === true,
    selectedFocusPath: hasExplicitPrimaryTargets && anchorTarget ? anchorTarget.path : selectedFocusPath,
    selectedFocusTargetKind: hasExplicitPrimaryTargets && anchorTarget ? anchorTarget.kind : payload.selectedFocusTargetKind ?? null,
    selectedFocusTargets: hasExplicitPrimaryTargets ? normalizedPrimaryTargets as ContextPackPrimaryFocusTarget[] : undefined,
    selectedTestTarget: mirrored.selectedTestTarget,
    selectedSupportTargets: mirrored.selectedSupportTargets,
  };
}

async function initGitReposForNewProject(
  payload: ContextPackCreateRequest['payload'],
): Promise<void> {
  const repos = payload.bootstrapAnswers.repositories;
  if (payload.mode === 'monolith') {
    await execFileAsync('git', ['init'], { cwd: payload.discoveryRoot });
  } else {
    await Promise.all(
      repos
        .filter((repo) => repo.repoRoot)
        .map(async (repo) => {
          const repoDir = resolve(repo.repoRoot);
          await fsMkdir(repoDir, { recursive: true });
          await execFileAsync('git', ['init'], { cwd: repoDir });
        }),
    );
  }
}

export function buildContextPackWorkspaceArgs(
  action: 'preview' | 'apply' | 'clear',
  payload?: ContextPackSwitchPayload,
): string[] {
  const args = ['--action', action];
  if (payload) {
    const normalizedPayload = normalizeContextPackSwitchPayload(payload);
    args.push('--context-pack-dir', normalizedPayload.contextPackDir);
    args.push('--scope-mode', normalizedPayload.scopeMode);
    for (const repoId of normalizedPayload.selectedRepoIds ?? []) {
      args.push('--selected-repo-id', repoId);
    }
    for (const focusId of normalizedPayload.selectedFocusIds ?? []) {
      args.push('--selected-focus-id', focusId);
    }
    if (normalizedPayload.deepFocusEnabled) {
      args.push('--deep-focus-enabled');
      if (normalizedPayload.deepFocusPrimaryRepoId) {
        args.push('--deep-focus-primary-repo-id', normalizedPayload.deepFocusPrimaryRepoId);
      }
      if (normalizedPayload.deepFocusPrimaryFocusId) {
        args.push('--deep-focus-primary-focus-id', normalizedPayload.deepFocusPrimaryFocusId);
      }
    }
    // Always persist selection args so they survive toggling deep focus off.
    // When deep focus is enabled, emit the path even if empty (signals repo-root focus).
    if (normalizedPayload.selectedFocusPath || normalizedPayload.deepFocusEnabled) {
      args.push('--selected-focus-path', normalizedPayload.selectedFocusPath ?? '');
    }
    if (normalizedPayload.selectedFocusTargetKind) {
      args.push('--selected-focus-target-kind', normalizedPayload.selectedFocusTargetKind);
    }
    for (const target of normalizedPayload.selectedFocusTargets ?? []) {
      args.push('--selected-focus-target', JSON.stringify(toWorkspaceSyncPrimaryTarget(target)));
    }
    // Only emit test/support target args when deep focus is active.
    // These go through strict object validation in the Python normalizer
    // that can throw on stale persisted data in regular mode.
    // Persistence is handled by the state file merge in the Python service.
    if (normalizedPayload.deepFocusEnabled) {
      if (normalizedPayload.selectedTestTarget !== undefined) {
        args.push('--selected-test-target', JSON.stringify(normalizedPayload.selectedTestTarget));
      }
      for (const supportTarget of normalizedPayload.selectedSupportTargets ?? []) {
        args.push('--selected-support-target', JSON.stringify(supportTarget));
      }
    }
  }
  return args;
}

export async function runContextPackWorkspaceScript(args: string[]): Promise<ScriptResult> {
  const { stdout, stderr } = await execFileAsync(
    REPO_CONTEXT_PYTHON_BIN,
    [join(REPO_ROOT, 'src/backend/scripts/python/sync-context-pack-workspace.py'), ...args],
    { cwd: REPO_ROOT },
  );
  return { stdout, stderr };
}

export function buildContextPackReseedArgs(payload: ContextPackReseedPayload): string[] {
  return [REPO_CONTEXT_APP_PATH, 'seed', '--context-pack-dir', payload.contextPackDir, '--format', 'json'];
}

export async function runContextPackReseedCommand(args: string[]): Promise<ScriptResult> {
  const { stdout, stderr } = await execFileAsync(REPO_CONTEXT_PYTHON_BIN, args, { cwd: REPO_ROOT });
  return { stdout, stderr };
}

export async function runPythonScriptCommand(args: string[]): Promise<ScriptResult> {
  const { stdout, stderr } = await execFileAsync(REPO_CONTEXT_PYTHON_BIN, args, { cwd: REPO_ROOT });
  return { stdout, stderr };
}

export function buildContextPackDiscoveryArgs(
  payload: ContextPackDiscoverPrefillRequest['payload'],
): string[] {
  return [CONTEXT_ESTATE_DISCOVERY_SCRIPT_PATH, '--root', payload.rootPath, '--mode', payload.mode, '--format', 'json'];
}

function normalizeClassificationConfidence(
  value: unknown,
): 'high' | 'medium' | 'low' | undefined {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : undefined;
}

function normalizeDiscoveredRepo(value: Record<string, unknown>): ContextPackDiscoveredRepo {
  const repositoryType = normalizeRepositoryType(value.repository_type);
  return {
    repoId: stringOrNull(value.repo_id) ?? '',
    repoName: stringOrNull(value.repo_name) ?? stringOrNull(value.relative_path) ?? '',
    path: stringOrNull(value.path) ?? '',
    relativePath: stringOrNull(value.relative_path) ?? '',
    highSignalPaths: stringArray(value.high_signal_paths),
    repositoryType: repositoryType ?? undefined,
    classificationConfidence: normalizeClassificationConfidence(
      value.classification_confidence,
    ),
  };
}

function normalizeRepositoryType(value: unknown): ContextPackRepositoryType | null {
  return value === 'primary' || value === 'support' ? value : null;
}

function normalizeDiscoveredFocusArea(value: Record<string, unknown>): ContextPackDiscoveredFocusArea {
  return {
    focusId: stringOrNull(value.focus_id) ?? '',
    focusName: stringOrNull(value.focus_name) ?? stringOrNull(value.relative_path) ?? '',
    focusType: stringOrNull(value.focus_type) ?? 'general',
    path: stringOrNull(value.path) ?? '',
    relativePath: stringOrNull(value.relative_path) ?? '',
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
    const estateType = parsed.estate_type === 'distributed' ? 'distributed' : 'monolith';
    const response: ContextPackDiscoverPrefillResponse = {
      action: 'contextPack.discoverPrefill',
      mode: 'discovered',
      message: estateType === 'distributed'
        ? 'Discovery found candidate repositories for a distributed estate.'
        : 'Discovery found focus areas for a monolith root.',
      rootPath: normalizedRootPath,
      discoveryMode: parsed.discovery_mode === 'distributed' || parsed.discovery_mode === 'monolith'
        ? parsed.discovery_mode : payload.mode,
      estateType,
      suggestedContextPackId: slugifyValue(suggestedName || 'context-pack'),
      suggestedDisplayName: titleizeValue(suggestedName || 'context pack'),
      warnings: stringArray(parsed.warnings),
      candidateRepos: Array.isArray(parsed.candidate_repos)
        ? parsed.candidate_repos
          .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
          .map((repo) => {
            const normalizedRepo = normalizeDiscoveredRepo(repo);
            return {
              ...normalizedRepo,
              repositoryType: normalizedRepo.repositoryType ?? 'support',
            };
          })
        : [],
      candidateFocusAreas: Array.isArray(parsed.candidate_focus_areas)
        ? parsed.candidate_focus_areas.filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null).map(normalizeDiscoveredFocusArea)
        : [],
      highSignalPaths: Array.isArray(parsed.high_signal_paths)
        ? parsed.high_signal_paths.filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null).map(normalizeDiscoveredHighSignalPath)
        : [],
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    return {
      ok: false,
      action: 'contextPack.discoverPrefill',
      error: stderr || (error instanceof Error ? error.message : 'Context-pack discovery failed unexpectedly.'),
    };
  }
}

function buildContextPackBootstrapAnswersPayload(payload: ContextPackCreateRequest['payload']): Record<string, unknown> {
  return {
    context_pack_id: payload.bootstrapAnswers.contextPackId,
    estate_name: payload.bootstrapAnswers.estateName,
    default_scope_mode: payload.bootstrapAnswers.defaultScopeMode,
    primary_working_repo_ids: payload.bootstrapAnswers.primaryWorkingRepoIds,
    primary_focus_area_ids: payload.bootstrapAnswers.primaryFocusAreaIds,
    repositories: payload.bootstrapAnswers.repositories.map((r) => ({
      repo_root: r.repoRoot, repo_name: r.repoName, repo_id: r.repoId, owner: r.owner,
      system_layer: r.systemLayer, languages: r.languages, artifact_roots: r.artifactRoots,
      document_paths: r.documentPaths, bounded_context: r.boundedContext,
      service_name: r.serviceName, repo_role: r.repoRole, repository_type: r.repositoryType,
      workspace_activation_group: r.workspaceActivationGroup,
      default_focusable: r.defaultFocusable, activation_priority: r.activationPriority,
      adjacent_repo_ids: r.adjacentRepoIds, depends_on_repo_ids: r.dependsOnRepoIds,
      used_by_repo_ids: r.usedByRepoIds,
    })),
    focusable_areas: payload.bootstrapAnswers.focusableAreas?.map((f) => ({
      focus_id: f.focusId, focus_name: f.focusName, relative_path: f.relativePath,
      path: f.path, focus_type: f.focusType, group: f.group,
      default_focusable: f.defaultFocusable, activation_priority: f.activationPriority,
      adjacent_focus_area_ids: f.adjacentFocusAreaIds,
      repository_type: f.repositoryType,
    })),
  };
}

async function writeContextPackBootstrapAnswers(payload: ContextPackCreateRequest['payload']): Promise<string> {
  const normalizedContextPackDir = resolve(payload.contextPackDir);
  const answersPath = join(normalizedContextPackDir, 'qmd/bootstrap/bootstrap-answers.json');
  await fsMkdir(dirname(answersPath), { recursive: true });
  await fsWriteFile(answersPath, `${JSON.stringify(buildContextPackBootstrapAnswersPayload(payload), null, 2)}\n`, 'utf-8');
  return answersPath;
}

export function buildContextPackBootstrapArgs(payload: ContextPackCreateRequest['payload'], answersPath: string): string[] {
  return [CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH, '--context-pack-dir', payload.contextPackDir, '--answers-file', answersPath, '--discovery-root', payload.discoveryRoot, '--mode', payload.mode, '--format', 'json'];
}

export function buildQmdSeedPlanArgs(contextPackDir: string): string[] {
  return [QMD_SEED_PLAN_SCRIPT_PATH, '--context-pack-dir', contextPackDir, '--manifest', 'qmd/repo-sources.json', '--plan-file', 'qmd/bootstrap/seed-plan.json', '--write-plan', '--format', 'json'];
}

export function buildContextPackSeedArgs(contextPackDir: string): string[] {
  return [REPO_CONTEXT_APP_PATH, 'seed', '--context-pack-dir', contextPackDir, '--manifest', 'qmd/repo-sources.json', '--plan-file', 'qmd/bootstrap/seed-plan.json', '--plan-mode', 'prefer-plan', '--format', 'json'];
}

function normalizeContextPackCreateExecutionResult(
  bp: Record<string, unknown>, payload: ContextPackCreateRequest['payload'], answersPath: string, seedStatus: string,
): ContextPackCreateExecutionResult {
  return {
    contextPackId: stringOrNull(bp.context_pack_id) ?? payload.bootstrapAnswers.contextPackId,
    displayName: stringOrNull(bp.display_name) ?? payload.bootstrapAnswers.estateName,
    contextPackDir: resolve(payload.contextPackDir),
    discoveryRoot: stringOrNull(bp.discovery_root) ?? resolve(payload.discoveryRoot),
    discoveryMode: bp.discovery_mode === 'distributed' || bp.discovery_mode === 'monolith' ? bp.discovery_mode : payload.mode,
    estateType: bp.estate_type === 'monolith' ? 'monolith' : 'distributed-platform',
    defaultScopeMode: 'focused',
    bootstrapAnswersPath: stringOrNull(bp.bootstrap_answers_path) ?? answersPath,
    discoveryDraftPath: stringOrNull(bp.draft_path) ?? join(resolve(payload.contextPackDir), 'qmd/bootstrap/discovery-structure.json'),
    manifestPath: stringOrNull(bp.manifest_path) ?? join(resolve(payload.contextPackDir), 'qmd/repo-sources.json'),
    planPath: join(resolve(payload.contextPackDir), 'qmd/bootstrap/seed-plan.json'),
    repositoryCount: typeof bp.repository_count === 'number' ? bp.repository_count : payload.bootstrapAnswers.repositories.length,
    focusTargetCount: typeof bp.focus_target_count === 'number' ? bp.focus_target_count : payload.bootstrapAnswers.repositories.length,
    primaryWorkingRepoIds: stringArray(bp.primary_working_repo_ids),
    primaryFocusAreaIds: stringArray(bp.primary_focus_area_ids),
    seedStatus,
    warnings: stringArray(bp.warnings),
  };
}

export async function executeContextPackCreateAction(
  payload: ContextPackCreateRequest['payload'],
  bootstrapRunner: PythonScriptRunner = runPythonScriptCommand,
  planRunner: PythonScriptRunner = runPythonScriptCommand,
  seedRunner: ContextPackReseedRunner = runContextPackReseedCommand,
): Promise<DesktopInvokeResult> {
  try {
    const np = { ...payload, contextPackDir: resolve(payload.contextPackDir), discoveryRoot: resolve(payload.discoveryRoot) };
    await fsMkdir(np.discoveryRoot, { recursive: true });
    const answersPath = await writeContextPackBootstrapAnswers(np);
    const bootstrapResult = await bootstrapRunner(buildContextPackBootstrapArgs(np, answersPath));
    const bp = JSON.parse(bootstrapResult.stdout) as Record<string, unknown>;
    if (np.initGitRepos) await initGitReposForNewProject(np);
    if (np.writePlan !== false) await planRunner(buildQmdSeedPlanArgs(np.contextPackDir));
    const shouldSeedOnCreate = np.seedOnCreate !== false;
    let seedStatus = 'not-run';
    if (shouldSeedOnCreate) {
      const seedResult = await seedRunner(buildContextPackSeedArgs(np.contextPackDir));
      const parsedSeed = JSON.parse(seedResult.stdout) as Record<string, unknown>;
      seedStatus = stringOrNull(parsedSeed.overall_status) ?? 'unknown';
    }
    const response: ContextPackCreateResponse = {
      action: 'contextPack.create', mode: 'created',
      message: 'Context-pack creation completed through the shared bootstrap, planning, and initial seeding seams.',
      commandPath: toRepoRelativePath(CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH),
      result: normalizeContextPackCreateExecutionResult(bp, np, answersPath, seedStatus),
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    return { ok: false, action: 'contextPack.create', error: stderr || (error instanceof Error ? error.message : 'Context-pack creation failed unexpectedly.') };
  }
}

function normalizeContextPackReseedResult(payload: unknown, contextPackDir: string): ContextPackReseedExecutionResult {
  const report = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const cs = typeof report.conventions_summary === 'object' && report.conventions_summary !== null
    ? (report.conventions_summary as Record<string, unknown>) : {};
  const wc = typeof report.workspace_counts === 'object' && report.workspace_counts !== null
    ? (report.workspace_counts as Record<string, unknown>) : {};
  return {
    contextPackDir: resolve(contextPackDir),
    overallStatus: stringOrNull(report.overall_status) ?? 'unknown',
    reportPath: stringOrNull(report.report_path),
    seededRepoCount: typeof report.seeded_repo_count === 'number' ? report.seeded_repo_count : 0,
    blockedRepoCount: typeof report.blocked_repo_count === 'number' ? report.blocked_repo_count : 0,
    conventionsSummaryStatus: stringOrNull(cs.status) ?? null,
    conventionsPolicy: 'only-if-missing',
    workspaceFolderCount: numberOrNull(wc.folder_count),
    workspaceFileCount: numberOrNull(wc.file_count),
  };
}

async function updateSyncStateAfterReseed(
  reseedResult: ContextPackReseedExecutionResult,
): Promise<void> {
  // Counts live in the per-pack workspace-counts.json (written below). The
  // sync state file is owned by the Python apply/clear path and has a strict
  // shape (managed_folders, scope_mode, etc.); writing partial fields here
  // produces a state that fails load_sync_state validation and breaks every
  // subsequent Apply.
  try {
    const countsPath = join(reseedResult.contextPackDir, 'workspace-counts.json');
    await fsWriteFile(
      countsPath,
      JSON.stringify({
        repo_count: reseedResult.seededRepoCount + reseedResult.blockedRepoCount,
        folder_count: reseedResult.workspaceFolderCount,
        file_count: reseedResult.workspaceFileCount,
        updated_at: new Date().toISOString(),
      }, null, 2) + '\n',
      'utf-8',
    );
  } catch (err: unknown) {
    console.warn('updateSyncStateAfterReseed: failed to persist workspace-counts.json:',
      err instanceof Error ? err.message : err);
  }

  // Defensive secondary trigger: rebuild the agent-facing mirror under
  // AgentWorkSpace/qmd/context-packs/ from the canonical archive. Reseed does
  // not itself write the mirror (the seeding service is unaware of it), so
  // this is the operator's chance to repair drift outside of the activation
  // path. Best-effort — reseed must not fail because of a copy step.
  try {
    await rebuildAgentMirror(REPO_ROOT, reseedResult.contextPackDir);
  } catch (err: unknown) {
    console.warn('updateSyncStateAfterReseed: agent mirror rebuild failed:',
      err instanceof Error ? err.message : err);
  }
}

async function listApprovedContextPackDirs(): Promise<Set<string>> {
  const catalog = await listAvailableContextPacks();
  return new Set(catalog.contextPacks.map((entry) => resolve(entry.contextPackDir)));
}

export async function executeContextPackReseedAction(
  payload: ContextPackReseedPayload,
  runner: ContextPackReseedRunner = runContextPackReseedCommand,
  readApprovedContextPackDirs: ApprovedContextPackDirReader = listApprovedContextPackDirs,
): Promise<DesktopInvokeResult> {
  const normalizedContextPackDir = resolve(payload.contextPackDir);
  const approvedContextPackDirs = await readApprovedContextPackDirs();
  if (!approvedContextPackDirs.has(normalizedContextPackDir)) {
    return { ok: false, action: 'contextPack.reseed', error: 'Context-pack reseed is limited to approved catalog entries discovered through the desktop shell.' };
  }

  try {
    const result = await runner(buildContextPackReseedArgs({ contextPackDir: normalizedContextPackDir }));
    const normalized = normalizeContextPackReseedResult(JSON.parse(result.stdout), normalizedContextPackDir);
    await updateSyncStateAfterReseed(normalized);
    const response: ContextPackReseedResponse = {
      action: 'contextPack.reseed', mode: 'reseeded',
      message: 'Context-pack reseed completed through the approved repo-context seed seam. Conventions memo generation remains only-if-missing.',
      commandPath: toRepoRelativePath(REPO_CONTEXT_APP_PATH),
      result: normalized,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    if (stdout.trim().length > 0) {
      try {
        const normalized = normalizeContextPackReseedResult(JSON.parse(stdout), normalizedContextPackDir);
        return { ok: false, action: 'contextPack.reseed', error: stderr || `Context-pack reseed failed with overall_status ${normalized.overallStatus}.`,
          details: [`overall_status=${normalized.overallStatus}`, `conventions_summary_status=${normalized.conventionsSummaryStatus ?? 'unknown'}`] };
      } catch { /* fall through */ }
    }
    return { ok: false, action: 'contextPack.reseed', error: stderr || (error instanceof Error ? error.message : 'Context-pack reseed failed unexpectedly.') };
  }
}

function normalizeContextPackExecutionResult(value: unknown): ContextPackSwitchExecutionResult {
  const payload = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const workspace = typeof payload.workspace === 'object' && payload.workspace !== null ? (payload.workspace as Record<string, unknown>) : {};
  const activation = typeof payload.activation === 'object' && payload.activation !== null ? (payload.activation as Record<string, unknown>) : {};
  const wrapperAction = stringOrNull(payload.action);
  const selectedTestTarget = typeof workspace.selected_test_target === 'object' && workspace.selected_test_target !== null
    ? workspace.selected_test_target as Record<string, unknown>
    : null;
  const hasSelectedTestTargetField = Object.prototype.hasOwnProperty.call(
    workspace,
    'selected_test_target',
  );
  const selectedSupportTargets = Array.isArray(workspace.selected_support_targets)
    ? workspace.selected_support_targets.filter(
        (target): target is Record<string, unknown> =>
          typeof target === 'object' && target !== null,
      )
    : [];
  const selectedFocusTargets = Array.isArray(workspace.selected_focus_targets)
    ? workspace.selected_focus_targets.filter(
        (target): target is Record<string, unknown> =>
          typeof target === 'object' && target !== null,
      )
    : [];
  const derivedWritableRoots = Array.isArray(workspace.derived_writable_roots)
    ? workspace.derived_writable_roots.filter(
        (target): target is Record<string, unknown> =>
          typeof target === 'object' && target !== null,
      )
    : [];
  const derivedReadonlyContextRoots = Array.isArray(workspace.derived_readonly_context_roots)
    ? workspace.derived_readonly_context_roots.filter(
        (target): target is Record<string, unknown> =>
          typeof target === 'object' && target !== null,
      )
    : [];
  const normalizeDerivedRoot = (
    target: Record<string, unknown>,
  ): ContextPackDeepFocusDerivedRoot => {
    const kind: ContextPackFocusTargetKind =
      target.kind === 'directory' || target.kind === 'file' ? target.kind : 'directory';
    const reason: ContextPackDeepFocusDerivedRoot['reason'] =
      target.reason === 'selected-primary'
      || target.reason === 'primary-focus-parent'
      || target.reason === 'test-target'
      || target.reason === 'support-target'
      || target.reason === 'scoped-test-target'
      || target.reason === 'scoped-support-target'
        ? target.reason
        : 'selected-primary';
    const sourceTargets = Array.isArray(target.source_targets)
      ? target.source_targets
      : Array.isArray(target.sourceTargets)
        ? target.sourceTargets
        : [];
    const repoLocalPath = readSnakeOrCamelString(target, 'repo_local_path', 'repoLocalPath');
    return {
      path: stringOrNull(target.path) ?? '',
      kind,
      reason,
      ...(repoLocalPath ? { repoLocalPath } : {}),
      ...(sourceTargets.length > 0
        ? {
            sourceTargets: sourceTargets
              .filter((sourceTarget): sourceTarget is Record<string, unknown> =>
                typeof sourceTarget === 'object' && sourceTarget !== null)
              .map((sourceTarget) => {
                const testTarget = typeof sourceTarget.test_target === 'object' && sourceTarget.test_target !== null
                  ? sourceTarget.test_target as Record<string, unknown>
                  : typeof sourceTarget.testTarget === 'object' && sourceTarget.testTarget !== null
                    ? sourceTarget.testTarget as Record<string, unknown>
                    : null;
                const sourceRepoLocalPath = readSnakeOrCamelString(
                  sourceTarget,
                  'repo_local_path',
                  'repoLocalPath',
                );
                const repoId = readSnakeOrCamelString(sourceTarget, 'repo_id', 'repoId');
                const focusId = readSnakeOrCamelString(sourceTarget, 'focus_id', 'focusId');
                return {
                  path: stringOrNull(sourceTarget.path) ?? '',
                  kind: sourceTarget.kind === 'directory' || sourceTarget.kind === 'file' ? sourceTarget.kind : 'directory',
                  ...(sourceRepoLocalPath ? { repoLocalPath: sourceRepoLocalPath } : {}),
                  ...(repoId ? { repoId } : {}),
                  ...(focusId ? { focusId } : {}),
                  ...(sourceTarget.role === 'anchor' || sourceTarget.role === 'primary'
                    ? { role: sourceTarget.role }
                    : {}),
                  ...(testTarget
                    ? {
                        testTarget: {
                          path: stringOrNull(testTarget.path) ?? '',
                          kind: testTarget.kind === 'directory' || testTarget.kind === 'file'
                            ? testTarget.kind
                            : 'directory',
                        },
                      }
                    : {}),
                };
              }),
          }
        : {}),
    };
  };
  return {
    ok: payload.ok === true,
    wrapperAction: wrapperAction === 'apply' || wrapperAction === 'clear' ? wrapperAction : 'preview',
    stage: stringOrNull(payload.stage) ?? '',
    status: stringOrNull(payload.status) ?? '',
    activation: {
      performed: activation.performed === true,
      exitCode: typeof activation.exit_code === 'number' ? activation.exit_code : null,
      output: stringOrNull(activation.output) ?? '',
    },
    envStateCleared: payload.env_state_cleared === true,
    error: stringOrNull(payload.error),
    contextPackId: stringOrNull(workspace.context_pack_id),
    contextPackDir: stringOrNull(workspace.context_pack_dir),
    workspaceFile: stringOrNull(workspace.workspace_file),
    stateFile: stringOrNull(workspace.state_file),
    scopeMode: 'focused',
    selectedRepoIds: stringArray(workspace.selected_repo_ids),
    selectedFocusIds: stringArray(workspace.selected_focus_ids),
    warnings: stringArray(workspace.warnings),
    foldersToAdd: stringArray(workspace.folders_to_add),
    foldersToRemove: stringArray(workspace.folders_to_remove),
    managedFolders: stringArray(workspace.managed_folders),
    targetFolders: stringArray(workspace.target_folders),
    lastSyncedAt: stringOrNull(workspace.last_synced_at),
    deepFocusEnabled: workspace.deep_focus_enabled === true,
    deepFocusPrimaryRepoId: stringOrNull(workspace.deep_focus_primary_repo_id),
    deepFocusPrimaryFocusId: stringOrNull(workspace.deep_focus_primary_focus_id),
    selectedFocusPath: readDeepFocusPath(workspace.selected_focus_path),
    selectedFocusTargetKind:
      workspace.selected_focus_target_kind === 'directory'
      || workspace.selected_focus_target_kind === 'file'
        ? workspace.selected_focus_target_kind
        : null,
    selectedFocusTargets: selectedFocusTargets.map((target) => {
      const testTarget = typeof target.test_target === 'object' && target.test_target !== null
        ? target.test_target as Record<string, unknown>
        : typeof target.testTarget === 'object' && target.testTarget !== null
          ? target.testTarget as Record<string, unknown>
          : null;
      const supportTargets = Array.isArray(target.support_targets)
        ? target.support_targets
        : Array.isArray(target.supportTargets)
          ? target.supportTargets
          : [];
      const repoLocalPath = readSnakeOrCamelString(target, 'repo_local_path', 'repoLocalPath');
      const repoId = readSnakeOrCamelString(target, 'repo_id', 'repoId');
      const focusId = readSnakeOrCamelString(target, 'focus_id', 'focusId');
      return {
        path: stringOrNull(target.path) ?? '',
        kind: target.kind === 'directory' || target.kind === 'file' ? target.kind : 'directory',
        ...(repoLocalPath ? { repoLocalPath } : {}),
        ...(repoId ? { repoId } : {}),
        ...(focusId ? { focusId } : {}),
        ...(target.role === 'anchor' || target.role === 'primary' ? { role: target.role } : {}),
        ...(testTarget
          ? {
              testTarget: {
                path: stringOrNull(testTarget.path) ?? '',
                kind: testTarget.kind === 'directory' || testTarget.kind === 'file' ? testTarget.kind : 'directory',
              },
            }
          : {}),
        ...(supportTargets.length > 0
          ? {
              supportTargets: supportTargets
                .filter((supportTarget): supportTarget is Record<string, unknown> =>
                  typeof supportTarget === 'object' && supportTarget !== null)
                .map((supportTarget) => ({
                  path: stringOrNull(supportTarget.path) ?? '',
                  kind: supportTarget.kind === 'directory' || supportTarget.kind === 'file'
                    ? supportTarget.kind
                    : 'directory',
                })),
            }
          : {}),
      };
    }),
    selectedTestTarget:
      !hasSelectedTestTargetField
        ? undefined
        : selectedTestTarget
          ? {
              path: stringOrNull(selectedTestTarget.path) ?? '',
              kind:
                selectedTestTarget.kind === 'directory' || selectedTestTarget.kind === 'file'
                  ? selectedTestTarget.kind
                  : 'directory',
            }
          : null,
    selectedSupportTargets: selectedSupportTargets.map((target) => ({
      path: stringOrNull(target.path) ?? '',
      kind: target.kind === 'directory' || target.kind === 'file' ? target.kind : 'directory',
    })),
    derivedWritableRoots: derivedWritableRoots.map(normalizeDerivedRoot),
    derivedReadonlyContextRoots: derivedReadonlyContextRoots.map(normalizeDerivedRoot),
  };
}

export async function executeContextPackWorkspaceAction(
  desktopAction: 'contextPack.previewSwitch' | 'contextPack.applySwitch' | 'contextPack.clearActive',
  wrapperAction: 'preview' | 'apply' | 'clear',
  payload?: ContextPackSwitchPayload,
  runner: ContextPackWorkspaceScriptRunner = runContextPackWorkspaceScript,
): Promise<DesktopInvokeResult> {
  try {
    const result = await runner(buildContextPackWorkspaceArgs(wrapperAction, payload));
    const normalized = normalizeContextPackExecutionResult(JSON.parse(result.stdout));
    if (!normalized.ok) {
      return { ok: false, action: desktopAction, error: normalized.error ?? 'Context-pack workspace command reported a structured failure.', details: normalized.warnings, contextPackResult: normalized };
    }
    if (wrapperAction === 'apply' && normalized.contextPackDir) {
      await setActiveContextPackEnv(REPO_ROOT, normalized.contextPackDir);
    }
    if (wrapperAction === 'clear') {
      await setActiveContextPackEnv(REPO_ROOT, '');
    }
    const responseBase = {
      message: wrapperAction === 'preview'
        ? 'Context-pack workspace preview completed through the approved wrapper seam.'
        : wrapperAction === 'apply'
          ? 'Context-pack workspace apply completed through the approved wrapper seam.'
          : 'Active context-pack workspace state cleared through the approved wrapper seam.',
      commandPath: 'src/backend/scripts/python/sync-context-pack-workspace.py',
      result: normalized,
    };
    const response: ContextPackPreviewResponse | ContextPackApplyResponse | ContextPackClearResponse =
      desktopAction === 'contextPack.previewSwitch'
        ? { action: desktopAction, mode: 'preview', ...responseBase }
        : desktopAction === 'contextPack.applySwitch'
          ? { action: desktopAction, mode: 'applied', ...responseBase }
          : { action: desktopAction, mode: 'cleared', ...responseBase };
    return { ok: true, response };
  } catch (error: unknown) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    if (stdout.trim().length > 0) {
      try {
        const normalized = normalizeContextPackExecutionResult(JSON.parse(stdout));
        return { ok: false, action: desktopAction, error: (normalized.error ?? stderr) || 'Context-pack workspace command failed.', details: normalized.warnings, contextPackResult: normalized };
      } catch { /* fall through */ }
    }
    return { ok: false, action: desktopAction, error: stderr || (error instanceof Error ? error.message : 'Context-pack workspace command failed unexpectedly.') };
  }
}

const MARKDOWN_FILE_SIZE_LIMIT = 128 * 1024;

export async function pickMarkdownFileAction(): Promise<DesktopInvokeResult> {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select a Markdown file for Lily to review',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile', 'dontAddToRecent'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      const response: PlannerPickMarkdownFileResponse = {
        action: 'planner.pickMarkdownFile',
        mode: 'cancelled',
        message: 'Markdown file selection was cancelled.',
        filename: null,
        path: null,
        content: null,
      };
      return { ok: true, response };
    }

    const filePath = resolve(result.filePaths[0]);
    const ext = extname(filePath).toLowerCase();
    if (ext !== '.md') {
      return {
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: `Selected file must be a Markdown (.md) file, got ${ext || 'no extension'}.`,
      };
    }

    const fileStat = await fsStat(filePath);
    if (fileStat.size > MARKDOWN_FILE_SIZE_LIMIT) {
      return {
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: `Selected file exceeds the 128 KB size limit (${Math.round(fileStat.size / 1024)} KB).`,
      };
    }

    const content = await fsReadFile(filePath, 'utf-8');
    if (content.trim().length === 0) {
      return {
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: 'Selected Markdown file is empty.',
      };
    }

    const response: PlannerPickMarkdownFileResponse = {
      action: 'planner.pickMarkdownFile',
      mode: 'selected',
      message: `Markdown file selected: ${basename(filePath)}`,
      filename: basename(filePath),
      path: filePath,
      content,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.pickMarkdownFile',
      error: error instanceof Error ? error.message : 'Markdown file selection failed unexpectedly.',
    };
  }
}

export async function executeSetRepositoryTypeAction(
  payload: { contextPackDir: string; repoId: string; repositoryType: 'primary' | 'support' },
): Promise<DesktopInvokeResult> {
  try {
    const manifestPath = join(payload.contextPackDir, 'qmd', 'repo-sources.json');
    const raw = await fsReadFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const repositories = manifest.repositories;
    let updated = false;
    if (Array.isArray(repositories)) {
      for (const repo of repositories) {
        if (typeof repo === 'object' && repo !== null && (repo as Record<string, unknown>).repo_id === payload.repoId) {
          (repo as Record<string, unknown>).repository_type = payload.repositoryType;
          updated = true;
          break;
        }
      }
    }

    const focusableAreas = manifest.focusable_areas;
    if (!updated && Array.isArray(focusableAreas)) {
      for (const area of focusableAreas) {
        if (
          typeof area === 'object' &&
          area !== null &&
          (area as Record<string, unknown>).focus_id === payload.repoId
        ) {
          (area as Record<string, unknown>).repository_type = payload.repositoryType;
          updated = true;
          break;
        }
      }
    }

    if (!updated) {
      if (!Array.isArray(repositories) && !Array.isArray(focusableAreas)) {
        return { ok: false, action: 'contextPack.setRepositoryType', error: 'Manifest has no repositories or focusable areas array.' };
      }
      return { ok: false, action: 'contextPack.setRepositoryType', error: `Repository or focus area ${payload.repoId} not found in manifest.` };
    }

    // Keep primary_working_repo_ids consistent with repository_type mutations.
    const primaryRepoIds: string[] = [];
    if (Array.isArray(repositories)) {
      for (const repo of repositories) {
        if (
          typeof repo === 'object' && repo !== null &&
          (repo as Record<string, unknown>).repository_type === 'primary' &&
          typeof (repo as Record<string, unknown>).repo_id === 'string'
        ) {
          primaryRepoIds.push((repo as Record<string, unknown>).repo_id as string);
        }
      }
    }
    manifest.primary_working_repo_ids = primaryRepoIds;

    const primaryFocusIds: string[] = [];
    if (Array.isArray(focusableAreas)) {
      for (const area of focusableAreas) {
        if (
          typeof area === 'object' &&
          area !== null &&
          (area as Record<string, unknown>).repository_type === 'primary' &&
          typeof (area as Record<string, unknown>).focus_id === 'string'
        ) {
          primaryFocusIds.push((area as Record<string, unknown>).focus_id as string);
        }
      }
    }
    manifest.primary_focus_area_ids = primaryFocusIds;

    await fsWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    return {
      ok: true,
      response: {
        action: 'contextPack.setRepositoryType' as const,
        mode: 'updated' as const,
        message: `Set ${payload.repoId} to ${payload.repositoryType}.`,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'contextPack.setRepositoryType',
      error: error instanceof Error ? error.message : 'Failed to update repository type.',
    };
  }
}


// ── Deep Focus selections persistence ────────────────────────────────

const DEEP_FOCUS_SELECTIONS_PATH = join(
  REPO_ROOT,
  '.platform-state/deep-focus-selections.json',
);
const WORKSPACE_CONTEXT_SYNC_PATH = join(
  REPO_ROOT,
  '.platform-state/workspace-context-sync.json',
);

type PersistedSelections = Record<string, import('../src/shared/desktopContractDeepFocus').ContextPackDeepFocusState>;

async function readSelectionsFile(): Promise<PersistedSelections> {
  try {
    return JSON.parse(await fsReadFile(DEEP_FOCUS_SELECTIONS_PATH, 'utf-8')) as PersistedSelections;
  } catch {
    return {};
  }
}

async function writeSelectionsFile(selections: PersistedSelections): Promise<void> {
  await writeJsonAtomic(DEEP_FOCUS_SELECTIONS_PATH, selections);
}

function withDerivedDeepFocusRoots(
  selections: ContextPackDeepFocusState,
): ContextPackDeepFocusState {
  const derived = deriveWritableRootsFromFocusedSelection({
    primaryFocusRelativePath: selections.selectedFocusPath ?? '',
    primaryFocusTargetKind: selections.selectedFocusTargetKind ?? undefined,
    primaryFocusTargets: selections.selectedFocusTargets,
    testTarget: selections.selectedTestTarget ?? undefined,
    supportTargets: selections.selectedSupportTargets.map((target) => ({
      ...target,
      effectiveScope: target.kind === 'directory' ? 'full-directory' as const : 'exact-file' as const,
    })),
  });
  return {
    ...selections,
    derivedWritableRoots: derived.writableRoots,
    derivedReadonlyContextRoots: derived.readonlyContextRoots,
  };
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await writeTextFileAtomic(filePath, JSON.stringify(payload, null, 2) + '\n');
}

async function mirrorDeepFocusSelectionIntoWorkspaceSync(
  contextPackDir: string,
  selections: import('../src/shared/desktopContractDeepFocus').ContextPackDeepFocusState,
): Promise<void> {
  let raw: string;
  try {
    raw = await fsReadFile(WORKSPACE_CONTEXT_SYNC_PATH, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return;
    }
    throw err;
  }

  const state = JSON.parse(raw) as Record<string, unknown>;
  const activeContextPackDir = stringOrNull(state.active_context_pack_dir);
  if (!activeContextPackDir || resolve(activeContextPackDir) !== resolve(contextPackDir)) {
    return;
  }

  const before = JSON.stringify(state);
  state.deep_focus_enabled = selections.deepFocusEnabled;
  state.deep_focus_primary_repo_id = selections.deepFocusPrimaryRepoId;
  state.deep_focus_primary_focus_id = selections.deepFocusPrimaryFocusId;
  state.selected_focus_path = selections.selectedFocusPath;
  state.selected_focus_target_kind = selections.selectedFocusTargetKind;
  state.selected_focus_targets = (selections.selectedFocusTargets ?? []).map(toWorkspaceSyncPrimaryTarget);
  if (selections.selectedTestTarget === undefined) {
    delete state.selected_test_target;
  } else {
    state.selected_test_target = selections.selectedTestTarget;
  }
  state.selected_support_targets = selections.selectedSupportTargets;
  state.derived_writable_roots = selections.derivedWritableRoots ?? [];
  state.derived_readonly_context_roots = selections.derivedReadonlyContextRoots ?? [];

  if (JSON.stringify(state) === before) {
    return;
  }
  await writeJsonAtomic(WORKSPACE_CONTEXT_SYNC_PATH, state);
}

export async function saveDeepFocusSelections(
  payload: { contextPackDir: string; selections: import('../src/shared/desktopContractDeepFocus').ContextPackDeepFocusState },
): Promise<DesktopInvokeResult> {
  try {
    const selectedFocusTargets = (payload.selections.selectedFocusTargets ?? []).map(clonePrimaryFocusTarget);
    const mirrored = mirrorSinglePrimaryScopedFields(
      selectedFocusTargets,
      payload.selections.selectedTestTarget,
      payload.selections.selectedSupportTargets,
    );
    const selections = withDerivedDeepFocusRoots({
      ...payload.selections,
      selectedFocusTargets,
      selectedTestTarget: mirrored.selectedTestTarget,
      selectedSupportTargets: mirrored.selectedSupportTargets,
    });
    const all = await readSelectionsFile();
    all[payload.contextPackDir] = selections;
    await writeSelectionsFile(all);
    await mirrorDeepFocusSelectionIntoWorkspaceSync(payload.contextPackDir, selections);
    return {
      ok: true,
      response: {
        action: 'deepFocus.saveSelections' as const,
        mode: 'saved' as const,
        message: 'Deep focus selections saved.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'deepFocus.saveSelections',
      error: err instanceof Error ? err.message : 'Failed to save deep focus selections.',
    };
  }
}

export async function loadDeepFocusSelections(
  payload: { contextPackDir: string },
): Promise<DesktopInvokeResult> {
  try {
    const all = await readSelectionsFile();
    const selections = all[payload.contextPackDir] ?? null;
    return {
      ok: true,
      response: {
        action: 'deepFocus.loadSelections' as const,
        mode: 'read-only' as const,
        message: selections ? 'Deep focus selections loaded.' : 'No saved selections found.',
        selections,
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'deepFocus.loadSelections',
      error: err instanceof Error ? err.message : 'Failed to load deep focus selections.',
    };
  }
}

export async function clearDeepFocusSelections(
  payload: { contextPackDir: string },
): Promise<DesktopInvokeResult> {
  try {
    const all = await readSelectionsFile();
    delete all[payload.contextPackDir];
    await writeSelectionsFile(all);
    return {
      ok: true,
      response: {
        action: 'deepFocus.clearSelections' as const,
        mode: 'cleared' as const,
        message: 'Deep focus selections cleared.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'deepFocus.clearSelections',
      error: err instanceof Error ? err.message : 'Failed to clear deep focus selections.',
    };
  }
}
