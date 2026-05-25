import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReadDir,
  rm as fsRm,
  stat as fsStat,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { FocusedRepoResult } from '../../../backend/platform/context-pack/focusedRepo.js';
import type {
  FocusTarget,
  FocusTargetKind,
  NormalizedSupportTarget,
  PrimaryFocusTarget,
} from '../../../backend/platform/context-pack/deepFocusNormalization.js';
import type {
  PlannerStagingContextPackBinding,
  PlannerStagingLineage,
  PlannerStagingSidecar,
} from '../../../backend/platform/planner-history/types.js';
import { sleep } from '../../../backend/platform/core/io.js';
import { slugify } from '../../../backend/platform/core/text.js';
import { formatAgentVisibleContextPackBindingSection } from '../../../backend/platform/queue/markdown.js';
import type { StagedDraftContent } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { getNodeErrorCode } from './main.textUtils';
import { createLogger } from './log/logger';

const log = createLogger('electron/main.staging');

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const STAGING_DIR = join(DROPBOX_DIR, '.staging');
const PLANNING_INTAKE_TEMPLATE_PATH = join(REPO_ROOT, 'AgentWorkSpace', 'templates', 'planning-intake.md');
const PLANNER_STAGING_SIDECAR_FILENAME = '.planner-staged-session.json';
const PLANNER_STAGING_SIDECAR_PATH = join(STAGING_DIR, PLANNER_STAGING_SIDECAR_FILENAME);
const PLANNER_LOCK_DIRNAME = '.planner-lock.d';
const PLANNER_LOCK_DIR = join(STAGING_DIR, PLANNER_LOCK_DIRNAME);
const PLANNER_LOCK_OWNER_PATH = join(PLANNER_LOCK_DIR, 'owner.json');

export type {
  PlannerStagingContextPackBinding,
  PlannerStagingLineage,
  PlannerStagingSidecar,
};

export type PlannerStagingLockOwnership = {
  version: 1;
  sessionId: string;
  acquiredAt: string;
  pid?: number;
};

export type InitializeStagedPlanningDraftOptions = {
  sessionId: string;
  contextPackDir?: string | null;
  focusedRepo?: Pick<
    FocusedRepoResult,
    | 'estateType'
    | 'primaryRepoId'
    | 'primaryRepoRoot'
    | 'primaryFocusId'
    | 'primaryFocusRelativePath'
    | 'deepFocusEnabled'
    | 'primaryFocusTargetKind'
    | 'primaryFocusTargets'
    | 'selectedTestTarget'
    | 'supportTargets'
    | 'selectedRepoIds'
    | 'selectedFocusIds'
  >;
  title?: string;
  lineage?: Partial<PlannerStagingLineage>;
  contextPackBinding?: PlannerStagingContextPackBinding;
  childTaskExecutionScope?: PlannerStagingContextPackBinding;
  now?: Date;
};

export type StagedDraftReadResult = {
  draft: StagedDraftContent | null;
  error: string | null;
};

export type OwnedStagedDraftReadResult = StagedDraftReadResult & {
  metadata: PlannerStagingSidecar | null;
};

type ClearStagingArtifactsOptions = {
  sessionId?: string | null;
  force?: boolean;
};


function formatCompactTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function normalizeIsoTimestamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, 'Z');
}

function trimOrEmpty(value?: string | null): string {
  return value?.trim() ?? '';
}

function cloneFocusTarget<T extends FocusTarget | NormalizedSupportTarget>(target: T): T {
  return { ...target };
}

function clonePrimaryFocusTarget(target: PrimaryFocusTarget): PrimaryFocusTarget {
  const scopedTarget = target as PrimaryFocusTarget & {
    testTarget?: FocusTarget | null;
    supportTargets?: FocusTarget[];
  };
  return {
    ...target,
    ...(scopedTarget.testTarget !== undefined
      ? { testTarget: scopedTarget.testTarget === null ? null : cloneFocusTarget(scopedTarget.testTarget) }
      : {}),
    ...(scopedTarget.supportTargets
      ? { supportTargets: scopedTarget.supportTargets.map((supportTarget) => cloneFocusTarget(supportTarget)) }
      : {}),
  };
}

