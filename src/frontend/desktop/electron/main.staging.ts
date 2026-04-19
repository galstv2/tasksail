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
} from '../../../backend/platform/context-pack/deepFocusNormalization.js';
import { sleep } from '../../../backend/platform/core/io.js';
import { slugify } from '../../../backend/platform/core/text.js';
import { formatContextPackBindingSection } from '../../../backend/platform/queue/markdown.js';
import type { StagedDraftContent } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { getNodeErrorCode } from './main.textUtils';

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const STAGING_DIR = join(DROPBOX_DIR, '.staging');
const PLANNER_STAGING_SIDECAR_FILENAME = '.planner-staged-session.json';
const PLANNER_STAGING_SIDECAR_PATH = join(STAGING_DIR, PLANNER_STAGING_SIDECAR_FILENAME);
const PLANNER_LOCK_DIRNAME = '.planner-lock.d';
const PLANNER_LOCK_DIR = join(STAGING_DIR, PLANNER_LOCK_DIRNAME);
const PLANNER_LOCK_OWNER_PATH = join(PLANNER_LOCK_DIR, 'owner.json');

type PlannerTaskKind = 'standard' | 'child-task';

export type PlannerStagingLineage = {
  taskKind: PlannerTaskKind;
  parentTaskId: string;
  rootTaskId: string;
  parentQmdRecordId: string;
  parentQmdScope: string;
  followUpReason: string;
};

export type PlannerStagingContextPackBinding = {
  contextPackDir: string;
  contextPackId: string;
  scopeMode: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled: boolean;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: FocusTargetKind | null;
  selectedTestTarget: FocusTarget | null;
  selectedSupportTargets: NormalizedSupportTarget[];
};

export type PlannerStagingSidecar = {
  version: 1;
  ownership: 'planner-session';
  sessionId: string;
  draftFilename: string;
  draftPath: string;
  createdAt: string;
  title: string;
  primaryRepoId: string;
  primaryRepoRoot: string;
  primaryFocusRelativePath: string | null;
  deepFocusEnabled: boolean;
  primaryFocusTargetKind: FocusTargetKind | null;
  selectedTestTarget: FocusTarget | null;
  supportTargets: NormalizedSupportTarget[];
  lineage: PlannerStagingLineage;
  contextPackBinding: PlannerStagingContextPackBinding;
};

export type PlannerStagingLockOwnership = {
  version: 1;
  sessionId: string;
  acquiredAt: string;
};

