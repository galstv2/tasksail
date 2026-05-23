import { basename } from 'node:path';

import {
  type DesktopActionRequest,
  type DesktopInvokeResult,
} from '../src/shared/desktopContract';
import { isValidDesktopActionRequest, validateDesktopActionRequest } from '../src/shared/desktopContractValidators';
import * as plannerSession from './plannerSession';
import {
  PLANNER_FOCUS_FALLBACK_MESSAGE,
  PLANNER_FOCUS_VALID_MESSAGE,
} from './plannerFocusValidation';
import { commitPendingRecordToHistory } from './plannerHistory';
import { REPO_ROOT } from './paths';
import {
  canonicalizeEditableDraftRequirements,
  parseMarkdownSections,
  parsePlannerEditableDraft,
  validatePlannerProtectedMetadata,
  validatePlanningIntakeDraft,
} from './main.markdown';
import { resolvePlannerTaskTitleFromDraft } from './main.plannerTitle';
import {
  startBackendServices,
  stopBackendServices,
  checkBackendHealth,
  readBackendServiceStatus,
} from './main.services';
import { readOwnedStagedDraft, readPlannerStagingSidecar, readStagedDraft } from './main.staging';
import { createLogger } from './log/logger';
import {
  emitStreamEvent,
  withStreamEvent,
} from './main.stream';
import { refreshCurrentActiveContextPackTaskScope } from './main.contextPackTaskVisibility';
import { refreshTerminalScopeCaches } from './main.terminalScopeRefresh';
import {
  createDefaultDesktopActionHandlers,
  type DesktopActionHandlers,
} from './main.desktopActionHandlers';
import { createDropboxTask } from '../../../backend/platform/queue/createDropboxTask.js';
import { createFollowupTask } from '../../../backend/platform/queue/createFollowupTask.js';
import { resolveChildTaskChainCreationContext } from './main.childTaskChain';

const log = createLogger('electron/main');

export type DesktopActionContext = {
  webContentsId?: number;
};

function resolveDesktopActionHandlers(
  handlers?: Partial<DesktopActionHandlers>,
): DesktopActionHandlers {
  return {
    ...createDefaultDesktopActionHandlers(),
    ...handlers,
  };
}

export class DesktopActionRouter {
  constructor(private readonly handlers?: Partial<DesktopActionHandlers>) {}

  handle(
    request: DesktopActionRequest | unknown,
    context?: DesktopActionContext,
  ): Promise<DesktopInvokeResult> {
    return handleDesktopAction(request, this.handlers, context);
  }
}

