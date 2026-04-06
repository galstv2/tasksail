/**
 * Context pack execution actions: create, reseed, workspace switch, discovery, pick directory.
 */
import { execFile } from 'node:child_process';
import { mkdir as fsMkdir, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from 'node:fs/promises';
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
  type DesktopInvokeResult,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { stringOrNull } from './utils';
import { setActiveContextPackEnv } from '../../../backend/platform/context-pack/activate';
import {
  CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH,
  CONTEXT_ESTATE_DISCOVERY_SCRIPT_PATH,
  QMD_SEED_PLAN_SCRIPT_PATH,
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
} from './main.contextPackShared';
import { listAvailableContextPacks } from './main.contextPackCatalog';

const execFileAsync = promisify(execFile);

export function buildContextPackWorkspaceArgs(
  action: 'preview' | 'apply' | 'clear',
  payload?: ContextPackSwitchPayload,
): string[] {
  const args = ['--action', action];
  if (payload) {
    args.push('--context-pack-dir', payload.contextPackDir);
    args.push('--scope-mode', payload.scopeMode);
    for (const repoId of payload.selectedRepoIds ?? []) {
      args.push('--selected-repo-id', repoId);
    }
    for (const focusId of payload.selectedFocusIds ?? []) {
      args.push('--selected-focus-id', focusId);
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

    const response: ContextPackPickDirectoryResponse = {
      action: 'contextPack.pickDirectory',
      mode: result.canceled ? 'cancelled' : 'selected',
      message: result.canceled ? 'Directory selection was cancelled.' : 'Directory selected for context-pack creation.',
      purpose: payload.purpose,
      selectedPath: result.canceled ? null : result.filePaths[0] ?? null,
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
      suggestedContextPackId: slugifyValue(normalizedRootPath.split('/').at(-1) ?? 'context-pack'),
      suggestedDisplayName: titleizeValue(normalizedRootPath.split('/').at(-1) ?? 'context pack'),
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
  return {
    contextPackDir: resolve(contextPackDir),
    overallStatus: stringOrNull(report.overall_status) ?? 'unknown',
    reportPath: stringOrNull(report.report_path),
    seededRepoCount: typeof report.seeded_repo_count === 'number' ? report.seeded_repo_count : 0,
    blockedRepoCount: typeof report.blocked_repo_count === 'number' ? report.blocked_repo_count : 0,
    conventionsSummaryStatus: stringOrNull(cs.status) ?? null,
    conventionsPolicy: 'only-if-missing',
  };
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

    const filePath = result.filePaths[0];
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
