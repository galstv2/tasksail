import { BrowserWindow } from 'electron';
import path from 'node:path';

import {
  collectFocusedRepoTargetDirectoryRoots,
  resolveFirstLocalPath,
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
  type FocusedRepoResult,
  type Manifest,
  type ManifestRepo,
} from '../../../backend/platform/context-pack/focusedRepo.js';
import type { GenericAgentEnv } from '../../../backend/platform/cli-provider/types.js';
import { getPlannerHistoryRecord } from '../../../backend/platform/planner-history/store.js';
import type { PlannerStagingSidecar } from '../../../backend/platform/planner-history/types.js';
import { readTextFile, resolvePath, safeJsonParse } from '../../../backend/platform/core/index.js';
import {
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
  type PlannerChildTaskLineage,
  type PlannerFocusSnapshot,
  type PlannerStartSessionDeepFocusSelection,
} from '../src/shared/desktopContract';
import { PLANNER_SAVE_DRAFT_WORKFLOW, wrapFreshSessionMessage } from '../src/shared/plannerWorkflow';
import { readWorkspaceSyncStateSnapshot } from './main.contextPackCatalog';
import { REPO_ROOT } from './paths';
import { createLogger } from './log/logger';
import {
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
} from './main.staging';
import { getPlanningAgentAllowedRoots } from './plannerCliProcess';
import { PlannerSessionBroker, type PlannerSendResult } from './plannerSessionBroker';
import {
  appendPendingMessage,
  beginPendingRecord,
  discardPendingRecord,
} from './plannerHistory';

const log = createLogger('electron/plannerSession');

const broker = new PlannerSessionBroker({
  emitEvent: (plannerEvent) => {
    if (
      plannerEvent.eventType === 'planner.turn.message' &&
      plannerEvent.messageKind === 'final' &&
      plannerEvent.content?.trim()
    ) {
      appendPendingMessage('planner', plannerEvent.content, new Date().toISOString(), plannerEvent.sessionId);
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(DESKTOP_SHELL_PLANNER_EVENT_CHANNEL, plannerEvent);
      }
    }
  },
});

/** Tracks whether the first operator message has been sent in the current session. */
let firstMessageSent = false;

