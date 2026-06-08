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
} from '../../../../backend/platform/context-pack/focusedRepo.js';
import type { GenericAgentEnv } from '../../../../backend/platform/cli-provider/types.js';
import {
  getActiveProvider,
  validateReasoningEffortForCapabilities,
  type ProviderReasoningEffortCapabilities,
} from '../../../../backend/platform/cli-provider/index.js';
import { getPlannerHistoryRecord } from '../../../../backend/platform/planner-history/store.js';
import type {
  PlannerStagingContextPackBinding,
  PlannerStagingSidecar,
} from '../../../../backend/platform/planner-history/types.js';
import { readTextFile, resolvePath, safeJsonParse } from '../../../../backend/platform/core/index.js';
import {
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
  type PlannerChildTaskLineage,
  type PlannerChildTaskExecutionScope,
  type PlannerFocusSnapshot,
  type PlannerPersonalityId,
  type PlannerPlanningReloadScope,
  type PlannerParentBranchViewRequest,
  type PlannerParentBranchViewStatus,
  type PlannerStartSessionDeepFocusSelection,
} from '../../src/shared/desktopContract';
import { normalizeRepositoryTypesForSelection } from '../../../../backend/platform/queue/repositoryTypes.js';
import { PLANNER_SAVE_DRAFT_WORKFLOW, wrapFreshSessionMessage } from '../../src/shared/plannerWorkflow';
import { readWorkspaceSyncStateSnapshot } from '../contextPack/catalog';
import { REPO_ROOT } from '../paths';
import { createLogger } from '../log/logger';
import {
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
} from './staging';
import {
  getPlanningAgentAllowedRoots,
  getPlanningAgentReasoningEffort,
  getPlanningAgentRequiredModel,
} from './cliProcess';
import { PlannerSessionBroker, type PlannerSendResult } from './sessionBroker';
import {
  appendPendingMessage,
  beginPendingRecord,
  discardPendingRecord,
} from './history';
import { assertPlannerHistoryRecordHydratable, childTaskHydrateMessage } from './recentChildTaskEligibility';
import {
  cleanupPlannerParentBranchViewSession,
  createPlannerParentBranchViewSession,
  type PlannerParentBranchViewSession,
} from './parentBranchView';
import {
  buildPlannerLaunchClassificationLogPayload,
} from './session.launchClassification';
import {
  applyPlannerLaunchAvailabilityNoteToFirstTurn,
  resolvePlannerLaunchExtensions,
} from './launchExtensions';

const log = createLogger('electron/plannerSession');

type ReasoningEffortCapabilityProvider = {
  reasoningEffortCapabilities?: (repoRoot: string) => Promise<ProviderReasoningEffortCapabilities>;
};

function providerProductDisplayName(cliDisplayName: string): string {
  return cliDisplayName.replace(/\s+CLI$/u, '') || cliDisplayName;
}

function providerAdvertisedReasoningEffortLabel(cliDisplayName: string): string {
  return `${providerProductDisplayName(cliDisplayName)}-advertised`;
}

async function validatePlanningAgentReasoningEffort(): Promise<string | undefined> {
  const reasoningEffort = getPlanningAgentReasoningEffort();
  if (!reasoningEffort) {
    return undefined;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(reasoningEffort)) {
    throw new Error(`Planner reasoning effort "${reasoningEffort}" must be lowercase letters, numbers, or hyphens.`);
  }
  const provider = getActiveProvider(REPO_ROOT);
  const cliDisplayName = provider.cliDisplayName();
  const capabilityProvider = provider as typeof provider & ReasoningEffortCapabilityProvider;
  const capabilities = await capabilityProvider.reasoningEffortCapabilities?.(REPO_ROOT);
  if (!capabilities) {
    log.warn('planner.reasoning_effort.rejected_before_session', {
      providerId: provider.id,
      effort: reasoningEffort,
      reason: 'capability-discovery-failed',
    });
    throw new Error(`Reasoning effort options could not be loaded from the installed ${cliDisplayName}. Update Agent Configuration to None or try again after capabilities are available.`);
  }
  const validation = validateReasoningEffortForCapabilities({
    providerId: provider.id,
    cliDisplayName,
    agentId: 'Planner',
    modelId: getPlanningAgentRequiredModel(),
    effort: reasoningEffort,
    capabilities,
  });
  if (!validation.ok) {
    const reason = validation.reason ?? 'capability-discovery-failed';
    log.warn('planner.reasoning_effort.rejected_before_session', {
      providerId: provider.id,
      effort: reasoningEffort,
      reason,
    });
    throw new Error(validation.reason === 'capability-discovery-failed'
      ? `Reasoning effort options could not be loaded from the installed ${cliDisplayName}. Update Agent Configuration to None or try again after capabilities are available.`
      : `Planner reasoning effort "${reasoningEffort}" is not advertised by the installed ${cliDisplayName}. Update Agent Configuration to None or a ${providerAdvertisedReasoningEffortLabel(cliDisplayName)} effort.`);
  }
  log.info('planner.reasoning_effort.validated', {
    providerId: provider.id,
    effort: reasoningEffort,
    capabilitySource: capabilities.source,
  });
  return reasoningEffort;
}

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
let activePlannerExtensionCleanup: (() => Promise<void>) | null = null;
let activePlannerAvailabilityNote: string | undefined;
let activePlannerTaskSubjectBoundaryNote: string | undefined;
let plannerSessionIdCounter = 0;

