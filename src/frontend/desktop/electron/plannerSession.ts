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
import type {
  PlannerStagingContextPackBinding,
  PlannerStagingSidecar,
} from '../../../backend/platform/planner-history/types.js';
import { readTextFile, resolvePath, safeJsonParse } from '../../../backend/platform/core/index.js';
import {
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
  type PlannerChildTaskLineage,
  type PlannerChildTaskExecutionScope,
  type PlannerFocusSnapshot,
  type PlannerLilyPersonalityId,
  type PlannerLilyPlanningReloadScope,
  type PlannerParentBranchViewRequest,
  type PlannerParentBranchViewStatus,
  type PlannerStartSessionDeepFocusSelection,
} from '../src/shared/desktopContract';
import { normalizeRepositoryTypesForSelection } from '../../../backend/platform/queue/repositoryTypes.js';
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
import { assertPlannerHistoryRecordHydratable, childTaskHydrateMessage } from './plannerRecentChildTaskEligibility';
import {
  cleanupPlannerParentBranchViewSession,
  createPlannerParentBranchViewSession,
  type PlannerParentBranchViewSession,
} from './plannerParentBranchView';

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
let activeParentBranchViewSession: PlannerParentBranchViewSession | null = null;

export async function startSession(
  contextPackDir: string,
  uiSelection?: PlannerStartSessionDeepFocusSelection,
  replayConversationId?: string,
  childTaskFocusSnapshot?: PlannerFocusSnapshot,
  childTaskLineage?: PlannerChildTaskLineage,
  childTaskExecutionScope?: PlannerChildTaskExecutionScope,
  lilyPlanningReloadScope?: PlannerLilyPlanningReloadScope,
  parentTaskBranchView?: PlannerParentBranchViewRequest,
  lilyPersonalityId?: PlannerLilyPersonalityId,
): Promise<{ sessionId: string; created: boolean; parentBranchViewStatus?: PlannerParentBranchViewStatus }> {
  if (broker.isSessionActive()) {
    return broker.startSession();
  }
  await cleanupActiveParentBranchViewSession();
  if (childTaskLineage && !childTaskFocusSnapshot) {
    throw new Error('Child-task planner sessions require a focus snapshot.');
  }
  if (lilyPlanningReloadScope && !childTaskExecutionScope) {
    throw new Error('Lily Planning Reload Scope requires Child Execution Scope authority.');
  }
  if (lilyPlanningReloadScope && childTaskFocusSnapshot && (
    lilyPlanningReloadScope.contextPackDir !== childTaskFocusSnapshot.contextPackDir
    || lilyPlanningReloadScope.contextPackId !== childTaskFocusSnapshot.contextPackId
  )) {
    throw new Error('Lily Planning Reload Scope must match the selected parent context pack.');
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
  if (replayRecord?.sidecarSnapshot.lineage.taskKind === 'child-task') {
    const eligibility = await assertPlannerHistoryRecordHydratable(replayRecord, REPO_ROOT);
    if (!eligibility.visible) {
      throw new Error(childTaskHydrateMessage(eligibility));
    }
  }
  const effectiveContextPackDir = childTaskFocusSnapshot?.contextPackDir
    ?? replayRecord?.sidecarSnapshot.contextPackBinding.contextPackDir
    ?? contextPackDir;
  const unrewrittenFocused = replayRecord
    ? buildReplayFocusedRepo(replayRecord.sidecarSnapshot)
    : lilyPlanningReloadScope
      ? await buildFocusedRepoFromLilyPlanningReloadScope(effectiveContextPackDir, lilyPlanningReloadScope, childTaskFocusSnapshot)
    : childTaskFocusSnapshot
      ? buildFocusedRepoFromSnapshot(childTaskFocusSnapshot)
      : uiSelection?.deepFocusEnabled === true
      ? await buildFocusedRepoFromUiSelection(contextPackDir, uiSelection)
      : await resolveSelectedPrimaryRepoRoot(contextPackDir, REPO_ROOT)
        ?? await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  const plannerSessionId = parentTaskBranchView && childTaskFocusSnapshot && childTaskLineage
    ? `planner-${Date.now()}`
    : undefined;
  let runtimeFocused = unrewrittenFocused;
  let parentBranchViewStatus: PlannerParentBranchViewStatus | undefined;
  let parentBranchViewSession: PlannerParentBranchViewSession | undefined;
  if (plannerSessionId) {
    const parentBranchView = await createPlannerParentBranchViewSession({
      plannerSessionId,
      focused: unrewrittenFocused,
      request: parentTaskBranchView,
    });
    runtimeFocused = parentBranchView.focused;
    parentBranchViewStatus = parentBranchView.status;
    parentBranchViewSession = parentBranchView.session;
  }
  const allowedRoots = dedupeRoots([
    ...getPlanningAgentAllowedRoots(),
    ...(runtimeFocused?.visibleRepoRoots ?? []),
    // Planner context roots include writable and read-only Deep Focus targets;
    // Dalton write authority is enforced separately from writableRoots.
    ...(runtimeFocused?.deepFocusEnabled === true ? collectFocusedRepoTargetDirectoryRoots(runtimeFocused) : []),
  ]);
  const focusEnv = runtimeFocused ? toFocusEnv(runtimeFocused, effectiveContextPackDir) : undefined;
  // A parent branch view session created above must be cleaned up if
  // broker.startSession throws or reuses an existing session (created false),
  // otherwise its worktrees would be orphaned. Only adopt it as the active
  // session once the broker confirms a newly created session.
  let result: ReturnType<typeof broker.startSession>;
  try {
    result = broker.startSession({ sessionId: plannerSessionId, contextPackDir: effectiveContextPackDir, allowedRoots, focusEnv, lilyPersonalityId: lilyPersonalityId ?? 'balanced' });
  } catch (error: unknown) {
    if (parentBranchViewSession) {
      await cleanupParentBranchViewSession(parentBranchViewSession);
    }
    log.warn('planner.session.start.cleanup.failed', {
      contextPackDir: effectiveContextPackDir,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (!result.created) {
    if (parentBranchViewSession) {
      await cleanupParentBranchViewSession(parentBranchViewSession);
    }
    return result;
  }
  activeParentBranchViewSession = parentBranchViewSession ?? null;

  firstMessageSent = false;

  try {
    await clearStagingArtifacts({ force: true });
    const sidecarSnapshot = await initializeStagedPlanningDraft({
      sessionId: result.sessionId,
      contextPackDir: effectiveContextPackDir,
      focusedRepo: toStagingFocusedRepo(unrewrittenFocused),
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
        ...(childTaskExecutionScope ? {
          childTaskExecutionScope: toStagingContextPackBinding(childTaskExecutionScope),
        } : {}),
      } : {}),
    });
    if (sidecarSnapshot) {
      beginPendingRecord(result.sessionId, effectiveContextPackDir, sidecarSnapshot);
    }
    return { ...result, parentBranchViewStatus };
  } catch (error: unknown) {
    broker.endSession();
    discardPendingRecord();
    await cleanupActiveParentBranchViewSession();
    log.warn('planner.session.start.cleanup.failed', {
      contextPackDir: effectiveContextPackDir,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function updateSessionPersonality(
  lilyPersonalityId: PlannerLilyPersonalityId,
): Promise<{
  action: 'planner.updateSessionPersonality';
  mode: 'updated';
  accepted: true;
  message: string;
  lilyPersonalityId: PlannerLilyPersonalityId;
}> {
  const result = broker.updateSessionPersonality(lilyPersonalityId);
  if (result === 'no-session') {
    throw new Error('No active planner session to update personality.');
  }
  if (result === 'locked') {
    throw new Error('Planner personality is locked after the first message.');
  }
  return {
    action: 'planner.updateSessionPersonality',
    mode: 'updated',
    accepted: true,
    message: 'Planner personality updated.',
    lilyPersonalityId,
  };
}

async function buildFocusedRepoFromLilyPlanningReloadScope(
  contextPackDir: string,
  reloadScope: PlannerLilyPlanningReloadScope,
  snapshot?: PlannerFocusSnapshot,
): Promise<FocusedRepoResult> {
  if (!reloadScope.deepFocusEnabled) {
    const manifestFocused = await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
    const manifestRoots = await resolveReloadScopeStandardRoots(contextPackDir, reloadScope);
    const primaryRepoId = primaryIdFromRepositoryTypes(reloadScope.selectedRepoIds, reloadScope.repositoryTypes)
      ?? snapshot?.primaryRepoId
      ?? manifestFocused?.primaryRepoId
      ?? '';
    const primaryFocusId = primaryIdFromRepositoryTypes(reloadScope.selectedFocusIds, reloadScope.repositoryTypes)
      ?? snapshot?.contextPackBinding.primaryFocusId
      ?? manifestFocused?.primaryFocusId;
    const primaryRepoRoot = (primaryRepoId ? manifestRoots.repoRootsById.get(primaryRepoId) : undefined)
      ?? snapshot?.primaryRepoRoot
      ?? manifestFocused?.primaryRepoRoot
      ?? manifestRoots.visibleRepoRoots[0]
      ?? REPO_ROOT;
    return {
      primaryRepoRoot,
      visibleRepoRoots: dedupeRoots([primaryRepoRoot, ...manifestRoots.visibleRepoRoots]),
      declaredRepoRoots: manifestRoots.declaredRepoRoots.length > 0
        ? manifestRoots.declaredRepoRoots
        : manifestFocused?.declaredRepoRoots ?? [primaryRepoRoot],
      estateType: manifestFocused?.estateType ?? 'distributed-platform',
      primaryRepoId,
      primaryFocusId,
      primaryFocusRelativePath: snapshot?.primaryFocusRelativePath ?? undefined,
      deepFocusEnabled: false,
      primaryFocusTargetKind: snapshot?.primaryFocusTargetKind ?? undefined,
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      selectedRepoIds: [...reloadScope.selectedRepoIds],
      selectedFocusIds: [...reloadScope.selectedFocusIds],
      authoritySource: 'workspace-sync-state',
    };
  }
  return buildFocusedRepoFromUiSelection(contextPackDir, {
    deepFocusEnabled: reloadScope.deepFocusEnabled,
    deepFocusPrimaryRepoId: reloadScope.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: reloadScope.deepFocusPrimaryFocusId,
    selectedFocusPath: reloadScope.selectedFocusPath,
    selectedFocusTargetKind: reloadScope.selectedFocusTargetKind,
    selectedFocusTargets: reloadScope.selectedFocusTargets,
    selectedTestTarget: reloadScope.selectedTestTarget,
    selectedSupportTargets: reloadScope.selectedSupportTargets,
    selectedRepoIds: reloadScope.selectedRepoIds,
    selectedFocusIds: reloadScope.selectedFocusIds,
  });
}

async function resolveReloadScopeStandardRoots(
  contextPackDir: string,
  reloadScope: PlannerLilyPlanningReloadScope,
): Promise<{ visibleRepoRoots: string[]; declaredRepoRoots: string[]; repoRootsById: Map<string, string> }> {
  const resolvedPackDir = resolvePath(REPO_ROOT, contextPackDir);
  const manifestPath = path.join(resolvedPackDir, 'qmd', 'repo-sources.json');
  const content = await readTextFile(manifestPath);
  if (content === undefined) {
    return { visibleRepoRoots: [], declaredRepoRoots: [], repoRootsById: new Map() };
  }
  const manifest = safeJsonParse<Manifest>(content, manifestPath);
  if (!manifest) {
    return { visibleRepoRoots: [], declaredRepoRoots: [], repoRootsById: new Map() };
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
  const visibleRepoRoots = reloadScope.selectedRepoIds
    .map((repoId) => resolveRepoRootById(repoById, repoId, resolvedPackDir))
    .filter((root): root is string => Boolean(root));
  const repoRootsById = new Map<string, string>();
  for (const repoId of repoById.keys()) {
    const root = resolveRepoRootById(repoById, repoId, resolvedPackDir);
    if (root) {
      repoRootsById.set(repoId, root);
    }
  }
  return { visibleRepoRoots: dedupeRoots(visibleRepoRoots), declaredRepoRoots, repoRootsById };
}

function toStagingContextPackBinding(scope: PlannerChildTaskExecutionScope): PlannerStagingContextPackBinding {
  const selectedAuthorityIds = scope.selectedRepoIds.length > 0 ? scope.selectedRepoIds : scope.selectedFocusIds;
  const repositoryTypes = scope.deepFocusEnabled
    ? undefined
    : normalizeRepositoryTypesForSelection(scope.repositoryTypes, selectedAuthorityIds);
  const primaryRepoId = scope.deepFocusEnabled
    ? undefined
    : primaryIdFromRepositoryTypes(scope.selectedRepoIds, repositoryTypes);
  const primaryFocusId = scope.deepFocusEnabled
    ? undefined
    : primaryIdFromRepositoryTypes(scope.selectedFocusIds, repositoryTypes);
  return {
    contextPackDir: scope.contextPackDir,
    contextPackId: scope.contextPackId,
    scopeMode: scope.scopeMode,
    ...(primaryRepoId ? { primaryRepoId } : {}),
    ...(primaryFocusId ? { primaryFocusId } : {}),
    ...(scope.deepFocusPrimaryRepoId ? { deepFocusPrimaryRepoId: scope.deepFocusPrimaryRepoId } : {}),
    ...(scope.deepFocusPrimaryFocusId ? { deepFocusPrimaryFocusId: scope.deepFocusPrimaryFocusId } : {}),
    selectedRepoIds: [...scope.selectedRepoIds],
    selectedFocusIds: [...scope.selectedFocusIds],
    ...(repositoryTypes ? { repositoryTypes } : {}),
    deepFocusEnabled: scope.deepFocusEnabled,
    selectedFocusPath: scope.selectedFocusPath,
    selectedFocusTargetKind: scope.selectedFocusTargetKind,
    selectedFocusTargets: scope.selectedFocusTargets.map((target) => ({ ...target })),
    selectedTestTarget: scope.selectedTestTarget ? { ...scope.selectedTestTarget } : null,
    selectedSupportTargets: scope.selectedSupportTargets.map((target) => ({
      ...target,
      effectiveScope: 'full-directory' as const,
    })),
  };
}

function primaryIdFromRepositoryTypes(
  selectedIds: string[],
  repositoryTypes?: Record<string, 'primary' | 'support'>,
): string | undefined {
  return selectedIds.find((id) => repositoryTypes?.[id] === 'primary') ?? selectedIds[0];
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
  await cleanupActiveParentBranchViewSession();
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

async function cleanupActiveParentBranchViewSession(): Promise<void> {
  if (!activeParentBranchViewSession) {
    return;
  }
  const session = activeParentBranchViewSession;
  activeParentBranchViewSession = null;
  await cleanupParentBranchViewSession(session);
}

async function cleanupParentBranchViewSession(session: PlannerParentBranchViewSession): Promise<void> {
  try {
    await cleanupPlannerParentBranchViewSession(session);
  } catch (error: unknown) {
    log.warn('planner.parent-branch-view.cleanup.failed', {
      sessionId: session.plannerSessionId,
      parentTaskId: session.parentTaskId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
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
