import { BrowserWindow } from 'electron';

import {
  collectFocusedRepoTargetDirectoryRoots,
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
  type FocusedRepoResult,
} from '../../../backend/platform/context-pack/focusedRepo.js';
import { DESKTOP_SHELL_PLANNER_EVENT_CHANNEL } from '../src/shared/desktopContract';
import { PLANNER_SAVE_DRAFT_WORKFLOW, wrapFreshSessionMessage } from '../src/shared/plannerWorkflow';
import { REPO_ROOT } from './paths';
import {
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
} from './main.staging';
import { getPlanningAgentAllowedRoots } from './plannerCliProcess';
import { PlannerSessionBroker, type PlannerSendResult } from './plannerSessionBroker';

const broker = new PlannerSessionBroker({
  emitEvent: (plannerEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(DESKTOP_SHELL_PLANNER_EVENT_CHANNEL, plannerEvent);
      }
    }
  },
});

/** Tracks whether the first operator message has been sent in the current session. */
let firstMessageSent = false;

export async function startSession(contextPackDir: string): Promise<{ sessionId: string; created: boolean }> {
  const selectedFocused = await resolveSelectedPrimaryRepoRoot(contextPackDir, REPO_ROOT);
  const focused = selectedFocused?.deepFocusEnabled === true
    ? selectedFocused
    : await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  const allowedRoots = dedupeRoots([
    ...getPlanningAgentAllowedRoots(),
    ...(focused?.visibleRepoRoots ?? []),
    // Planner context roots include writable and read-only Deep Focus targets;
    // Dalton write authority is enforced separately from writableRoots.
    ...(focused?.deepFocusEnabled === true ? collectFocusedRepoTargetDirectoryRoots(focused) : []),
  ]);
  const result = broker.startSession({ contextPackDir, allowedRoots });

  if (!result.created) {
    return result;
  }

  firstMessageSent = false;

  try {
    await clearStagingArtifacts({ force: true });
    await initializeStagedPlanningDraft({
      sessionId: result.sessionId,
      contextPackDir,
      focusedRepo: toStagingFocusedRepo(focused),
    });
    return result;
  } catch (error: unknown) {
    broker.endSession();
    throw error;
  }
}

export async function sendMessage(text: string): Promise<PlannerSendResult> {
  let message = text;
  if (!firstMessageSent) {
    firstMessageSent = true;
    message = wrapFreshSessionMessage(text);
  }
  return broker.sendMessage(message);
}

export async function endSession(): Promise<{ ended: boolean }> {
  const sessionId = broker.getObservability().sessionId;
  broker.endSession();
  if (!sessionId) {
    return { ended: false };
  }

  try {
    await clearStagingArtifacts({ sessionId });
  } catch (error: unknown) {
    console.warn(
      error instanceof Error
        ? `Planner staging cleanup failed during session end: ${error.message}`
        : 'Planner staging cleanup failed during session end.',
    );
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
  | 'primaryRepoId'
  | 'primaryRepoRoot'
  | 'primaryFocusRelativePath'
  | 'deepFocusEnabled'
  | 'primaryFocusTargetKind'
  | 'selectedTestTarget'
  | 'supportTargets'
  | 'selectedRepoIds'
  | 'selectedFocusIds'
> | undefined {
  if (!focused) {
    return undefined;
  }

  return {
    primaryRepoId: focused.primaryRepoId,
    primaryRepoRoot: focused.primaryRepoRoot,
    primaryFocusRelativePath: focused.primaryFocusRelativePath,
    deepFocusEnabled: focused.deepFocusEnabled,
    primaryFocusTargetKind: focused.primaryFocusTargetKind,
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