function cloneContextPackBinding(
  binding: PlannerStagingContextPackBinding,
): PlannerStagingContextPackBinding {
  return {
    ...binding,
    ...(trimOrEmpty(binding.deepFocusPrimaryRepoId) ? { deepFocusPrimaryRepoId: trimOrEmpty(binding.deepFocusPrimaryRepoId) } : {}),
    ...(trimOrEmpty(binding.deepFocusPrimaryFocusId) ? { deepFocusPrimaryFocusId: trimOrEmpty(binding.deepFocusPrimaryFocusId) } : {}),
    selectedRepoIds: [...binding.selectedRepoIds],
    selectedFocusIds: [...binding.selectedFocusIds],
    ...(binding.repositoryTypes ? { repositoryTypes: { ...binding.repositoryTypes } } : {}),
    selectedFocusTargets: binding.selectedFocusTargets.map(clonePrimaryFocusTarget),
    selectedTestTarget: binding.selectedTestTarget
      ? cloneFocusTarget(binding.selectedTestTarget)
      : binding.selectedTestTarget,
    selectedSupportTargets: binding.selectedSupportTargets.map((target) => ({ ...target })),
  };
}

function buildPlannerStagedFilename(title: string, now: Date): string {
  const slug = slugify(title, 'planner-draft').slice(0, 80);
  return `${formatCompactTimestamp(now)}_${slug}.md`;
}

function extractEditablePlanningIntakeTemplateBody(raw: string): string {
  const startIdx = raw.indexOf('## Request Summary');
  if (startIdx === -1) {
    throw new Error(`Planning intake template is missing ## Request Summary: ${PLANNING_INTAKE_TEMPLATE_PATH}`);
  }
  const endIdx = raw.indexOf('\n## Source', startIdx);
  return (endIdx === -1 ? raw.slice(startIdx) : raw.slice(startIdx, endIdx)).trimEnd();
}

function extractTitleHint(raw: string): string {
  const titleIdx = raw.indexOf('# Task Title');
  if (titleIdx === -1) {
    throw new Error(`Planning intake template is missing # Task Title: ${PLANNING_INTAKE_TEMPLATE_PATH}`);
  }
  const startIdx = raw.indexOf('\n', titleIdx);
  const bodyStartIdx = startIdx === -1 ? raw.length : startIdx + 1;
  const nextSectionIdx = raw.indexOf('\n## ', bodyStartIdx);
  return raw.slice(bodyStartIdx, nextSectionIdx === -1 ? undefined : nextSectionIdx).trim();
}

export async function readTitleHintFromTemplate(): Promise<string> {
  const raw = await fsReadFile(PLANNING_INTAKE_TEMPLATE_PATH, 'utf-8');
  return extractTitleHint(raw);
}

async function renderPlannerStagedShell(metadata: PlannerStagingSidecar): Promise<string> {
  const bindingSection = formatAgentVisibleContextPackBindingSection(metadata.contextPackBinding);
  const rawTemplate = await fsReadFile(PLANNING_INTAKE_TEMPLATE_PATH, 'utf-8');
  const editableBody = extractEditablePlanningIntakeTemplateBody(rawTemplate);
  const titleHint = extractTitleHint(rawTemplate);
  const renderedTitleHint = titleHint ? `\n${titleHint}` : '';

  return `# Task Title${renderedTitleHint}

## Task Lineage

- Task Kind: ${metadata.lineage.taskKind}
- Parent Task ID: ${metadata.lineage.parentTaskId}
- Root Task ID: ${metadata.lineage.rootTaskId}
- Parent QMD Record ID: ${metadata.lineage.parentQmdRecordId}
- Parent QMD Scope: ${metadata.lineage.parentQmdScope}
- Follow-Up Reason: ${metadata.lineage.followUpReason}

${bindingSection}

${editableBody}

## Source

- Created By: Planning Agent
- Created At (UTC): ${metadata.createdAt}
`;
}

export function isMonolithEstate(estateType?: string): boolean {
  return estateType === 'monolith' || estateType === 'monolith-platform';
}

