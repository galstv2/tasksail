import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  ContextPackCreateExecutionResult,
  ContextPackCreateRequest,
  ContextPackCreateResponse,
  ContextPackEstateType,
  ContextPackPreflightError,
  DesktopInvokeResult,
} from '../../src/shared/desktopContract';
import {
  CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH,
  QMD_SEED_PLAN_SCRIPT_PATH,
  WRITE_STUB_SCOPE_TREE_SCRIPT_PATH,
  REPO_CONTEXT_APP_PATH,
  toRepoRelativePath,
  stringArray,
} from '../main.contextPackShared';
import { stringOrNull } from '../utils';
import {
  RUN_PACK_PREFLIGHT_SCRIPT_PATH,
  runPythonScriptCommand,
  runContextPackReseedCommand,
  isContextPackEstateType,
  type PythonScriptRunner,
  type ContextPackReseedRunner,
} from './shared';
import { createLogger } from '../log/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('electron/contextPackActions/create');

function isMonolithEstateMode(mode: ContextPackEstateType): boolean {
  return mode === 'monolith' || mode === 'monolith-platform';
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '.');
}

async function initGitReposForNewProject(
  payload: ContextPackCreateRequest['payload'],
): Promise<void> {
  const repos = payload.bootstrapAnswers.repositories;
  const monolithRoot = resolve(payload.discoveryRoot);
  if (isMonolithEstateMode(payload.mode)) {
    await execFileAsync('git', ['init'], { cwd: monolithRoot });
    const sideRepos = repos.filter((repo) => {
      if (!repo.repoRoot) return false;
      const repoDir = resolve(repo.repoRoot);
      if (repoDir === monolithRoot) return false;
      if (isPathInside(repoDir, monolithRoot)) {
        log.warn('context-pack.create.git-init.skipped', { repoDir, monolithRoot });
        return false;
      }
      return true;
    });
    await Promise.all(
      sideRepos.map(async (repo) => {
        const repoDir = resolve(repo.repoRoot);
        await fsMkdir(repoDir, { recursive: true });
        await execFileAsync('git', ['init'], { cwd: repoDir });
      }),
    );
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

export function buildContextPackBootstrapArgs(payload: ContextPackCreateRequest['payload']): string[] {
  return [
    CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH,
    '--context-pack-dir', payload.contextPackDir,
    '--answers-json', '-',
    '--discovery-root', payload.discoveryRoot,
    '--mode', payload.mode,
    '--format', 'json',
  ];
}

export function buildQmdSeedPlanArgs(contextPackDir: string): string[] {
  return [
    QMD_SEED_PLAN_SCRIPT_PATH,
    '--context-pack-dir', contextPackDir,
    '--manifest', 'qmd/repo-sources.json',
    '--plan-file', 'qmd/bootstrap/seed-plan.json',
    '--write-plan',
    '--format', 'json',
  ];
}

export function buildContextPackSeedArgs(contextPackDir: string): string[] {
  return [
    REPO_CONTEXT_APP_PATH,
    'seed',
    '--context-pack-dir', contextPackDir,
    '--manifest', 'qmd/repo-sources.json',
    '--plan-file', 'qmd/bootstrap/seed-plan.json',
    '--plan-mode', 'prefer-plan',
    '--format', 'json',
  ];
}

export function buildWriteStubScopeTreeArgs(
  contextPackDir: string,
  planOverallStatus: string | null,
  planRepoStatuses: string[] | null,
): string[] {
  const args = [WRITE_STUB_SCOPE_TREE_SCRIPT_PATH, '--context-pack-dir', contextPackDir];
  if (planOverallStatus !== null) {
    args.push('--plan-overall-status', planOverallStatus);
  }
  if (planRepoStatuses !== null && planRepoStatuses.length > 0) {
    args.push('--plan-repo-statuses-json', JSON.stringify(planRepoStatuses));
  }
  return args;
}

function normalizeContextPackCreateExecutionResult(
  bp: Record<string, unknown>,
  payload: ContextPackCreateRequest['payload'],
  seedStatus: string,
): ContextPackCreateExecutionResult {
  const defaultAnswersPath = join(resolve(payload.contextPackDir), 'qmd/bootstrap/bootstrap-answers.json');
  return {
    contextPackId: stringOrNull(bp.context_pack_id) ?? payload.bootstrapAnswers.contextPackId,
    displayName: stringOrNull(bp.display_name) ?? payload.bootstrapAnswers.estateName,
    contextPackDir: resolve(payload.contextPackDir),
    discoveryRoot: stringOrNull(bp.discovery_root) ?? resolve(payload.discoveryRoot),
    discoveryMode: isContextPackEstateType(bp.discovery_mode) ? bp.discovery_mode : payload.mode,
    estateType: isContextPackEstateType(bp.estate_type) ? bp.estate_type : payload.mode,
    defaultScopeMode: 'focused',
    bootstrapAnswersPath: stringOrNull(bp.bootstrap_answers_path) ?? defaultAnswersPath,
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

type PreflightOutcome =
  | { ok: true }
  | { ok: false; preflightErrors: ContextPackPreflightError[] };

interface PathDiagnostics {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
  reason?: string;
}

function contextPackCreateLogContext(payload: ContextPackCreateRequest['payload']): Record<string, unknown> {
  return {
    contextPackDir: payload.contextPackDir,
    contextPackParentDir: dirname(payload.contextPackDir),
    discoveryRoot: payload.discoveryRoot,
    mode: payload.mode,
    writePlan: payload.writePlan,
    seedOnCreate: payload.seedOnCreate,
    initGitRepos: payload.initGitRepos,
    contextPackId: payload.bootstrapAnswers.contextPackId,
    estateName: payload.bootstrapAnswers.estateName,
    repositoryCount: payload.bootstrapAnswers.repositories.length,
    focusableAreaCount: payload.bootstrapAnswers.focusableAreas?.length ?? 0,
    primaryWorkingRepoCount: payload.bootstrapAnswers.primaryWorkingRepoIds?.length ?? 0,
    primaryFocusAreaCount: payload.bootstrapAnswers.primaryFocusAreaIds?.length ?? 0,
  };
}

async function inspectPath(pathToInspect: string): Promise<PathDiagnostics> {
  try {
    const stats = await fsStat(pathToInspect);
    let writable = false;
    let reason: string | undefined;
    try {
      await fsAccess(pathToInspect, fsConstants.W_OK);
      writable = true;
    } catch (error: unknown) {
      reason = error instanceof Error ? error.message : String(error);
    }
    return {
      path: pathToInspect,
      exists: true,
      isDirectory: stats.isDirectory(),
      writable,
      ...(reason ? { reason } : {}),
    };
  } catch (error: unknown) {
    return {
      path: pathToInspect,
      exists: false,
      isDirectory: false,
      writable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runContextPackPreflight(
  payload: ContextPackCreateRequest['payload'],
  runner: PythonScriptRunner,
): Promise<PreflightOutcome> {
  const { stdout } = await runner(
    [RUN_PACK_PREFLIGHT_SCRIPT_PATH, '--payload-json', '-'],
    { stdin: JSON.stringify(payload) },
  );
  const parsed = JSON.parse(stdout) as { ok?: boolean; errors?: ContextPackPreflightError[] };
  if (parsed.ok === true) return { ok: true };
  return { ok: false, preflightErrors: parsed.errors ?? [] };
}

export async function executeContextPackCreateAction(
  payload: ContextPackCreateRequest['payload'],
  bootstrapRunner: PythonScriptRunner = runPythonScriptCommand,
  planRunner: PythonScriptRunner = runPythonScriptCommand,
  seedRunner: ContextPackReseedRunner = runContextPackReseedCommand,
  preflightRunner: PythonScriptRunner = runPythonScriptCommand,
): Promise<DesktopInvokeResult> {
  try {
    const np = { ...payload, contextPackDir: resolve(payload.contextPackDir), discoveryRoot: resolve(payload.discoveryRoot) };

    const preflight = await runContextPackPreflight(np, preflightRunner);
    if (!preflight.ok) {
      log.warn('context-pack.create.preflight.failed', {
        ...contextPackCreateLogContext(np),
        preflightScriptPath: RUN_PACK_PREFLIGHT_SCRIPT_PATH,
        errorCount: preflight.preflightErrors.length,
        errors: preflight.preflightErrors,
        contextPackDirDiagnostics: await inspectPath(np.contextPackDir),
        contextPackParentDiagnostics: await inspectPath(dirname(np.contextPackDir)),
        discoveryRootDiagnostics: await inspectPath(np.discoveryRoot),
      });
      return {
        ok: false,
        action: 'contextPack.create',
        errorCode: 'preflight-failed',
        error: preflight.preflightErrors[0]?.message ?? 'Context-pack creation rejected by preflight validation.',
        details: preflight.preflightErrors.map((e) => e.message),
        preflightErrors: preflight.preflightErrors,
      };
    }

    await fsMkdir(np.discoveryRoot, { recursive: true });
    const answersJson = JSON.stringify(buildContextPackBootstrapAnswersPayload(np));
    const bootstrapResult = await bootstrapRunner(buildContextPackBootstrapArgs(np), { stdin: answersJson });
    let bp: Record<string, unknown>;
    try {
      bp = JSON.parse(bootstrapResult.stdout) as Record<string, unknown>;
    } catch (bootstrapParseError: unknown) {
      log.warn('context-pack.create.bootstrap-output.parse.failed', {
        commandPath: CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH,
        reason: bootstrapParseError instanceof Error ? bootstrapParseError.message : String(bootstrapParseError),
      });
      throw bootstrapParseError;
    }
    if (np.initGitRepos) await initGitReposForNewProject(np);
    if (np.writePlan !== false) await planRunner(buildQmdSeedPlanArgs(np.contextPackDir));

    let planOverallStatus: string | null = null;
    let planRepoStatuses: string[] | null = null;
    try {
      const planPath = join(np.contextPackDir, 'qmd/bootstrap/seed-plan.json');
      const planRaw = JSON.parse(await fsReadFile(planPath, 'utf-8')) as Record<string, unknown>;
      planOverallStatus = stringOrNull(planRaw.overall_status);
      const repos = Array.isArray(planRaw.repositories) ? planRaw.repositories : [];
      planRepoStatuses = repos
        .map((r: unknown) => (typeof r === 'object' && r !== null ? stringOrNull((r as Record<string, unknown>).status) : null))
        .filter((s): s is string => s !== null);
    } catch (planParseError: unknown) {
      log.warn('context-pack.create.seed-plan.parse.failed', {
        reason: planParseError instanceof Error ? planParseError.message : String(planParseError),
      });
    }

    const shouldSeedOnCreate = np.seedOnCreate !== false;
    let seedStatus = 'not-run';
    if (shouldSeedOnCreate) {
      const seedResult = await seedRunner(buildContextPackSeedArgs(np.contextPackDir));
      const parsedSeed = JSON.parse(seedResult.stdout) as Record<string, unknown>;
      seedStatus = stringOrNull(parsedSeed.overall_status) ?? 'unknown';
    } else if (np.initGitRepos) {
      try {
        await planRunner(buildWriteStubScopeTreeArgs(np.contextPackDir, planOverallStatus, planRepoStatuses));
      } catch (stubErr: unknown) {
        log.warn('context-pack.create.stub-scope-tree.write.failed', {
          contextPackDir: np.contextPackDir,
          reason: stubErr instanceof Error ? stubErr.message : String(stubErr),
        });
      }
    }
    const response: ContextPackCreateResponse = {
      action: 'contextPack.create',
      mode: 'created',
      message: 'Context-pack creation completed through the shared bootstrap, planning, and initial seeding seams.',
      commandPath: toRepoRelativePath(CONTEXT_PACK_BOOTSTRAP_SCRIPT_PATH),
      result: normalizeContextPackCreateExecutionResult(bp, np, seedStatus),
    };
    return { ok: true, response };
  } catch (error: unknown) {
    log.error(
      'context-pack.create.failed',
      error,
      contextPackCreateLogContext({
        ...payload,
        contextPackDir: resolve(payload.contextPackDir),
        discoveryRoot: resolve(payload.discoveryRoot),
      }),
    );
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    return {
      ok: false,
      action: 'contextPack.create',
      error: stderr || (error instanceof Error ? error.message : 'Context-pack creation failed unexpectedly.'),
    };
  }
}