/**
 * Monotonic planner session ID: planner-<epochMs>-<pid>-<counter>. The counter guarantees
 * distinct IDs for two sessions created in the same millisecond, so test determinism comes from
 * mocked system time plus the counter without adding a startSession clock parameter.
 */
function nextPlannerSessionId(): string {
  return `planner-${Date.now()}-${process.pid}-${plannerSessionIdCounter++}`;
}

/**
 * First-turn transform shared by sendMessage and saveDraft. The single firstMessageSent flag is
 * read and set in exactly one place here, so the first turn is consumed once regardless of which
 * path fires first: it prepends the availability note (when present) and applies the fresh-session
 * wrap; every later turn is returned unmodified.
 */
function applyFirstTurnTransform(rawText: string): string {
  if (firstMessageSent) {
    return rawText;
  }
  firstMessageSent = true;
  const firstTurnNote = [
    activePlannerTaskSubjectBoundaryNote,
    activePlannerAvailabilityNote,
  ].filter((note): note is string => Boolean(note)).join('\n\n') || undefined;
  return applyPlannerLaunchAvailabilityNoteToFirstTurn({
    guideText: rawText,
    availabilityNote: firstTurnNote,
    wrapFreshSession: wrapFreshSessionMessage,
  });
}

export async function startSession(
  contextPackDir: string,
  uiSelection?: PlannerStartSessionDeepFocusSelection,
  replayConversationId?: string,
  childTaskFocusSnapshot?: PlannerFocusSnapshot,
  childTaskLineage?: PlannerChildTaskLineage,
  childTaskExecutionScope?: PlannerChildTaskExecutionScope,
  plannerPlanningReloadScope?: PlannerPlanningReloadScope,
  parentTaskBranchView?: PlannerParentBranchViewRequest,
  plannerPersonalityId?: PlannerPersonalityId,
): Promise<{ sessionId: string; created: boolean; parentBranchViewStatus?: PlannerParentBranchViewStatus }> {
  const observability = broker.getObservability();
  if (broker.isSessionActive() && observability.brokerStatus !== 'failed') {
    return broker.startSession();
  }
  if (broker.isSessionActive()) {
    // A failed broker session is not reusable. Tear it down, discard pending state,
    // and clean the failed session's stale extension/parent-branch-view handles here:
    // reasoning-effort validation below can throw, so deferring cleanup until later would
    // orphan the prior session's stage and worktrees on a validation failure.
    broker.endSession();
    discardPendingRecord();
    await cleanupActivePlannerExtensionStage();
    await cleanupActiveParentBranchViewSession();
  }
  const reasoningEffort = await validatePlanningAgentReasoningEffort();
  // Clean any stale planner extension stage and parent branch view before new-session setup.
  await cleanupActivePlannerExtensionStage();
  await cleanupActiveParentBranchViewSession();
  if (childTaskLineage && !childTaskFocusSnapshot) {
    throw new Error('Child-task planner sessions require a focus snapshot.');
  }
  if (plannerPlanningReloadScope && !childTaskExecutionScope) {
    throw new Error('Planner Planning Reload Scope requires Child Execution Scope authority.');
  }
  if (plannerPlanningReloadScope && childTaskFocusSnapshot && (
    plannerPlanningReloadScope.contextPackDir !== childTaskFocusSnapshot.contextPackDir
    || plannerPlanningReloadScope.contextPackId !== childTaskFocusSnapshot.contextPackId
  )) {
    throw new Error('Planner Planning Reload Scope must match the selected parent context pack.');
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
    : plannerPlanningReloadScope
      ? await buildFocusedRepoFromPlannerPlanningReloadScope(effectiveContextPackDir, plannerPlanningReloadScope, childTaskFocusSnapshot)
    : childTaskFocusSnapshot
      ? buildFocusedRepoFromSnapshot(childTaskFocusSnapshot)
      : uiSelection?.deepFocusEnabled === true
      ? await buildFocusedRepoFromUiSelection(contextPackDir, uiSelection)
      : await resolveSelectedPrimaryRepoRoot(contextPackDir, REPO_ROOT)
        ?? await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  const plannerSessionId = nextPlannerSessionId();
  const resolvedPlanner = await resolvePlannerLaunchExtensions({
    repoRoot: REPO_ROOT,
    plannerSessionId,
    providerId: getActiveProvider(REPO_ROOT).id,
  });
  let runtimeFocused = unrewrittenFocused;
  let parentBranchViewStatus: PlannerParentBranchViewStatus | undefined;
  let parentBranchViewSession: PlannerParentBranchViewSession | undefined;
  if (parentTaskBranchView && childTaskFocusSnapshot && childTaskLineage) {
    try {
      const parentBranchView = await createPlannerParentBranchViewSession({
        plannerSessionId,
        focused: unrewrittenFocused,
        request: parentTaskBranchView,
      });
      runtimeFocused = parentBranchView.focused;
      parentBranchViewStatus = parentBranchView.status;
      parentBranchViewSession = parentBranchView.session;
    } catch (error: unknown) {
      // Parent branch view creation failed after staging: clean the stage before throwing.
      await resolvedPlanner.cleanup();
      throw error;
    }
  }
  const platformAllowlist = getPlanningAgentAllowedRoots();
  const allowedRoots = dedupeRoots([
    ...platformAllowlist,
    ...(runtimeFocused?.visibleRepoRoots ?? []),
    // Planner context roots include writable and read-only Deep Focus targets;
    // implementation write authority is enforced separately from writableRoots.
    ...(runtimeFocused?.deepFocusEnabled === true ? collectFocusedRepoTargetDirectoryRoots(runtimeFocused) : []),
  ]);
  const focusEnv = runtimeFocused ? toFocusEnv(runtimeFocused, effectiveContextPackDir) : undefined;
  log.info('planner.session.launch.allowedRoots.classification', buildPlannerLaunchClassificationLogPayload({
    sessionId: plannerSessionId,
    contextPackDir: effectiveContextPackDir,
    allowedRoots,
    platformAllowlist,
    parentBranchViewStatus,
    parentBranchViewBindings: parentBranchViewSession?.manifest.bindings,
    childTaskLineage,
    childTaskFocusSnapshot,
  }));
  // A parent branch view session created above must be cleaned up if
  // broker.startSession throws or reuses an existing session (created false),
  // otherwise its worktrees would be orphaned. Only adopt it as the active
  // session once the broker confirms a newly created session.
  let result: ReturnType<typeof broker.startSession>;
  try {
    result = broker.startSession({
      sessionId: plannerSessionId,
      contextPackDir: effectiveContextPackDir,
      allowedRoots,
      focusEnv,
      reasoningEffort,
      plannerPersonalityId: plannerPersonalityId ?? 'balanced',
      launchExtensions: resolvedPlanner.launchExtensions,
    });
  } catch (error: unknown) {
    if (parentBranchViewSession) {
      await cleanupParentBranchViewSession(parentBranchViewSession);
    }
    await resolvedPlanner.cleanup();
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
    await resolvedPlanner.cleanup();
    return result;
  }
  activeParentBranchViewSession = parentBranchViewSession ?? null;
  activePlannerExtensionCleanup = resolvedPlanner.cleanup;
  activePlannerAvailabilityNote = resolvedPlanner.availabilityNote;
  activePlannerTaskSubjectBoundaryNote = buildPlannerTaskSubjectBoundaryNote(
    effectiveContextPackDir,
    runtimeFocused,
  );

  firstMessageSent = false;

  try {
    await clearStagingArtifacts({ force: true });
    const sidecarSnapshot = await initializeStagedPlanningDraft({
      sessionId: result.sessionId,
      contextPackDir: effectiveContextPackDir,
      focusedRepo: toStagingFocusedRepo(unrewrittenFocused),
      // Replaying a recent task always starts a fresh standalone STANDARD task:
      // the source lineage (including any child-task parent linkage) is dropped
      // so the replay is a disjointed copy with zero effect on the source task's
      // chain. Omitting lineage makes staging default to taskKind 'standard'.
      ...(replayRecord ? {
        title: replayRecord.sidecarSnapshot.title,
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
    await cleanupActivePlannerExtensionStage();
    log.warn('planner.session.start.cleanup.failed', {
      contextPackDir: effectiveContextPackDir,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function updateSessionPersonality(
  plannerPersonalityId: PlannerPersonalityId,
): Promise<{
  action: 'planner.updateSessionPersonality';
  mode: 'updated';
  accepted: true;
  message: string;
  plannerPersonalityId: PlannerPersonalityId;
}> {
  const result = broker.updateSessionPersonality(plannerPersonalityId);
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
    plannerPersonalityId,
  };
}

async function buildFocusedRepoFromPlannerPlanningReloadScope(
  contextPackDir: string,
  reloadScope: PlannerPlanningReloadScope,
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
  reloadScope: PlannerPlanningReloadScope,
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
  const message = applyFirstTurnTransform(text);
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
  await cleanupActivePlannerExtensionStage();
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

async function cleanupActivePlannerExtensionStage(): Promise<void> {
  activePlannerAvailabilityNote = undefined;
  activePlannerTaskSubjectBoundaryNote = undefined;
  if (!activePlannerExtensionCleanup) {
    return;
  }
  const cleanup = activePlannerExtensionCleanup;
  activePlannerExtensionCleanup = null;
  // The resolver's cleanup handle logs cleanup.completed/failed and never throws,
  // so existing staging cleanup continues even when stage removal fails.
  await cleanup();
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
  return broker.saveDraft(applyFirstTurnTransform(PLANNER_SAVE_DRAFT_WORKFLOW.prompt));
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

function buildPlannerTaskSubjectBoundaryNote(
  contextPackDir: string,
  focused?: FocusedRepoResult,
): string {
  const lines = [
    '--- ACTIVE PLANNER TASK SUBJECT BOUNDARY ---',
    'TaskSail is workflow protocol only for this planner session. The task subject is the active context pack below.',
    `Active context pack ID: ${path.basename(contextPackDir)}`,
    `Active context pack dir: ${contextPackDir}`,
  ];

  if (!focused) {
    lines.push(
      'Resolved target repo roots: none',
      'Selected repo IDs: none',
      'Selected focus IDs: none',
      'If the Guide asks broadly what to work on next, ask which area of this context pack to continue instead of proposing TaskSail platform work.',
      'Do not recommend, plan, or draft TaskSail platform, queue, staging, prompt, or workflow-infrastructure work unless the Guide explicitly asks for TaskSail platform changes.',
      '--- END ACTIVE PLANNER TASK SUBJECT BOUNDARY ---',
    );
    return lines.join('\n');
  }

  lines.push(
    ...formatPlannerBoundaryRows('Target repo roots', focused.visibleRepoRoots),
    `Primary repo ID: ${focused.primaryRepoId || 'none'}`,
    `Primary repo root: ${focused.primaryRepoRoot || 'none'}`,
    `Selected repo IDs: ${formatPlannerBoundaryList(focused.selectedRepoIds)}`,
    `Selected focus IDs: ${formatPlannerBoundaryList(focused.selectedFocusIds)}`,
  );
  if (focused.primaryFocusId) {
    lines.push(`Primary focus ID: ${focused.primaryFocusId}`);
  }
  if (focused.primaryFocusRelativePath !== undefined) {
    lines.push(`Primary focus path: ${focused.primaryFocusRelativePath || '.'}`);
  }
  if (focused.primaryFocusTargetKind) {
    lines.push(`Primary focus target kind: ${focused.primaryFocusTargetKind}`);
  }
  if (focused.deepFocusEnabled !== undefined) {
    lines.push(`Deep Focus enabled: ${focused.deepFocusEnabled ? 'true' : 'false'}`);
  }
  if (focused.primaryFocusTargets?.length) {
    lines.push(...formatPlannerBoundaryRows(
      'Deep Focus primary targets',
      focused.primaryFocusTargets.map((target) => `${target.kind}:${target.path || '.'}`),
    ));
  }
  if (focused.writableRoots?.length) {
    lines.push(...formatPlannerBoundaryRows(
      'Writable roots',
      focused.writableRoots.map((root) => `${root.kind}:${root.path || '.'}`),
    ));
  }
  if (focused.readonlyContextRoots?.length) {
    lines.push(...formatPlannerBoundaryRows(
      'Read-only context roots',
      focused.readonlyContextRoots.map((root) => `${root.kind}:${root.path || '.'}`),
    ));
  }

  lines.push(
    'For broad "what should I work on next?" requests, inspect and recommend only within these context-pack roots and selected focus areas.',
    'If this context is too thin for a concrete recommendation, ask a context-pack scoping question instead of proposing TaskSail platform work.',
    'Do not recommend, plan, or draft TaskSail platform, queue, staging, prompt, or workflow-infrastructure work unless the Guide explicitly asks for TaskSail platform changes.',
    '--- END ACTIVE PLANNER TASK SUBJECT BOUNDARY ---',
  );
  return lines.join('\n');
}

function formatPlannerBoundaryList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function formatPlannerBoundaryRows(label: string, values: readonly string[]): string[] {
  return values.length > 0
    ? [`${label}:`, ...values.map((value) => `- ${value}`)]
    : [`${label}: none`];
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