export function derivePlannerScopeMode(
  focusedRepo?: {
    selectedFocusIds?: string[];
    selectedRepoIds?: string[];
  } | null,
  contextPackDir?: string | null,
): string {
  if ((focusedRepo?.selectedFocusIds ?? []).length > 0) {
    return 'focus-selection';
  }
  if ((focusedRepo?.selectedRepoIds ?? []).length > 0) {
    return 'repo-selection';
  }
  return trimOrEmpty(contextPackDir) ? 'context-pack' : '';
}

export function derivePlannerDraftTitle(args: {
  primaryRepoId?: string | null;
  primaryRepoRoot?: string | null;
  primaryFocusRelativePath?: string | null;
  primaryFocusTargetKind?: FocusTargetKind | null;
  primaryFocusTargets?: PrimaryFocusTarget[] | null;
  selectedFocusIds?: string[] | null;
}): string {
  const primaryRepoId = trimOrEmpty(args.primaryRepoId);
  const primaryRepoRoot = trimOrEmpty(args.primaryRepoRoot);
  const repoTitle = primaryRepoRoot ? basename(primaryRepoRoot) : primaryRepoId;
  const baseTitle = repoTitle || primaryRepoId;
  if (!baseTitle) {
    return '';
  }

  const selectedFocusCount = args.selectedFocusIds?.filter((id) => id.trim()).length ?? 0;
  if (selectedFocusCount > 1) {
    return `${baseTitle} (+${selectedFocusCount} focus areas)`;
  }

  const primaryFocusRelativePath = trimOrEmpty(args.primaryFocusRelativePath);
  const primaryFocusTargets = (args.primaryFocusTargets ?? []).filter((target) => target.path !== undefined);
  if (primaryFocusTargets.length > 1) {
    const anchor = primaryFocusTargets.find((target) => target.role === 'anchor') ?? primaryFocusTargets[0]!;
    const anchorPath = trimOrEmpty(anchor.path);
    const parentPaths = new Set(primaryFocusTargets.map((target) => {
      const normalized = trimOrEmpty(target.path);
      if (!normalized) return '';
      const slashIndex = normalized.lastIndexOf('/');
      return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
    }));
    if (parentPaths.size === 1) {
      const parent = [...parentPaths][0]!;
      return parent
        ? `${baseTitle} / ${parent} (+${primaryFocusTargets.length} targets)`
        : `${baseTitle} (+${primaryFocusTargets.length} targets)`;
    }
    const title = anchorPath ? `${baseTitle} / ${anchorPath}` : baseTitle;
    return anchor.kind === 'file'
      ? `${title} (file, +${primaryFocusTargets.length - 1} targets)`
      : `${title} (+${primaryFocusTargets.length - 1} targets)`;
  }
  if (!primaryFocusRelativePath) {
    return baseTitle;
  }

  const title = `${baseTitle} / ${primaryFocusRelativePath}`;
  return args.primaryFocusTargetKind === 'file' ? `${title} (file)` : title;
}

