import { BrowserWindow } from 'electron';

import { resolveFocusedRepoRoot } from '../../../backend/platform/context-pack/focusedRepo.js';
import { DESKTOP_SHELL_PLANNER_EVENT_CHANNEL } from '../src/shared/desktopContract';
import { PLANNER_SAVE_DRAFT_WORKFLOW } from '../src/shared/plannerWorkflow';
import { REPO_ROOT } from './paths';
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

export async function startSession(contextPackDir?: string): Promise<{ sessionId: string; created: boolean }> {
  const focused = contextPackDir ? await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT) : undefined;
  const allowedRoots = [...getPlanningAgentAllowedRoots(), ...(focused?.visibleRepoRoots ?? [])];
  const workingDirectory = focused?.primaryRepoRoot ?? undefined;
  return broker.startSession({ contextPackDir, allowedRoots, workingDirectory });
}

export async function sendMessage(text: string): Promise<PlannerSendResult> {
  return broker.sendMessage(text);
}

export function endSession(): void {
  broker.endSession();
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
