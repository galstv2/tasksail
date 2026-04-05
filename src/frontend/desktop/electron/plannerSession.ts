import { BrowserWindow } from 'electron';

import { resolveFocusedRepoRoot, type FocusedRepoResult } from '../../../backend/platform/context-pack/focusedRepo.js';
import { DESKTOP_SHELL_PLANNER_EVENT_CHANNEL } from '../src/shared/desktopContract';
import { PLANNER_SAVE_DRAFT_WORKFLOW } from '../src/shared/plannerWorkflow';
import { REPO_ROOT } from './paths';
import {
  clearStagingArtifacts,
  initializeStagedPlanningDraft,
} from './main.staging';
import { getPlanningAgentAllowedRoots } from './plannerCopilotProcess';
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

export async function startSession(contextPackDir: string): Promise<{ sessionId: string; created: boolean }> {
  const focused = await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  const allowedRoots = dedupeRoots([...getPlanningAgentAllowedRoots(), ...(focused?.visibleRepoRoots ?? [])]);
  const workingDirectory = focused?.primaryRepoRoot ?? undefined;
  const result = broker.startSession({ contextPackDir, allowedRoots, workingDirectory });

  if (!result.created) {
    return result;
  }

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
  return broker.sendMessage(text);
}

export async function endSession(): Promise<void> {
  const sessionId = broker.getObservability().sessionId;
  broker.endSession();
  if (!sessionId) {
    return;
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
  'primaryRepoId' | 'primaryRepoRoot' | 'primaryFocusRelativePath' | 'selectedRepoIds' | 'selectedFocusIds'
> | undefined {
  if (!focused) {
    return undefined;
  }

  return {
    primaryRepoId: focused.primaryRepoId,
    primaryRepoRoot: focused.primaryRepoRoot,
    primaryFocusRelativePath: focused.primaryFocusRelativePath,
    selectedRepoIds: [...focused.selectedRepoIds],
    selectedFocusIds: [...focused.selectedFocusIds],
  };
}