export type InitializeStagedPlanningDraftOptions = {
  sessionId: string;
  contextPackDir?: string | null;
  focusedRepo?: Pick<
    FocusedRepoResult,
    | 'primaryRepoId'
    | 'primaryRepoRoot'
    | 'primaryFocusRelativePath'
    | 'deepFocusEnabled'
    | 'primaryFocusTargetKind'
    | 'selectedTestTarget'
    | 'supportTargets'
    | 'selectedRepoIds'
    | 'selectedFocusIds'
  >;
  title?: string;
  lineage?: Partial<PlannerStagingLineage>;
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

function buildPlannerStagedFilename(title: string, now: Date): string {
  const slug = slugify(title, 'planner-draft').slice(0, 80);
  return `${formatCompactTimestamp(now)}_${slug}.md`;
}

function renderPlannerStagedShell(metadata: PlannerStagingSidecar): string {
  const bindingSection = formatContextPackBindingSection(metadata.contextPackBinding);

  return `# ${metadata.title}

## Task Lineage

- Task Kind: ${metadata.lineage.taskKind}
- Parent Task ID: ${metadata.lineage.parentTaskId}
- Root Task ID: ${metadata.lineage.rootTaskId}
- Parent QMD Record ID: ${metadata.lineage.parentQmdRecordId}
- Parent QMD Scope: ${metadata.lineage.parentQmdScope}
- Follow-Up Reason: ${metadata.lineage.followUpReason}

${bindingSection}

## Request Summary
<!-- (2+ sentences) — keep it lean for simple asks; add more detail for complex asks when needed. State what the operator wants done and why. -->

## Desired Outcome
<!-- (1+ sentences) — keep it brief for simple asks; expand for complex asks if helpful. Describe success from the operator's perspective. -->

## Constraints
<!-- (0+ bullets) — keep only the needed constraints for simple asks; add more for complex asks when helpful. Use "None" if not applicable. -->

## Acceptance Signals
<!-- (1+ bullets) — add the minimum clear checks for simple asks; include more for complex asks as needed. Each should be measurable and verifiable. -->

## Parent Task Carry-Forward Summary
<!-- (0+ bullets) — required for "child-task" to preserve parent carry-forward context; leave blank for "standard" tasks. -->

## Suggested Routing
<!-- (1 word) - Recommended Execution: "Simple" for one coherent ask, "Complex" only when the work clearly breaks into separate streams or slices. -->
- Recommended Execution:
<!-- (1-2 sentences) - Explain why this should stay lean or expand. -->
- Planner Notes:

## Source

- Created By: Planning Agent
- Created At (UTC): ${metadata.createdAt}
`;
}

function derivePlannerScopeMode(
  focusedRepo?: InitializeStagedPlanningDraftOptions['focusedRepo'],
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
}): string {
  const primaryRepoId = trimOrEmpty(args.primaryRepoId);
  const primaryRepoRoot = trimOrEmpty(args.primaryRepoRoot);
  const repoTitle = primaryRepoRoot ? basename(primaryRepoRoot) : primaryRepoId;
  const baseTitle = repoTitle || primaryRepoId;
  if (!baseTitle) {
    return '';
  }

  const primaryFocusRelativePath = trimOrEmpty(args.primaryFocusRelativePath);
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
      };
      await fsWriteFile(PLANNER_LOCK_OWNER_PATH, JSON.stringify(ownership, null, 2) + '\n', 'utf-8');
      return ownership;
    } catch (error: unknown) {
      if (getNodeErrorCode(error) !== 'EEXIST') {
        throw error;
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
  });

  if (!title) {
    throw new Error('Planner staging requires a deterministic derived title before Lily can draft.');
  }

  const taskKind = options.lineage?.taskKind ?? 'standard';
  const parentTaskId = trimOrEmpty(options.lineage?.parentTaskId);
  const draftFilename = buildPlannerStagedFilename(title, now);
  const fileTitle = draftFilename.replace(/\.md$/, '');
  const isDeepFocus = options.focusedRepo?.deepFocusEnabled === true;
  const deepFocusTestTarget = isDeepFocus
    ? (options.focusedRepo!.selectedTestTarget ? { ...options.focusedRepo!.selectedTestTarget } : null)
    : null;
  const deepFocusSupportTargets = isDeepFocus
    ? options.focusedRepo!.supportTargets?.map((target) => ({ ...target })) ?? []
    : [];

  const metadata: PlannerStagingSidecar = {
    version: 1,
    ownership: 'planner-session',
    sessionId: options.sessionId,
    draftFilename,
    draftPath: '',
    createdAt: normalizeIsoTimestamp(now),
    title: fileTitle,
    primaryRepoId: trimOrEmpty(options.focusedRepo?.primaryRepoId),
    primaryRepoRoot: trimOrEmpty(options.focusedRepo?.primaryRepoRoot),
    primaryFocusRelativePath: trimOrEmpty(options.focusedRepo?.primaryFocusRelativePath) || null,
    deepFocusEnabled: isDeepFocus,
    primaryFocusTargetKind: options.focusedRepo?.primaryFocusTargetKind ?? null,
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
    contextPackBinding: {
      contextPackDir: trimOrEmpty(options.contextPackDir),
      contextPackId: trimOrEmpty(options.contextPackDir) ? basename(trimOrEmpty(options.contextPackDir)) : '',
      scopeMode: derivePlannerScopeMode(options.focusedRepo, options.contextPackDir),
      selectedRepoIds: [...(options.focusedRepo?.selectedRepoIds ?? [])],
      selectedFocusIds: [...(options.focusedRepo?.selectedFocusIds ?? [])],
      deepFocusEnabled: isDeepFocus,
      selectedFocusPath: trimOrEmpty(options.focusedRepo?.primaryFocusRelativePath) || null,
      selectedFocusTargetKind: options.focusedRepo?.primaryFocusTargetKind ?? null,
      selectedTestTarget: deepFocusTestTarget,
      selectedSupportTargets: deepFocusSupportTargets,
    },
  };
  metadata.draftPath = join(STAGING_DIR, metadata.draftFilename);

  await acquirePlannerStagingLock(options.sessionId);

  try {
    await Promise.all([
      fsWriteFile(metadata.draftPath, renderPlannerStagedShell(metadata), 'utf-8'),
      fsWriteFile(PLANNER_STAGING_SIDECAR_PATH, JSON.stringify(metadata, null, 2) + '\n', 'utf-8'),
    ]);
    return metadata;
  } catch (error: unknown) {
    await clearStagingArtifacts({ sessionId: options.sessionId, force: true });
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