export async function startSession(
  contextPackDir: string,
  uiSelection?: PlannerStartSessionDeepFocusSelection,
  replayConversationId?: string,
  childTaskFocusSnapshot?: PlannerFocusSnapshot,
  childTaskLineage?: PlannerChildTaskLineage,
): Promise<{ sessionId: string; created: boolean }> {
  if (childTaskLineage && !childTaskFocusSnapshot) {
    throw new Error('Child-task planner sessions require a focus snapshot.');
  }
  const replayRecord = replayConversationId
    ? await getPlannerHistoryRecord({
        repoRoot: REPO_ROOT,
        contextPackDir,
        contextPackId: (await readWorkspaceSyncStateSnapshot()).activeContextPackId ?? undefined,
        recordId: replayConversationId,
      })
    : null;
  if (replayConversationId && !replayRecord) {
    throw new Error('Planner conversation history record was not found for replay.');
  }
  const effectiveContextPackDir = childTaskFocusSnapshot?.contextPackDir
    ?? replayRecord?.sidecarSnapshot.contextPackBinding.contextPackDir
    ?? contextPackDir;
  const focused = replayRecord
    ? buildReplayFocusedRepo(replayRecord.sidecarSnapshot)
    : childTaskFocusSnapshot
      ? buildFocusedRepoFromSnapshot(childTaskFocusSnapshot)
      : uiSelection?.deepFocusEnabled === true
      ? await buildFocusedRepoFromUiSelection(contextPackDir, uiSelection)
      : await resolveSelectedPrimaryRepoRoot(contextPackDir, REPO_ROOT)
        ?? await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  const allowedRoots = dedupeRoots([
    ...getPlanningAgentAllowedRoots(),
    ...(focused?.visibleRepoRoots ?? []),
    // Planner context roots include writable and read-only Deep Focus targets;
    // Dalton write authority is enforced separately from writableRoots.
    ...(focused?.deepFocusEnabled === true ? collectFocusedRepoTargetDirectoryRoots(focused) : []),
  ]);
  const focusEnv = focused ? toFocusEnv(focused, effectiveContextPackDir) : undefined;
  const result = broker.startSession({ contextPackDir: effectiveContextPackDir, allowedRoots, focusEnv });

  if (!result.created) {
    return result;
  }

  firstMessageSent = false;

  try {
    await clearStagingArtifacts({ force: true });
    const sidecarSnapshot = await initializeStagedPlanningDraft({
      sessionId: result.sessionId,
      contextPackDir: effectiveContextPackDir,
      focusedRepo: toStagingFocusedRepo(focused),
      ...(replayRecord ? {
        title: replayRecord.sidecarSnapshot.title,
        lineage: replayRecord.sidecarSnapshot.lineage,
        contextPackBinding: replayRecord.sidecarSnapshot.contextPackBinding,
      } : {}),
      ...(childTaskFocusSnapshot && childTaskLineage ? {
        title: childTaskFocusSnapshot.title,
        lineage: {
          taskKind: 'child-task' as const,
          ...childTaskLineage,
        },
        contextPackBinding: childTaskFocusSnapshot.contextPackBinding,
      } : {}),
    });
    if (sidecarSnapshot) {
      beginPendingRecord(result.sessionId, effectiveContextPackDir, sidecarSnapshot);
    }
    return result;
  } catch (error: unknown) {
    broker.endSession();
    discardPendingRecord();
    log.warn('planner.session.start.cleanup.failed', {
      contextPackDir: effectiveContextPackDir,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildReplayFocusedRepo(snapshot: PlannerStagingSidecar): FocusedRepoResult {
  const binding = snapshot.contextPackBinding;
  const targetRepoRoots = binding.selectedFocusTargets
    .map((target) => target.repoLocalPath)
    .filter((root): root is string => Boolean(root?.trim()));
  const roots = dedupeRoots([
    snapshot.primaryRepoRoot,
    ...targetRepoRoots,
  ]);

  return {
    primaryRepoRoot: snapshot.primaryRepoRoot,
    visibleRepoRoots: roots,
    declaredRepoRoots: roots,
    estateType: 'distributed-platform',
    primaryRepoId: snapshot.primaryRepoId,
    primaryFocusId: binding.selectedFocusIds[0],
    primaryFocusRelativePath: binding.selectedFocusPath ?? undefined,
    deepFocusEnabled: binding.deepFocusEnabled,
    primaryFocusTargetKind: binding.selectedFocusTargetKind ?? undefined,
    primaryFocusTargets: binding.selectedFocusTargets.map((target) => ({ ...target })),
    selectedTestTarget: binding.selectedTestTarget ? { ...binding.selectedTestTarget } : binding.selectedTestTarget,
    supportTargets: binding.selectedSupportTargets.map((target) => ({ ...target })),
    selectedRepoIds: [...binding.selectedRepoIds],
    selectedFocusIds: [...binding.selectedFocusIds],
    authoritySource: 'active-task-sidecar',
  };
}

function buildFocusedRepoFromSnapshot(snapshot: PlannerFocusSnapshot): FocusedRepoResult {
  const binding = snapshot.contextPackBinding;
  const targetRepoRoots = binding.selectedFocusTargets
    .map((target) => target.repoLocalPath)
    .filter((root): root is string => Boolean(root?.trim()));
  const roots = dedupeRoots([
    snapshot.primaryRepoRoot,
    ...targetRepoRoots,
  ]);

  return {
    primaryRepoRoot: snapshot.primaryRepoRoot,
    visibleRepoRoots: roots,
    declaredRepoRoots: roots,
    estateType: 'distributed-platform',
    primaryRepoId: snapshot.primaryRepoId,
    primaryFocusId: binding.selectedFocusIds[0],
    primaryFocusRelativePath: snapshot.primaryFocusRelativePath ?? undefined,
    deepFocusEnabled: snapshot.deepFocusEnabled,
    primaryFocusTargetKind: snapshot.primaryFocusTargetKind ?? undefined,
    primaryFocusTargets: snapshot.primaryFocusTargets.map((target) => ({ ...target })),
    selectedTestTarget: snapshot.selectedTestTarget ? { ...snapshot.selectedTestTarget } : snapshot.selectedTestTarget,
    supportTargets: snapshot.supportTargets.map((target) => ({ ...target })),
    selectedRepoIds: [...binding.selectedRepoIds],
    selectedFocusIds: [...binding.selectedFocusIds],
    authoritySource: 'active-task-sidecar',
  };
}

async function buildFocusedRepoFromUiSelection(
  contextPackDir: string,
  uiSelection: PlannerStartSessionDeepFocusSelection,
): Promise<FocusedRepoResult> {
  const anchorTarget = uiSelection.selectedFocusTargets.find((target) => target.role === 'anchor')
    ?? uiSelection.selectedFocusTargets[0];
  const selectedTestTarget = uiSelection.selectedTestTarget ?? anchorTarget?.testTarget ?? null;
  const manifestFocused = await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  const manifestRoots = await resolveUiSelectionManifestRoots(contextPackDir, uiSelection);
  const primaryFocusTargets = uiSelection.selectedFocusTargets.map((target) => {
    const manifestRepoRoot = target.repoId ? manifestRoots.repoRootById.get(target.repoId) : undefined;
    return {
      ...target,
      ...(manifestRepoRoot ? { repoLocalPath: manifestRepoRoot } : {}),
      ...(!manifestRepoRoot && target.repoLocalPath ? { repoLocalPath: undefined } : {}),
    };
  });
  const primaryRepoRoot = manifestRoots.primaryRepoRoot
    ?? manifestFocused?.primaryRepoRoot
    ?? REPO_ROOT;
  const visibleRepoRoots = dedupeRoots([
    primaryRepoRoot,
    ...(manifestRoots.visibleRepoRoots.length > 0
      ? manifestRoots.visibleRepoRoots
      : manifestFocused?.visibleRepoRoots ?? []),
  ]);

  return {
    primaryRepoRoot,
    visibleRepoRoots,
    declaredRepoRoots: manifestRoots.declaredRepoRoots.length > 0
      ? manifestRoots.declaredRepoRoots
      : manifestFocused?.declaredRepoRoots ?? visibleRepoRoots,
    estateType: manifestFocused?.estateType ?? 'distributed-platform',
    primaryRepoId: uiSelection.deepFocusPrimaryRepoId
      ?? anchorTarget?.repoId
      ?? manifestFocused?.primaryRepoId
      ?? '',
    primaryFocusId: uiSelection.deepFocusPrimaryFocusId
      ?? anchorTarget?.focusId
      ?? manifestFocused?.primaryFocusId,
    primaryFocusRelativePath: uiSelection.selectedFocusPath ?? undefined,
    deepFocusEnabled: true,
    primaryFocusTargetKind: uiSelection.selectedFocusTargetKind ?? undefined,
    primaryFocusTargets,
    selectedTestTarget: selectedTestTarget ? { ...selectedTestTarget } : null,
    supportTargets: uiSelection.selectedSupportTargets.map((target) => ({
      ...target,
      effectiveScope: 'full-directory',
    })),
    selectedRepoIds: [...uiSelection.selectedRepoIds],
    selectedFocusIds: [...uiSelection.selectedFocusIds],
    authoritySource: 'workspace-sync-state',
  };
}

async function resolveUiSelectionManifestRoots(
  contextPackDir: string,
  uiSelection: PlannerStartSessionDeepFocusSelection,
): Promise<{
  primaryRepoRoot?: string;
  visibleRepoRoots: string[];
  declaredRepoRoots: string[];
  repoRootById: Map<string, string>;
}> {
  const resolvedPackDir = resolvePath(REPO_ROOT, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const content = await readTextFile(manifestPath);
  if (content === undefined) {
    return { visibleRepoRoots: [], declaredRepoRoots: [], repoRootById: new Map() };
  }
  const manifest = safeJsonParse<Manifest>(content, manifestPath);
  if (!manifest) {
    return { visibleRepoRoots: [], declaredRepoRoots: [], repoRootById: new Map() };
  }

  const repos = collectManifestRepos(manifest);
  const declaredRepoRoots = repos
    .map((repo) => resolveFirstLocalPath(repo, resolvedPackDir))
    .filter((root): root is string => Boolean(root));
  const repoById = new Map(
    repos
      .filter((repo) => typeof repo.repo_id === 'string' && repo.repo_id.trim())
      .map((repo) => [repo.repo_id!.trim(), repo]),
  );
  const repoRootById = new Map<string, string>();
  for (const [repoId, repo] of repoById.entries()) {
    const repoRoot = resolveFirstLocalPath(repo, resolvedPackDir);
    if (repoRoot) {
      repoRootById.set(repoId, repoRoot);
    }
  }
  const anchorTarget = uiSelection.selectedFocusTargets.find((target) => target.role === 'anchor')
    ?? uiSelection.selectedFocusTargets[0];
  const primaryRepoId = uiSelection.deepFocusPrimaryRepoId ?? anchorTarget?.repoId ?? undefined;
  const primaryRepoRoot = primaryRepoId
    ? resolveRepoRootById(repoById, primaryRepoId, resolvedPackDir)
    : undefined;
  const selectedRepoRoots = uiSelection.selectedFocusTargets
    .map((target) => target.repoId)
    .filter((repoId): repoId is string => Boolean(repoId?.trim()))
    .map((repoId) => resolveRepoRootById(repoById, repoId, resolvedPackDir))
    .filter((root): root is string => Boolean(root));

  return {
    primaryRepoRoot,
    visibleRepoRoots: dedupeRoots([
      ...(primaryRepoRoot ? [primaryRepoRoot] : []),
      ...selectedRepoRoots,
    ]),
    declaredRepoRoots,
    repoRootById,
  };
}

function collectManifestRepos(manifest: Manifest): ManifestRepo[] {
  const repos: ManifestRepo[] = [];
  if (manifest.repository) {
    repos.push(manifest.repository);
  }
  if (Array.isArray(manifest.repositories)) {
    repos.push(...manifest.repositories);
  }
  return repos;
}

function resolveRepoRootById(
  repoById: Map<string, ManifestRepo>,
  repoId: string,
  contextPackDir: string,
): string | undefined {
  const repo = repoById.get(repoId.trim());
  return repo ? resolveFirstLocalPath(repo, contextPackDir) : undefined;
}

export async function sendMessage(text: string, displayText?: string): Promise<PlannerSendResult> {
  let message = text;
  if (!firstMessageSent) {
    firstMessageSent = true;
    message = wrapFreshSessionMessage(text);
  }
  const result = await broker.sendMessage(message);
  if (result === 'sent') {
    const sessionId = broker.getObservability().sessionId ?? undefined;
    appendPendingMessage('operator', displayText ?? text, new Date().toISOString(), sessionId);
  }
  return result;
}

export async function endSession(): Promise<{ ended: boolean }> {
  const sessionId = broker.getObservability().sessionId;
  broker.endSession();
  discardPendingRecord();
  if (!sessionId) {
    return { ended: false };
  }

  try {
    await clearStagingArtifacts({ sessionId });
  } catch (error: unknown) {
    log.warn('planner.session.staging-cleanup.failed', {
      sessionId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return { ended: true };
}

export async function saveDraft(): Promise<PlannerSendResult> {
  return broker.saveDraft(PLANNER_SAVE_DRAFT_WORKFLOW.prompt);
}

export function isSessionActive(): boolean {
  return broker.isSessionActive();
}

export function getSessionState() {
  return broker.getState();
}

export function getObservability() {
  return broker.getObservability();
}

function dedupeRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const normalized = root.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function toStagingFocusedRepo(
  focused?: FocusedRepoResult,
): Pick<
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
> | undefined {
  if (!focused) {
    return undefined;
  }

  return {
    estateType: focused.estateType,
    primaryRepoId: focused.primaryRepoId,
    primaryRepoRoot: focused.primaryRepoRoot,
    primaryFocusId: focused.primaryFocusId,
    primaryFocusRelativePath: focused.primaryFocusRelativePath,
    deepFocusEnabled: focused.deepFocusEnabled,
    primaryFocusTargetKind: focused.primaryFocusTargetKind,
    primaryFocusTargets: focused.primaryFocusTargets?.map((target) => ({ ...target })),
    selectedTestTarget: focused.selectedTestTarget
      ? { ...focused.selectedTestTarget }
      : focused.deepFocusEnabled === true
        ? null
        : undefined,
    supportTargets: focused.supportTargets?.map((target) => ({ ...target })),
    selectedRepoIds: [...focused.selectedRepoIds],
    selectedFocusIds: [...focused.selectedFocusIds],
  };
}

type PlannerPrimaryFocusTargetEnv = {
  path: string;
  kind: 'file' | 'directory';
  role?: 'anchor' | 'primary';
  testTarget?: { path: string; kind: 'file' | 'directory' };
  supportTargets?: Array<{ path: string; kind: 'file' | 'directory' }>;
};

function toFocusEnv(
  focused: FocusedRepoResult,
  contextPackDir: string,
): Omit<GenericAgentEnv, 'model' | 'agentId'> {
  const primaryFocusTargets = resolvePrimaryFocusTargetsForPlannerEnv(focused);
  const anchorTarget = primaryFocusTargets.find((target) => target.role === 'anchor')
    ?? primaryFocusTargets[0];
  const selectedTestTarget = focused.testTarget
    ?? focused.selectedTestTarget
    ?? anchorTarget?.testTarget
    ?? undefined;

  return {
    platformRepoRoot: REPO_ROOT,
    handoffsDir: undefined,
    implStepsDir: undefined,
    targetReposJson: focused.visibleRepoRoots.length > 0
      ? JSON.stringify(focused.visibleRepoRoots)
      : undefined,
    primaryFocusPath: focused.primaryFocusRelativePath ?? undefined,
    primaryFocusTargetKind: focused.primaryFocusTargetKind ?? undefined,
    primaryFocusTargetsJson: primaryFocusTargets.length > 0
      ? JSON.stringify(primaryFocusTargets)
      : undefined,
    writableRootsJson: focused.writableRoots?.length
      ? JSON.stringify(focused.writableRoots)
      : undefined,
    readonlyContextRootsJson: focused.readonlyContextRoots?.length
      ? JSON.stringify(focused.readonlyContextRoots)
      : undefined,
    testTargetPath: selectedTestTarget?.path ?? undefined,
    testTargetKind: selectedTestTarget?.kind ?? undefined,
    contextPackPaths: contextPackDir,
    contextPackSearchRoots: contextPackDir,
  };
}

function resolvePrimaryFocusTargetsForPlannerEnv(
  focused: FocusedRepoResult,
): PlannerPrimaryFocusTargetEnv[] {
  if (!focused.primaryFocusTargets?.length) {
    return [];
  }

  return focused.primaryFocusTargets.map((target, index) => ({
    path: target.path,
    kind: target.kind,
    role: target.role ?? (index === 0 ? 'anchor' : 'primary'),
    ...(target.testTarget ? {
      testTarget: {
        path: target.testTarget.path,
        kind: target.testTarget.kind,
      },
    } : {}),
    ...((target.supportTargets?.length ?? 0) > 0 ? {
      supportTargets: target.supportTargets!.map((supportTarget) => ({
        path: supportTarget.path,
        kind: supportTarget.kind,
      })),
    } : {}),
  }));
}