export async function handleDesktopAction(
  request: DesktopActionRequest | unknown,
  handlers?: Partial<DesktopActionHandlers>,
  context?: DesktopActionContext,
): Promise<DesktopInvokeResult> {
  const resolvedHandlers = resolveDesktopActionHandlers(handlers);
  const requestErrors = validateDesktopActionRequest(request);
  if (requestErrors.length > 0 || !isValidDesktopActionRequest(request)) {
    return {
      ok: false,
      action:
        typeof request === 'object' && request !== null && 'action' in request
          ? String((request as { action?: unknown }).action ?? '')
          : undefined,
      error: 'Desktop action request failed runtime validation.',
      details: requestErrors,
    };
  }

  switch (request.action) {
    case 'planner.submitDraft':
      if (request.payload.stage === 'confirm') {
        return resolvedHandlers.submitDraft(request.payload.draft);
      }

      return {
        ok: true,
        response: {
          action: 'planner.submitDraft',
          mode: 'dry-run',
          accepted: true,
          message:
            'Planner draft accepted for local review only. No dropbox file or helper script was invoked.',
          suggestedPath: request.payload.draft.suggestedPath,
        },
      };
    case 'planner.startSession': {
      const { sessionId, parentBranchViewStatus } = await resolvedHandlers.startPlannerSession(request.payload);
      emitStreamEvent({ message: 'Planner session started.', source: 'planner.startSession', role: 'planner' });
      return {
        ok: true,
        response: {
          action: 'planner.startSession',
          mode: 'started',
          accepted: true,
          message: 'Planner session started.',
          sessionId,
          brokerStatus: resolvedHandlers.getPlannerSessionState()?.brokerStatus ?? 'idle',
          ...(parentBranchViewStatus ? { parentBranchViewStatus } : {}),
        },
      };
    }
    case 'planner.validateChildTaskFocus': {
      try {
        const issues = await resolvedHandlers.validateChildTaskFocus(request.payload);
        return {
          ok: true,
          response: {
            action: 'planner.validateChildTaskFocus',
            mode: issues.length === 0 ? 'valid' : 'fallback',
            message: issues.length === 0 ? PLANNER_FOCUS_VALID_MESSAGE : PLANNER_FOCUS_FALLBACK_MESSAGE,
            issues,
          },
        };
      } catch (error) {
        return {
          ok: false,
          action: 'planner.validateChildTaskFocus',
          error: error instanceof Error ? error.message : 'Validation failed.',
        };
      }
    }
    case 'planner.sendMessage': {
      const sendResult = await resolvedHandlers.sendPlannerMessage(
        request.payload.text,
        request.payload.displayText,
      );
      if (sendResult === 'no-session') {
        return {
          ok: false,
          action: 'planner.sendMessage',
          error: 'No active planner session to send message to.',
        };
      }
      if (sendResult === 'busy') {
        return {
          ok: false,
          action: 'planner.sendMessage',
          error: 'Planner session is already running a turn.',
        };
      }
      return {
        ok: true,
        response: {
          action: 'planner.sendMessage',
          mode: 'sent',
          accepted: true,
          message: 'Message sent to planner session.',
        },
      };
    }
    case 'planner.endSession': {
      const endResult = await resolvedHandlers.endPlannerSession();
      if (endResult.ended) {
        emitStreamEvent({ message: 'Planner session ended.', source: 'planner.endSession', role: 'planner' });
      }
      return {
        ok: true,
        response: {
          action: 'planner.endSession',
          mode: 'ended',
          accepted: true,
          message: endResult.ended ? 'Planner session ended.' : 'No active planner session to end.',
        },
      };
    }
    case 'planner.saveDraft': {
      const saveResult = await resolvedHandlers.savePlannerDraft();
      const brokerState = resolvedHandlers.getPlannerSessionState();
      if (saveResult === 'no-session') {
        return {
          ok: false,
          action: 'planner.saveDraft',
          error: 'No active planner session to instruct.',
        };
      }
      if (saveResult === 'busy') {
        return {
          ok: false,
          action: 'planner.saveDraft',
          error: 'Planner session is already running a turn.',
        };
      }
      if (brokerState?.brokerStatus === 'failed') {
        return {
          ok: false,
          action: 'planner.saveDraft',
          error: brokerState.error ?? 'Planner failed while saving the staged draft.',
        };
      }
      return {
        ok: true,
        response: {
          action: 'planner.saveDraft',
          mode: 'instructed',
          accepted: true,
          message: 'Save-draft instruction sent to planner session.',
          brokerStatus: brokerState?.brokerStatus ?? 'idle',
        },
      };
    }
    case 'planner.readStagedDraft': {
      const brokerState = resolvedHandlers.getPlannerSessionState();
      const brokerStatus = brokerState?.brokerStatus ?? 'idle';
      const activePlannerSessionId = plannerSession.getObservability().sessionId;
      const stagedDraft = await readStagedDraft(activePlannerSessionId ?? undefined);
      if (stagedDraft.error) {
        return {
          ok: false,
          action: 'planner.readStagedDraft',
          error: stagedDraft.error,
        };
      }
      if (brokerStatus === 'failed') {
        return {
          ok: false,
          action: 'planner.readStagedDraft',
          error: brokerState?.error ?? 'Planner failed before writing a staged draft.',
        };
      }
      if (!stagedDraft.draft) {
        if (brokerStatus === 'completed') {
          return {
            ok: false,
            action: 'planner.readStagedDraft',
            error: 'Planner completed without writing a staged draft to AgentWorkSpace/dropbox/.staging.',
          };
        }

        return {
          ok: true,
          response: {
            action: 'planner.readStagedDraft',
            mode: 'empty',
            message: 'No staged draft found in .staging/ directory.',
            draft: null,
            brokerStatus,
          },
        };
      }
      return {
        ok: true,
        response: {
          action: 'planner.readStagedDraft',
          mode: 'found',
          message: `Staged draft found: ${stagedDraft.draft.filename}`,
          draft: stagedDraft.draft,
          brokerStatus,
        },
      };
    }
    case 'planner.finalizeSpec': {
      const brokerState = resolvedHandlers.getPlannerSessionState();
      if (brokerState?.brokerStatus === 'running') {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: 'Planner session is still running a turn. Wait for draft generation to finish before finalizing.',
        };
      }
      const activePlannerSessionId = plannerSession.getObservability().sessionId;
      const stagedDraft = await readOwnedStagedDraft(activePlannerSessionId ?? undefined);
      if (stagedDraft.error) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: stagedDraft.error,
        };
      }
      if (!stagedDraft.draft) {
        if (brokerState?.brokerStatus === 'failed') {
          return {
            ok: false,
            action: 'planner.finalizeSpec',
            error: brokerState.error ?? 'Planner session failed before writing a staged draft. Reconnect or retry before finalizing.',
          };
        }
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: 'No staged draft to finalize. Use "View Draft" first.',
        };
      }
      if (!stagedDraft.metadata) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: 'No platform-owned staged planner metadata is available. Start a new planner session before finalizing.',
        };
      }
      const expectedTaskKind = (
        typeof request.payload === 'object' &&
        request.payload !== null &&
        'expectedTaskKind' in request.payload
      )
        ? (request.payload as { expectedTaskKind?: 'standard' | 'child-task' }).expectedTaskKind
        : undefined;
      const sections = parseMarkdownSections(stagedDraft.draft.content);
      const protectedMetadataError = validatePlannerProtectedMetadata(
        stagedDraft.draft.content,
        stagedDraft.metadata,
        expectedTaskKind,
        sections,
      );
      if (protectedMetadataError) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: protectedMetadataError,
        };
      }
      const validationError = validatePlanningIntakeDraft(
        stagedDraft.draft.content,
        stagedDraft.metadata.lineage.taskKind,
        sections,
      );
      if (validationError) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: validationError,
        };
      }
      try {
        const editableDraft = parsePlannerEditableDraft(stagedDraft.draft.content, sections);
        const canonicalDraft = canonicalizeEditableDraftRequirements(editableDraft);
        const metadata = stagedDraft.metadata;
        const taskTitle = resolvePlannerTaskTitleFromDraft(stagedDraft.draft.content);
        let chainContext;
        if (metadata.lineage.taskKind === 'child-task') {
          chainContext = await resolveChildTaskChainCreationContext({
            repoRoot: REPO_ROOT,
            listContextPacks: resolvedHandlers.listContextPacks,
            parentTaskId: metadata.lineage.parentTaskId,
            requestedRootTaskId: metadata.lineage.rootTaskId,
            childExecutionScope: metadata.contextPackBinding,
          });
        }
        const destinationPath = metadata.lineage.taskKind === 'child-task'
          ? await createFollowupTask({
              title: taskTitle,
              summary: canonicalDraft.summary,
              desiredOutcome: canonicalDraft.desiredOutcome,
              constraints: canonicalDraft.constraints,
              criticalRequirements: canonicalDraft.criticalRequirements,
              compatibilityRequirements: canonicalDraft.compatibilityRequirements,
              requiredValidation: canonicalDraft.requiredValidation,
              acceptanceSignals: canonicalDraft.acceptanceSignals,
              parentTaskId: metadata.lineage.parentTaskId,
              parentQmdRecordId: metadata.lineage.parentQmdRecordId,
              parentQmdScope: metadata.lineage.parentQmdScope,
              rootTaskId: metadata.lineage.rootTaskId,
              followupReason: metadata.lineage.followUpReason,
              carryForwardSummary: canonicalDraft.carryForwardSummary,
              suggestedPath: canonicalDraft.suggestedPath,
              planningNotes: canonicalDraft.planningNotes,
              contextPackDir: metadata.contextPackBinding.contextPackDir,
              contextPackId: metadata.contextPackBinding.contextPackId,
              scopeMode: metadata.contextPackBinding.scopeMode,
              primaryRepoId: metadata.contextPackBinding.primaryRepoId,
              primaryFocusId: metadata.contextPackBinding.primaryFocusId,
              selectedRepoIds: metadata.contextPackBinding.selectedRepoIds,
              selectedFocusIds: metadata.contextPackBinding.selectedFocusIds,
              repositoryTypes: metadata.contextPackBinding.repositoryTypes,
              deepFocusEnabled: metadata.contextPackBinding.deepFocusEnabled,
              selectedFocusPath: metadata.contextPackBinding.selectedFocusPath,
              selectedFocusTargetKind: metadata.contextPackBinding.selectedFocusTargetKind,
              selectedFocusTargets: metadata.contextPackBinding.selectedFocusTargets,
              selectedTestTarget: metadata.contextPackBinding.selectedTestTarget,
              selectedSupportTargets: metadata.contextPackBinding.selectedSupportTargets,
              deepFocusPrimaryRepoId: metadata.contextPackBinding.deepFocusPrimaryRepoId,
              deepFocusPrimaryFocusId: metadata.contextPackBinding.deepFocusPrimaryFocusId,
              branchChain: chainContext?.branchChain,
              parentContextSnapshot: chainContext?.parentContextSnapshot,
              childExecutionScope: chainContext?.childExecutionScope,
              parentArchivePath: chainContext?.parentArchivePath,
              parentArchiveArtifactDir: chainContext?.parentArchiveArtifactDir,
              previousTaskId: chainContext?.previousTaskId,
              repoRoot: REPO_ROOT,
            })
          : await createDropboxTask({
              title: taskTitle,
              summary: canonicalDraft.summary,
              desiredOutcome: canonicalDraft.desiredOutcome,
              constraints: canonicalDraft.constraints,
              criticalRequirements: canonicalDraft.criticalRequirements,
              compatibilityRequirements: canonicalDraft.compatibilityRequirements,
              requiredValidation: canonicalDraft.requiredValidation,
              acceptanceSignals: canonicalDraft.acceptanceSignals,
              suggestedPath: canonicalDraft.suggestedPath,
              planningNotes: canonicalDraft.planningNotes,
              kind: metadata.lineage.taskKind,
              contextPackDir: metadata.contextPackBinding.contextPackDir,
              contextPackId: metadata.contextPackBinding.contextPackId,
              scopeMode: metadata.contextPackBinding.scopeMode,
              primaryRepoId: metadata.contextPackBinding.primaryRepoId,
              primaryFocusId: metadata.contextPackBinding.primaryFocusId,
              selectedRepoIds: metadata.contextPackBinding.selectedRepoIds,
              selectedFocusIds: metadata.contextPackBinding.selectedFocusIds,
              repositoryTypes: metadata.contextPackBinding.repositoryTypes,
              deepFocusEnabled: metadata.contextPackBinding.deepFocusEnabled,
              selectedFocusPath: metadata.contextPackBinding.selectedFocusPath,
              selectedFocusTargetKind: metadata.contextPackBinding.selectedFocusTargetKind,
              selectedFocusTargets: metadata.contextPackBinding.selectedFocusTargets,
              selectedTestTarget: metadata.contextPackBinding.selectedTestTarget,
              selectedSupportTargets: metadata.contextPackBinding.selectedSupportTargets,
              repoRoot: REPO_ROOT,
            });

        try {
          await commitPendingRecordToHistory(destinationPath);
        } catch (historyError: unknown) {
          log.error('planner.finalize.history.upsert.failed', historyError);
        }

        try {
          await resolvedHandlers.endPlannerSession();
        } catch (endSessionError: unknown) {
          log.warn('planner.finalize.session-shutdown.failed', {
            reason: endSessionError instanceof Error ? endSessionError.message : String(endSessionError),
          });
        }
        emitStreamEvent({ message: `Spec finalized to dropbox: ${basename(destinationPath)}`, source: 'planner.finalizeSpec', role: 'planner', severity: 'success' });
        return {
          ok: true,
          response: {
            action: 'planner.finalizeSpec',
            mode: 'finalized',
            accepted: true,
            message: `Spec finalized to dropbox: ${basename(destinationPath)}`,
            destinationPath,
            brokerStatus: 'idle',
          },
        };
      } catch (err: unknown) {
        return {
          ok: false,
          action: 'planner.finalizeSpec',
          error: err instanceof Error ? err.message : 'Failed to finalize the staged planner draft.',
        };
      }
    }
    case 'queue.readStatus':
      return { ok: true, response: await resolvedHandlers.readQueueStatus() };
    case 'queue.deletePendingItem':
      return withStreamEvent(resolvedHandlers.deletePendingItem(request.payload),
        { message: `Deleted pending item ${request.payload.queueName}.`, source: 'queue.deletePendingItem', role: 'queue' });
    case 'environment.readStatus':
      return { ok: true, response: await resolvedHandlers.readEnvironmentStatus() };
    case 'observability.readSnapshot':
      return { ok: true, response: await resolvedHandlers.readObservability() };
    case 'contextPack.pickDirectory':
      return resolvedHandlers.pickContextPackDirectory(request.payload);
    case 'contextPack.discoverPrefill':
      return resolvedHandlers.discoverContextPackPrefill(request.payload);
    case 'contextPack.create':
      return withStreamEvent(resolvedHandlers.createContextPack(request.payload),
        { message: 'Created context pack.', source: 'contextPack.create', role: 'workflow', severity: 'success' });
    case 'contextPack.list':
      return { ok: true, response: await resolvedHandlers.listContextPacks() };
    case 'contextPack.listRepoTree':
      return resolvedHandlers.listRepoTree(request.payload);
    case 'contextPack.reseed':
      return withStreamEvent(resolvedHandlers.reseedContextPack(request.payload),
        { message: 'Reseeded context pack.', source: 'contextPack.reseed', role: 'workflow' });
    case 'followup.begin':
      if (request.payload.stage === 'confirm') {
        return resolvedHandlers.submitFollowUp(request.payload.draft);
      }

      return {
        ok: true,
        response: {
          action: 'followup.begin',
          mode: 'dry-run',
          accepted: true,
          message:
            'Follow-up draft staged locally only. No child task has been created and the closed parent task remains unchanged.',
          suggestedTaskKind: 'child-task',
          sourceTaskId: request.payload.draft.parentTaskId,
          parentTaskId: request.payload.draft.parentTaskId,
          rootTaskId:
            request.payload.draft.rootTaskId ||
            request.payload.draft.parentTaskId,
          reopenedTask: false,
        },
      };
    case 'contextPack.previewSwitch':
      return resolvedHandlers.previewContextPackSwitch(request.payload);
    case 'contextPack.applySwitch': {
      const result = await resolvedHandlers.applyContextPackSwitch(request.payload);
      if (result.ok) {
        await refreshCurrentActiveContextPackTaskScope(resolvedHandlers.listContextPacks);
        await refreshTerminalScopeCaches();
        emitStreamEvent({
          message: 'Applied workspace switch.',
          source: 'contextPack.applySwitch',
          role: 'workflow',
        });
      }
      return result;
    }
    case 'contextPack.clearActive': {
      const result = await resolvedHandlers.clearActiveContextPack();
      if (result.ok) {
        await refreshCurrentActiveContextPackTaskScope(resolvedHandlers.listContextPacks);
        await refreshTerminalScopeCaches();
        emitStreamEvent({
          message: 'Cleared active context pack.',
          source: 'contextPack.clearActive',
          role: 'workflow',
        });
      }
      return result;
    }
    case 'contextPack.delete':
      return resolvedHandlers.deleteContextPack(request.payload);
    case 'planner.pickMarkdownFile':
      return resolvedHandlers.pickMarkdownFile();
    case 'planner.listArchivedTasks':
      return resolvedHandlers.listArchivedTasks();
    case 'planner.readParentContextBundle':
      return resolvedHandlers.readParentContextBundle(request.payload);
    case 'planner.readParentChainArchiveBundle':
      return resolvedHandlers.readParentChainArchiveBundle(request.payload);
    case 'planner.readParentArchiveMarkdown':
      return resolvedHandlers.readParentArchiveMarkdown(request.payload);
    case 'planner.listConversationHistory':
      return resolvedHandlers.listConversationHistory();
    case 'planner.hydrateConversation':
      return resolvedHandlers.hydrateConversation(request.payload.recordId);
    case 'reinforcement.submitFeedback':
      return withStreamEvent(resolvedHandlers.submitReinforcementFeedback(request.payload),
        { message: 'Feedback submitted.', source: 'reinforcement.submitFeedback', role: 'system' });
    case 'reinforcement.updateRealignmentDoc':
      return resolvedHandlers.updateRealignmentDoc(request.payload);
    case 'reinforcement.readOverview':
      return resolvedHandlers.readReinforcementOverview();
    case 'reinforcement.listTasks':
      return resolvedHandlers.listReinforcementTasks(request.payload);
    case 'reinforcement.readAgentRewards':
      return resolvedHandlers.readAgentRewards();
    case 'reinforcement.listRealignmentSessions':
      return resolvedHandlers.listRealignmentSessions();
    case 'reinforcement.readRealignmentDoc':
      return resolvedHandlers.readRealignmentDoc();
    case 'reinforcement.checkActiveWorkGuard':
      return resolvedHandlers.checkActiveWorkGuard();
    case 'reinforcement.startRealignment':
      return withStreamEvent(resolvedHandlers.startRealignment(request.payload),
        { message: 'Corrective realignment started.', source: 'reinforcement.startRealignment', role: 'system', severity: 'warning' });
    case 'reinforcement.runRealignmentAnalysis':
      return resolvedHandlers.runRealignmentAnalysis(request.payload);
    case 'reinforcement.dismissRealignment':
      return resolvedHandlers.dismissRealignment(request.payload);
    case 'contextPack.activate':
      return withStreamEvent(resolvedHandlers.activateContextPack(request.payload),
        { message: 'Activated context pack.', source: 'contextPack.activate', role: 'workflow' });
    case 'contextPack.setRepositoryType':
      return resolvedHandlers.setRepositoryType(request.payload);
    case 'contextPack.setRepoCategory':
      return resolvedHandlers.setRepoCategory(request.payload);
    case 'externalMcp.list':
      return resolvedHandlers.listExternalMcpServers();
    case 'externalMcp.add':
      return resolvedHandlers.addExternalMcpServer(request.payload);
    case 'externalMcp.update':
      return resolvedHandlers.updateExternalMcpServer(request.payload);
    case 'externalMcp.remove':
      return resolvedHandlers.removeExternalMcpServer(request.payload);
    case 'externalMcp.toggleEnabled':
      return resolvedHandlers.toggleExternalMcpServer(request.payload);
    case 'externalMcp.validateConnection':
      return resolvedHandlers.validateExternalMcpConnection(request.payload);
    case 'agentConfig.loadAgents':
      return resolvedHandlers.loadAgentConfigAgents();
    case 'agentConfig.loadModelCatalog':
      return resolvedHandlers.loadAgentModelCatalog();
    case 'agentConfig.saveAgentModels':
      return resolvedHandlers.saveAgentModels(request.payload);
    case 'agentConfig.addModel':
      return resolvedHandlers.addAgentModel(request.payload);
    case 'agentConfig.removeModel':
      return resolvedHandlers.removeAgentModel(request.payload);
    case 'agentInstructions.listFiles':
      return resolvedHandlers.listInstructionFiles(request);
    case 'agentInstructions.readFile':
      return resolvedHandlers.readInstructionFile(request);
    case 'agentInstructions.writeFile':
      return resolvedHandlers.writeInstructionFile(request);
    case 'taskBoard.readBoard':
      return resolvedHandlers.readTaskBoard();
    case 'taskBoard.readTaskContent':
      return resolvedHandlers.readTaskContent(request.payload);
    case 'taskBoard.reorderPending':
      return withStreamEvent(resolvedHandlers.reorderPending(request.payload),
        { message: 'Reordered pending queue.', source: 'taskBoard.reorderPending', role: 'queue' });
    case 'taskBoard.requeueErrorItem':
      return withStreamEvent(resolvedHandlers.requeueErrorItem(request.payload),
        { message: `Requeued ${request.payload.fileName} to pending.`, source: 'taskBoard.requeueErrorItem', role: 'queue' });
    case 'taskBoard.deleteTask':
      return withStreamEvent(resolvedHandlers.deleteTask(request.payload),
        { message: `Deleted ${request.payload.fileName} from ${request.payload.column}.`, source: 'taskBoard.deleteTask', role: 'queue' });
    case 'taskBoard.moveToPending':
      return withStreamEvent(resolvedHandlers.moveToPending(request.payload),
        { message: `Moved ${request.payload.fileName} to pending queue.`, source: 'taskBoard.moveToPending', role: 'queue' });
    case 'taskBoard.moveToOpen':
      return withStreamEvent(resolvedHandlers.moveToOpen(request.payload),
        { message: `Moved ${request.payload.fileName} to open.`, source: 'taskBoard.moveToOpen', role: 'queue' });
    case 'services.readStatus':
      return { ok: true, response: readBackendServiceStatus() };
    case 'services.startBackend': {
      const resp = await startBackendServices(REPO_ROOT);
      if (resp.status === 'healthy') {
        emitStreamEvent({ message: 'Backend services started.', source: 'services.startBackend', role: 'system', severity: 'success' });
      } else if (resp.status === 'unhealthy' || resp.status === 'unavailable') {
        emitStreamEvent({ message: `Backend services failed: ${resp.error ?? resp.status}.`, source: 'services.startBackend', role: 'system', severity: 'error' });
      }
      return { ok: true, response: resp };
    }
    case 'services.stopBackend': {
      const resp = await stopBackendServices(REPO_ROOT);
      if (resp.status === 'idle') {
        emitStreamEvent({ message: 'Backend services stopped.', source: 'services.stopBackend', role: 'system' });
      }
      return { ok: true, response: resp };
    }
    case 'services.healthCheck': {
      const resp = await checkBackendHealth(REPO_ROOT);
      if (resp.status !== 'healthy') {
        emitStreamEvent({ message: `Health check: ${resp.status}.`, source: 'services.healthCheck', role: 'system', severity: 'warning' });
      }
      return { ok: true, response: resp };
    }
    case 'deepFocus.saveSelections':
      return resolvedHandlers.saveDeepFocusSelections(request.payload);
    case 'deepFocus.loadSelections':
      return resolvedHandlers.loadDeepFocusSelections(request.payload);
    case 'deepFocus.clearSelections':
      return resolvedHandlers.clearDeepFocusSelections(request.payload);
    case 'focusFilters.list':
      return resolvedHandlers.listFocusFilters(request.payload);
    case 'focusFilters.create':
      return resolvedHandlers.createFocusFilter(request.payload);
    case 'focusFilters.delete':
      return resolvedHandlers.deleteFocusFilter(request.payload);
    case 'contextPackSidebarState.load':
      return resolvedHandlers.loadContextPackSidebarState();
    case 'contextPackSidebarState.save':
      return resolvedHandlers.saveContextPackSidebarState(request.payload);
    case 'terminal.setTaskScope':
      if (typeof context?.webContentsId !== 'number') {
        return {
          ok: false,
          action: 'terminal.setTaskScope',
          error: 'Terminal task scope requires an IPC sender.',
        };
      }
      return {
        ok: true,
        response: resolvedHandlers.setTerminalTaskScope(
          context.webContentsId,
          request.payload.taskGuid,
        ),
      };
    case 'planner.uploadSpec':
      {
        const activePlannerSessionId = plannerSession.getObservability().sessionId;
        if (
          request.payload.expectedTaskKind &&
          request.payload.requirePlannerSidecar !== true
        ) {
          return {
            ok: false,
            action: 'planner.uploadSpec',
            error: 'planner.uploadSpec expectedTaskKind is only valid when requirePlannerSidecar is true.',
          };
        }
        const sidecar = activePlannerSessionId ? await readPlannerStagingSidecar() : null;
        const plannerSidecar = sidecar?.sessionId === activePlannerSessionId ? sidecar : null;
        if (request.payload.requirePlannerSidecar === true && !plannerSidecar) {
          return {
            ok: false,
            action: 'planner.uploadSpec',
            error: 'Bypass Lily upload for child-task or recent-task mode requires the active planner sidecar. Wait for the selected task session to finish connecting, then retry.',
          };
        }
        if (
          request.payload.expectedTaskKind &&
          plannerSidecar &&
          plannerSidecar.lineage.taskKind !== request.payload.expectedTaskKind
        ) {
          return {
            ok: false,
            action: 'planner.uploadSpec',
            error: `Platform expected ${request.payload.expectedTaskKind} but active planner metadata declares ${plannerSidecar.lineage.taskKind}. Restart the planner session before uploading.`,
          };
        }
        return resolvedHandlers.uploadSpec(request.payload.content, {
          plannerSidecar,
        });
      }
    case 'cancel-task':
      return resolvedHandlers.cancelTask(request.payload.taskId);
    default:
      return {
        ok: false,
        action: (request as { action?: string }).action,
        error: 'Unsupported desktop action requested.',
      };
  }
}