export async function readPlannerStagingSidecar(): Promise<PlannerStagingSidecar | null> {
  try {
    const raw = await fsReadFile(PLANNER_STAGING_SIDECAR_PATH, 'utf-8');
    return JSON.parse(raw) as PlannerStagingSidecar;
  } catch (error: unknown) {
    if (getNodeErrorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readPlannerStagingLockOwnership(): Promise<PlannerStagingLockOwnership | null> {
  try {
    const raw = await fsReadFile(PLANNER_LOCK_OWNER_PATH, 'utf-8');
    return JSON.parse(raw) as PlannerStagingLockOwnership;
  } catch (error: unknown) {
    if (getNodeErrorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * If the planner-staging lock dir exists but its recorded holder PID is dead
 * (the previous Electron run crashed without releasing), remove the lock dir
 * so the next acquire attempt can claim it. Returns true if reclamation
 * occurred. Conservative: any uncertainty (missing PID, alive PID, missing
 * owner file) leaves the lock alone.
 */
async function tryReclaimStalePlannerLock(): Promise<boolean> {
  const owner = await readPlannerStagingLockOwnership();
  if (!owner || typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0) {
    return false;
  }
  if (!isPidDead(owner.pid)) {
    return false;
  }
  await fsUnlink(PLANNER_LOCK_OWNER_PATH).catch(() => undefined);
  await fsRm(PLANNER_LOCK_DIR, { recursive: true, force: true });
  return true;
}

function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err: unknown) {
    return getNodeErrorCode(err) === 'ESRCH';
  }
}

export async function acquirePlannerStagingLock(
  sessionId: string,
  options: { maxRetries?: number; backoffMs?: number } = {},
): Promise<PlannerStagingLockOwnership> {
  await fsMkdir(STAGING_DIR, { recursive: true });

  const maxRetries = options.maxRetries ?? 30;
  let waitMs = options.backoffMs ?? 50;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      await fsMkdir(PLANNER_LOCK_DIR);
      const ownership: PlannerStagingLockOwnership = {
        version: 1,
        sessionId,
        acquiredAt: normalizeIsoTimestamp(new Date()),
        pid: process.pid,
      };
      await fsWriteFile(PLANNER_LOCK_OWNER_PATH, JSON.stringify(ownership, null, 2) + '\n', 'utf-8');
      return ownership;
    } catch (error: unknown) {
      if (getNodeErrorCode(error) !== 'EEXIST') {
        throw error;
      }
      // If the recorded holder process is dead, the previous Electron run
      // crashed without releasing. Reclaim the lock dir and retry immediately.
      if (await tryReclaimStalePlannerLock()) {
        continue;
      }
    }

    await sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 2000);
  }

  const currentOwner = await readPlannerStagingLockOwnership();
  throw new Error(
    currentOwner?.sessionId
      ? `Planner staging workspace is locked by session ${currentOwner.sessionId}.`
      : 'Planner staging workspace is locked by another session.',
  );
}

export async function releasePlannerStagingLock(
  sessionId?: string | null,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const ownership = await readPlannerStagingLockOwnership();
  if (ownership && !options.force && !sessionId) {
    return false;
  }
  if (ownership && !options.force && sessionId && ownership.sessionId !== sessionId) {
    return false;
  }

  await fsUnlink(PLANNER_LOCK_OWNER_PATH).catch((error: unknown) => {
    if (getNodeErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  });
  await fsRm(PLANNER_LOCK_DIR, { recursive: true, force: true });
  return true;
}

export async function initializeStagedPlanningDraft(
  options: InitializeStagedPlanningDraftOptions,
): Promise<PlannerStagingSidecar> {
  const now = options.now ?? new Date();
  const title = trimOrEmpty(options.title) || derivePlannerDraftTitle({
    primaryRepoId: options.focusedRepo?.primaryRepoId,
    primaryRepoRoot: options.focusedRepo?.primaryRepoRoot,
    primaryFocusRelativePath: options.focusedRepo?.primaryFocusRelativePath,
    primaryFocusTargetKind: options.focusedRepo?.primaryFocusTargetKind,
    primaryFocusTargets: options.focusedRepo?.primaryFocusTargets,
    selectedFocusIds: options.focusedRepo?.selectedFocusIds,
  });

  if (!title) {
    throw new Error('Planner staging requires a deterministic derived title before Lily can draft.');
  }

  const taskKind = options.lineage?.taskKind ?? 'standard';
  const parentTaskId = trimOrEmpty(options.lineage?.parentTaskId);
  const draftFilename = buildPlannerStagedFilename(title, now);
  const isDeepFocus = options.focusedRepo?.deepFocusEnabled === true;
  const deepFocusTestTarget = isDeepFocus
    ? (options.focusedRepo!.selectedTestTarget ? { ...options.focusedRepo!.selectedTestTarget } : null)
    : null;
  const deepFocusSupportTargets = isDeepFocus
    ? options.focusedRepo!.supportTargets?.map((target) => ({ ...target })) ?? []
    : [];
  const deepFocusPrimaryTargets = isDeepFocus
    ? options.focusedRepo!.primaryFocusTargets?.map(clonePrimaryFocusTarget) ?? []
    : [];
  const hasMultipleStandardFocusPrimaries = !isDeepFocus
    && isMonolithEstate(options.focusedRepo?.estateType)
    && (options.focusedRepo?.selectedFocusIds?.filter((id) => id.trim()).length ?? 0) > 1;

  const defaultContextPackBinding: PlannerStagingContextPackBinding = options.contextPackBinding
    ? cloneContextPackBinding(options.contextPackBinding)
    : {
        contextPackDir: trimOrEmpty(options.contextPackDir),
        contextPackId: trimOrEmpty(options.contextPackDir) ? basename(trimOrEmpty(options.contextPackDir)) : '',
        scopeMode: derivePlannerScopeMode(options.focusedRepo, options.contextPackDir),
        primaryRepoId: isMonolithEstate(options.focusedRepo?.estateType)
          ? undefined
          : (trimOrEmpty(options.focusedRepo?.primaryRepoId) || undefined),
        primaryFocusId: hasMultipleStandardFocusPrimaries
          ? undefined
          : trimOrEmpty(options.focusedRepo?.primaryFocusId) || undefined,
        deepFocusPrimaryRepoId: isDeepFocus && !isMonolithEstate(options.focusedRepo?.estateType)
          ? trimOrEmpty(options.focusedRepo?.primaryRepoId) || undefined
          : undefined,
        deepFocusPrimaryFocusId: isDeepFocus && isMonolithEstate(options.focusedRepo?.estateType)
          ? trimOrEmpty(options.focusedRepo?.primaryFocusId) || undefined
          : undefined,
        selectedRepoIds: isMonolithEstate(options.focusedRepo?.estateType)
          ? []
          : [...(options.focusedRepo?.selectedRepoIds ?? [])],
        selectedFocusIds: [...(options.focusedRepo?.selectedFocusIds ?? [])],
        deepFocusEnabled: isDeepFocus,
        selectedFocusPath: hasMultipleStandardFocusPrimaries
          ? null
          : trimOrEmpty(options.focusedRepo?.primaryFocusRelativePath) || null,
        selectedFocusTargetKind: options.focusedRepo?.primaryFocusTargetKind ?? null,
        selectedFocusTargets: deepFocusPrimaryTargets,
        selectedTestTarget: deepFocusTestTarget,
        selectedSupportTargets: deepFocusSupportTargets,
      };
  const childTaskExecutionScope = options.childTaskExecutionScope
    ? cloneContextPackBinding(options.childTaskExecutionScope)
    : undefined;

  const metadata: PlannerStagingSidecar = {
    version: 1,
    ownership: 'planner-session',
    sessionId: options.sessionId,
    draftFilename,
    draftPath: '',
    createdAt: normalizeIsoTimestamp(now),
    title,
    primaryRepoId: trimOrEmpty(options.focusedRepo?.primaryRepoId),
    primaryRepoRoot: trimOrEmpty(options.focusedRepo?.primaryRepoRoot),
    primaryFocusRelativePath: hasMultipleStandardFocusPrimaries
      ? null
      : trimOrEmpty(options.focusedRepo?.primaryFocusRelativePath) || null,
    deepFocusEnabled: isDeepFocus,
    primaryFocusTargetKind: options.focusedRepo?.primaryFocusTargetKind ?? null,
    primaryFocusTargets: deepFocusPrimaryTargets,
    selectedTestTarget: deepFocusTestTarget,
    supportTargets: deepFocusSupportTargets,
    lineage: {
      taskKind,
      parentTaskId,
      rootTaskId: trimOrEmpty(options.lineage?.rootTaskId) || (taskKind === 'child-task' ? parentTaskId : ''),
      parentQmdRecordId: trimOrEmpty(options.lineage?.parentQmdRecordId),
      parentQmdScope: trimOrEmpty(options.lineage?.parentQmdScope),
      followUpReason: trimOrEmpty(options.lineage?.followUpReason),
    },
    contextPackBinding: childTaskExecutionScope ?? defaultContextPackBinding,
    ...(childTaskExecutionScope ? { childTaskExecutionScope } : {}),
  };
  metadata.draftPath = join(STAGING_DIR, metadata.draftFilename);

  await acquirePlannerStagingLock(options.sessionId);

  try {
    await Promise.all([
      fsWriteFile(metadata.draftPath, await renderPlannerStagedShell(metadata), 'utf-8'),
      fsWriteFile(PLANNER_STAGING_SIDECAR_PATH, JSON.stringify(metadata, null, 2) + '\n', 'utf-8'),
    ]);
    return metadata;
  } catch (error: unknown) {
    try {
      await clearStagingArtifacts({ sessionId: options.sessionId, force: true });
    } catch (cleanupError: unknown) {
      log.error(
        'planner-staging.rollback.failed',
        cleanupError instanceof Error ? cleanupError : { reason: String(cleanupError) },
        {
          sessionId: options.sessionId,
          originalError: error instanceof Error ? error.message : String(error),
        },
      );
    }
    throw error;
  }
}

export async function readOwnedStagedDraft(
  sessionId?: string | null,
): Promise<OwnedStagedDraftReadResult> {
  try {
    const metadata = await readPlannerStagingSidecar();
    if (!metadata) {
      return { draft: null, error: null, metadata: null };
    }
    if (sessionId && metadata.sessionId !== sessionId) {
      return {
        draft: null,
        error: `Staged planner draft is owned by session ${metadata.sessionId}, not ${sessionId}.`,
        metadata,
      };
    }

    const content = await fsReadFile(metadata.draftPath, 'utf-8');
    if (content.trim().length === 0) {
      return {
        draft: null,
        error: `Staged draft ${metadata.draftFilename} is empty. Ask Lily to rewrite the draft before finalizing.`,
        metadata,
      };
    }

    const info = await fsStat(metadata.draftPath);
    return {
      draft: {
        filename: metadata.draftFilename,
        content,
        modifiedAt: info.mtime.toISOString(),
      },
      error: null,
      metadata,
    };
  } catch (error: unknown) {
    if (getNodeErrorCode(error) === 'ENOENT') {
      return {
        draft: null,
        error: 'Planner staging metadata is present but the owned staged draft is missing.',
        metadata: await readPlannerStagingSidecar(),
      };
    }

    return {
      draft: null,
      error: error instanceof Error ? error.message : 'Failed to read staged draft.',
      metadata: null,
    };
  }
}

export async function readStagedDraft(sessionId?: string | null): Promise<StagedDraftReadResult> {
  const ownedDraft = await readOwnedStagedDraft(sessionId);
  if (ownedDraft.metadata) {
    return {
      draft: ownedDraft.draft,
      error: ownedDraft.error,
    };
  }
  if (sessionId) {
    return {
      draft: ownedDraft.draft,
      error: ownedDraft.error,
    };
  }

  try {
    const entries = await fsReadDir(STAGING_DIR);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));
    if (mdFiles.length === 0) {
      return { draft: null, error: null };
    }

    let newest: { name: string; mtime: Date } | null = null;
    for (const name of mdFiles) {
      const info = await fsStat(join(STAGING_DIR, name));
      if (!newest || info.mtimeMs > newest.mtime.getTime()) {
        newest = { name, mtime: info.mtime };
      }
    }
    if (!newest) {
      return { draft: null, error: null };
    }

    const content = await fsReadFile(join(STAGING_DIR, newest.name), 'utf-8');
    if (content.trim().length === 0) {
      return {
        draft: null,
        error: `Staged draft ${newest.name} is empty. Ask Lily to rewrite the draft before finalizing.`,
      };
    }

    return {
      draft: {
        filename: newest.name,
        content,
        modifiedAt: newest.mtime.toISOString(),
      },
      error: null,
    };
  } catch (error: unknown) {
    if (getNodeErrorCode(error) === 'ENOENT') {
      return { draft: null, error: null };
    }

    return {
      draft: null,
      error: error instanceof Error ? error.message : 'Failed to read staged draft.',
    };
  }
}

export async function clearStagingArtifacts(
  options: ClearStagingArtifactsOptions = {},
): Promise<void> {
  const ownership = await readPlannerStagingLockOwnership();
  if (ownership && !options.force) {
    if (!options.sessionId) {
      return;
    }
    if (ownership.sessionId !== options.sessionId) {
      return;
    }
  }

  await fsMkdir(STAGING_DIR, { recursive: true });
  try {
    const entries = await fsReadDir(STAGING_DIR);
    await Promise.all(
      entries
        .filter((f) => f.endsWith('.md') || f.endsWith('.json'))
        .map((name) =>
          fsUnlink(join(STAGING_DIR, name)).catch((err: unknown) => {
            if (getNodeErrorCode(err) !== 'ENOENT') {
              throw err;
            }
          }),
        ),
    );
  } catch (error: unknown) {
    if (getNodeErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }

  await releasePlannerStagingLock(options.sessionId, { force: options.force });
}
