import {
  DESKTOP_ACTION_NAMES,
  type DesktopActionRequest,
} from './desktopContract';
import {
  validateAddExtensionPayload,
  validateDeleteExtensionPayload,
  validateListExtensionsPayload,
  validateLoadExtensionAssignmentsPayload,
  validateLoadExternalMcpAssignmentsPayload,
  validateReseedExtensionPayload,
  validateSaveExtensionAssignmentsPayload,
  validateSaveExternalMcpAssignmentsPayload,
} from './desktopContractAgentConfigValidators';
import {
  validateSystemSettingsReadPayload,
  validateSystemSettingsSavePayload,
} from './desktopContractSystemSettingsValidators';
import {
  PLANNER_FOCUS_FALLBACK_MESSAGE,
  PLANNER_FOCUS_VALID_MESSAGE,
} from './desktopContractPlanner';
import {
  COMPOSER_STAGES,
  CONTEXT_PACK_DIRECTORY_PURPOSES,
  CONTEXT_PACK_DISCOVERY_MODES,
  CONTEXT_PACK_REPO_CATEGORIES,
  PLANNER_FOCUS_VALIDATION_MODES,
  PLANNER_LILY_PERSONALITY_IDS,
  REINFORCEMENT_FEEDBACK_TYPES,
  TASK_KINDS,
  isAbsolutePath,
  isNonEmptyString,
  isOneOf,
  isRecord,
  isString,
  isValidAgentModelId,
  validateAgentConfigAssignments,
  validateContextPackCreatePayload,
  validateContextPackDirPayload,
  validateContextPackSwitchPayload,
  validateFollowUpDirectSubmissionDraft,
  validatePlannerChildTaskExecutionScope,
  validatePlannerChildTaskLineage,
  validatePlannerDirectSubmissionDraft,
  validatePlannerFocusSnapshot,
  validatePlannerFocusValidationIssue,
  validatePlannerLilyPlanningReloadScope,
  validateRepoRelativePath,
} from './desktopContractValidationCore';

export {
  isRecord,
  validatePlannerDraftModel,
  validatePlannerFocusSnapshot,
} from './desktopContractValidationCore';

const EXTERNAL_MCP_MIN_PURPOSE_LENGTH = 20;

function validateTaskNotificationsMarkSeenPayload(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload must be an object.'];
  }

  const errors: string[] = [];
  if (value.notificationIds !== undefined) {
    if (!Array.isArray(value.notificationIds)) {
      errors.push('payload.notificationIds must be a string array when provided.');
    } else {
      for (const [index, notificationId] of value.notificationIds.entries()) {
        if (!isNonEmptyString(notificationId)) {
          errors.push(`payload.notificationIds[${index}] must be a non-empty string.`);
        }
      }
    }
  }
  if (value.allVisible !== undefined && typeof value.allVisible !== 'boolean') {
    errors.push('payload.allVisible must be a boolean when provided.');
  }
  return errors;
}

function validateTaskNotificationsDismissPayload(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload must be an object.'];
  }
  if (!isNonEmptyString(value.notificationId)) {
    return ['payload.notificationId must be a non-empty string.'];
  }
  return [];
}

function validateNoPayloadRequest(value: unknown): string[] {
  if (value !== undefined) {
    return ['payload must be omitted.'];
  }
  return [];
}

function validateFocusFilterRepositoryTypes(value: unknown): string[] {
  if (!isRecord(value) || value.repositoryTypes === undefined) {
    return [];
  }
  if (!isRecord(value.repositoryTypes)) {
    return ['payload.selection.repositoryTypes must be an object when provided.'];
  }

  const errors: string[] = [];
  for (const [repoId, repositoryType] of Object.entries(value.repositoryTypes)) {
    if (!repoId.trim()) {
      errors.push('payload.selection.repositoryTypes keys must be non-empty strings.');
    }
    if (repositoryType !== 'primary' && repositoryType !== 'support') {
      errors.push(`payload.selection.repositoryTypes.${repoId} must be primary or support.`);
    }
  }
  return errors;
}

function validatePlannerLilyPersonalityId(value: unknown, path = 'payload.lilyPersonalityId'): string[] {
  if (value === undefined) {
    return [];
  }
  if (!isOneOf(value, PLANNER_LILY_PERSONALITY_IDS)) {
    return [`${path} must be balanced or clinical.`];
  }
  return [];
}

function validatePlannerParentBranchView(value: unknown, snapshot: unknown): string[] {
  const prefix = 'payload.parentTaskBranchView';
  if (!isRecord(value)) {
    return [`${prefix} must be an object.`];
  }
  const errors: string[] = [];
  if (value.schemaVersion !== 1) {
    errors.push(`${prefix}.schemaVersion must be 1.`);
  }
  if (!isNonEmptyString(value.parentTaskId)) {
    errors.push(`${prefix}.parentTaskId must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.contextPackDir)) {
    errors.push(`${prefix}.contextPackDir must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.contextPackId)) {
    errors.push(`${prefix}.contextPackId must be a non-empty string.`);
  }
  if (isRecord(snapshot)) {
    if (value.contextPackDir !== snapshot.contextPackDir) {
      errors.push(`${prefix}.contextPackDir must match payload.childTaskFocusSnapshot.contextPackDir.`);
    }
    if (value.contextPackId !== snapshot.contextPackId) {
      errors.push(`${prefix}.contextPackId must match payload.childTaskFocusSnapshot.contextPackId.`);
    }
  }
  if (!isRecord(value.branchChainAvailability)) {
    errors.push(`${prefix}.branchChainAvailability must be an object.`);
  } else if (!isOneOf(value.branchChainAvailability.status, ['ready', 'missing-branch-handoffs', 'invalid-branch-handoffs'] as const)) {
    errors.push(`${prefix}.branchChainAvailability.status must be ready, missing-branch-handoffs, or invalid-branch-handoffs.`);
  } else if (value.branchChainAvailability.status === 'ready') {
    if (!Array.isArray(value.branchHandoffs) || value.branchHandoffs.length === 0) {
      errors.push(`${prefix}.branchHandoffs must be a non-empty array when branch handoffs are ready.`);
    }
  }
  if (value.branchHandoffs !== undefined) {
    if (!Array.isArray(value.branchHandoffs)) {
      errors.push(`${prefix}.branchHandoffs must be an array when provided.`);
    } else {
      value.branchHandoffs.forEach((handoff, index) => {
        const handoffPrefix = `${prefix}.branchHandoffs[${index}]`;
        if (!isRecord(handoff)) {
          errors.push(`${handoffPrefix} must be an object.`);
          return;
        }
        for (const field of ['repoRoot', 'repoLabel', 'branch', 'baseCommitSha', 'headCommitSha', 'status'] as const) {
          if (!isNonEmptyString(handoff[field])) {
            errors.push(`${handoffPrefix}.${field} must be a non-empty string.`);
          }
        }
        if (typeof handoff.commitsAhead !== 'number' || !Number.isFinite(handoff.commitsAhead)) {
          errors.push(`${handoffPrefix}.commitsAhead must be a finite number.`);
        }
      });
    }
  }
  return errors;
}

export function isValidDesktopActionRequest(
  request: unknown,
): request is DesktopActionRequest {
  return validateDesktopActionRequest(request).length === 0;
}

export function validateDesktopActionRequest(request: unknown): string[] {
  if (!isRecord(request)) {
    return ['Desktop action request must be an object.'];
  }

  if (!isOneOf(request.action, DESKTOP_ACTION_NAMES)) {
    return ['action must be one of the approved desktop actions.'];
  }

  switch (request.action) {
    case 'queue.readStatus':
    case 'environment.readStatus':
    case 'observability.readSnapshot':
    case 'contextPack.list':
    case 'contextPack.clearActive':
    case 'contextPackSidebarState.load':
    case 'planner.endSession':
    case 'planner.saveDraft':
    case 'planner.readStagedDraft':
    case 'planner.pickMarkdownFile':
    case 'planner.listArchivedTasks':
    case 'planner.listConversationHistory':
      return [];
    case 'contextPack.listRepoTree': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }

      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.repoLocalPath)) {
        errors.push('payload.repoLocalPath must be an absolute path string.');
      }
      if (request.payload.relativePath !== undefined) {
        errors.push(...validateRepoRelativePath(request.payload.relativePath, 'payload.relativePath'));
      }
      return errors;
    }
    case 'planner.startSession': {
      if (request.payload === undefined || request.payload === null) {
        return [];
      }
      if (!isRecord(request.payload)) {
        return ['payload must be an object when provided.'];
      }
      if (request.payload.contextPackDir !== undefined && !isString(request.payload.contextPackDir)) {
        return ['payload.contextPackDir must be a string when provided.'];
      }
      const personalityErrors = validatePlannerLilyPersonalityId(request.payload.lilyPersonalityId);
      if (personalityErrors.length > 0) {
        return personalityErrors;
      }
      if (request.payload.replayConversationId !== undefined && !isNonEmptyString(request.payload.replayConversationId)) {
        return ['payload.replayConversationId must be a non-empty string when provided.'];
      }
      const errors: string[] = [];
      const hasReplay = request.payload.replayConversationId !== undefined;
      const hasDeepFocus = request.payload.deepFocusSelection !== undefined;
      const hasSnapshot = request.payload.childTaskFocusSnapshot !== undefined;
      const hasLineage = request.payload.childTaskLineage !== undefined;
      const hasExecutionScope = request.payload.childTaskExecutionScope !== undefined;
      const hasReloadScope = request.payload.lilyPlanningReloadScope !== undefined;
      const hasParentBranchView = request.payload.parentTaskBranchView !== undefined;
      if (hasReplay && hasSnapshot) {
        errors.push('payload.replayConversationId cannot be combined with payload.childTaskFocusSnapshot.');
      }
      if (hasDeepFocus && hasSnapshot) {
        errors.push('payload.deepFocusSelection cannot be combined with payload.childTaskFocusSnapshot.');
      }
      if (hasSnapshot && !hasLineage) {
        errors.push('payload.childTaskFocusSnapshot requires payload.childTaskLineage.');
      }
      if (hasLineage && !hasSnapshot) {
        errors.push('payload.childTaskLineage requires payload.childTaskFocusSnapshot.');
      }
      if (hasExecutionScope && !hasSnapshot) {
        errors.push('payload.childTaskExecutionScope requires payload.childTaskFocusSnapshot.');
      }
      if (hasExecutionScope && !hasLineage) {
        errors.push('payload.childTaskExecutionScope requires payload.childTaskLineage.');
      }
      if (hasReplay && hasExecutionScope) {
        errors.push('payload.replayConversationId cannot be combined with payload.childTaskExecutionScope.');
      }
      if (hasDeepFocus && hasExecutionScope) {
        errors.push('payload.deepFocusSelection cannot be combined with payload.childTaskExecutionScope.');
      }
      if (hasReloadScope && !hasSnapshot) {
        errors.push('payload.lilyPlanningReloadScope requires payload.childTaskFocusSnapshot.');
      }
      if (hasReloadScope && !hasLineage) {
        errors.push('payload.lilyPlanningReloadScope requires payload.childTaskLineage.');
      }
      if (hasReloadScope && !hasExecutionScope) {
        errors.push('payload.lilyPlanningReloadScope requires payload.childTaskExecutionScope.');
      }
      if (hasReplay && hasReloadScope) {
        errors.push('payload.replayConversationId cannot be combined with payload.lilyPlanningReloadScope.');
      }
      if (hasDeepFocus && hasReloadScope) {
        errors.push('payload.deepFocusSelection cannot be combined with payload.lilyPlanningReloadScope.');
      }
      if (hasParentBranchView && !hasSnapshot) {
        errors.push('payload.parentTaskBranchView requires payload.childTaskFocusSnapshot.');
      }
      if (hasParentBranchView && !hasLineage) {
        errors.push('payload.parentTaskBranchView requires payload.childTaskLineage.');
      }
      if (hasReplay && hasParentBranchView) {
        errors.push('payload.replayConversationId cannot be combined with payload.parentTaskBranchView.');
      }
      if (hasDeepFocus && hasParentBranchView) {
        errors.push('payload.deepFocusSelection cannot be combined with payload.parentTaskBranchView.');
      }
      if (hasSnapshot) {
        errors.push(...validatePlannerFocusSnapshot(request.payload.childTaskFocusSnapshot));
      }
      if (hasLineage) {
        errors.push(...validatePlannerChildTaskLineage(request.payload.childTaskLineage));
      }
      if (hasExecutionScope) {
        errors.push(...validatePlannerChildTaskExecutionScope(
          request.payload.childTaskExecutionScope,
          request.payload.childTaskFocusSnapshot,
        ));
      }
      if (hasReloadScope) {
        errors.push(...validatePlannerLilyPlanningReloadScope(
          request.payload.lilyPlanningReloadScope,
          request.payload.childTaskFocusSnapshot,
        ));
      }
      if (hasParentBranchView) {
        errors.push(...validatePlannerParentBranchView(
          request.payload.parentTaskBranchView,
          request.payload.childTaskFocusSnapshot,
        ));
      }
      return errors;
    }
    case 'planner.updateSessionPersonality': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      if (request.payload.lilyPersonalityId === undefined) {
        return ['payload.lilyPersonalityId must be balanced or clinical.'];
      }
      return validatePlannerLilyPersonalityId(request.payload.lilyPersonalityId);
    }
    case 'planner.validateChildTaskFocus': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be a non-empty string.');
      }
      errors.push(...validatePlannerFocusSnapshot(request.payload.snapshot, 'payload.snapshot'));
      return errors;
    }
    case 'planner.readParentContextBundle':
    case 'planner.readParentChainArchiveBundle':
    case 'planner.readParentArchiveMarkdown': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.parentTaskId)) {
        errors.push('payload.parentTaskId must be a non-empty string.');
      }
      if (
        request.action === 'planner.readParentChainArchiveBundle'
        && !isNonEmptyString(request.payload.rootTaskId)
      ) {
        errors.push('payload.rootTaskId must be a non-empty string.');
      }
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path string.');
      }
      if (!isNonEmptyString(request.payload.contextPackId)) {
        errors.push('payload.contextPackId must be a non-empty string.');
      }
      return errors;
    }
    case 'planner.hydrateConversation': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      if (!isNonEmptyString(request.payload.recordId)) {
        return ['payload.recordId must be a non-empty string.'];
      }
      return [];
    }
    case 'queue.deletePendingItem': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      if (!isNonEmptyString(request.payload.queueName)) {
        return ['payload.queueName must be a non-empty string.'];
      }
      return [];
    }
    case 'planner.finalizeSpec': {
      if (request.payload === undefined || request.payload === null) {
        return [];
      }
      if (!isRecord(request.payload)) {
        return ['payload must be an object when provided.'];
      }
      const allowed = ['standard', 'child-task'] as const;
      if (
        request.payload.expectedTaskKind !== undefined &&
        !isOneOf(request.payload.expectedTaskKind, allowed)
      ) {
        return ['payload.expectedTaskKind must be standard or child-task when provided.'];
      }
      return [];
    }
    case 'planner.sendMessage': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      if (!isNonEmptyString(request.payload.text)) {
        return ['payload.text must be a non-empty string.'];
      }
      if (request.payload.displayText !== undefined && !isString(request.payload.displayText)) {
        return ['payload.displayText must be a string when provided.'];
      }
      return [];
    }
    case 'contextPack.pickDirectory': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }

      const errors: string[] = [];
      if (!isOneOf(request.payload.purpose, CONTEXT_PACK_DIRECTORY_PURPOSES)) {
        errors.push(
          'payload.purpose must be discovery-root or context-pack-destination.',
        );
      }
      if (
        request.payload.defaultPath !== undefined &&
        !isAbsolutePath(request.payload.defaultPath)
      ) {
        errors.push('payload.defaultPath must be an absolute path string when provided.');
      }
      return errors;
    }
    case 'contextPack.discoverPrefill': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }

      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.rootPath)) {
        errors.push('payload.rootPath must be an absolute path string.');
      }
      if (!isOneOf(request.payload.mode, CONTEXT_PACK_DISCOVERY_MODES)) {
        errors.push('payload.mode must be one of auto, distributed, distributed-platform, monolith, monolith-platform.');
      }
      return errors;
    }
    case 'contextPack.create':
      return validateContextPackCreatePayload(request.payload);
    case 'contextPack.reseed':
      return validateContextPackDirPayload(request.payload);
    case 'planner.submitDraft': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }

      const errors = validatePlannerDirectSubmissionDraft(request.payload.draft);
      if (!isOneOf(request.payload.stage, COMPOSER_STAGES)) {
        errors.push('payload.stage must be compose, preview, or confirm.');
      }
      return errors;
    }
    case 'followup.begin': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }

      const errors = validateFollowUpDirectSubmissionDraft(request.payload.draft);
      if (!isOneOf(request.payload.stage, COMPOSER_STAGES)) {
        errors.push('payload.stage must be compose, preview, or confirm.');
      }
      return errors;
    }
    case 'contextPack.previewSwitch':
    case 'contextPack.applySwitch':
      return validateContextPackSwitchPayload(request.payload);
    case 'contextPack.activate': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }

      const errors: string[] = [];
      if (!isString(request.payload.packId) || !request.payload.packId.trim()) {
        errors.push('payload.packId must be a non-empty string.');
      }
      if (request.payload.command !== 'context-pack:activate') {
        errors.push(
          'payload.command must match the approved activation helper path.',
        );
      }
      if (request.payload.mode !== 'status-only') {
        errors.push('payload.mode must be status-only.');
      }
      return errors;
    }
    case 'contextPack.setRepositoryType': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path.');
      }
      if (!isNonEmptyString(request.payload.repoId)) {
        errors.push('payload.repoId must be a non-empty string.');
      }
      if (
        request.payload.repositoryType !== 'primary' &&
        request.payload.repositoryType !== 'support'
      ) {
        errors.push('payload.repositoryType must be primary or support.');
      }
      return errors;
    }
    case 'contextPack.setRepoCategory': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path.');
      }
      if (!isNonEmptyString(request.payload.repoId)) {
        errors.push('payload.repoId must be a non-empty string.');
      }
      if (!isOneOf(request.payload.repoCategory, CONTEXT_PACK_REPO_CATEGORIES)) {
        errors.push('payload.repoCategory must be service, application, frontend, library, infrastructure, data, documentation, tool, or unknown.');
      }
      return errors;
    }
    case 'reinforcement.submitFeedback': {
      const dirErrors = validateContextPackDirPayload(request.payload);
      if (dirErrors.length > 0 && dirErrors[0] === 'payload must be an object.') {
        return dirErrors;
      }
      const errors = [...dirErrors];
      const payload = request.payload as Record<string, unknown>;
      if (!isNonEmptyString(payload.taskId)) {
        errors.push('payload.taskId must be a non-empty string.');
      }
      if (!isOneOf(payload.feedbackType, REINFORCEMENT_FEEDBACK_TYPES)) {
        errors.push('payload.feedbackType must be none, positive, or negative.');
      }
      if (
        payload.starRating !== undefined &&
        typeof payload.starRating !== 'number'
      ) {
        errors.push('payload.starRating must be a number when provided.');
      }
      if (
        payload.comment !== undefined &&
        !isString(payload.comment)
      ) {
        errors.push('payload.comment must be a string when provided.');
      }
      return errors;
    }
    case 'reinforcement.updateRealignmentDoc': {
      const dirErrors = validateContextPackDirPayload(request.payload);
      if (dirErrors.length > 0 && dirErrors[0] === 'payload must be an object.') {
        return dirErrors;
      }
      const errors = [...dirErrors];
      const payload = request.payload as Record<string, unknown>;
      const hasField = isNonEmptyString(payload.field);
      const hasValue = isString(payload.value);
      const hasUpdates = isRecord(payload.updates);
      if (!hasField && !hasUpdates) {
        if (!hasValue) {
          errors.push('payload must include either field/value or updates.');
        } else {
          errors.push('payload.field must be a non-empty string when using field/value mode.');
        }
      } else if (hasField && !hasValue) {
        errors.push('payload.value must be a string when using field/value mode.');
      }
      return errors;
    }
    case 'reinforcement.readOverview':
    case 'reinforcement.readAgentRewards':
    case 'reinforcement.listRealignmentSessions':
    case 'reinforcement.readRealignmentDoc':
    case 'reinforcement.checkActiveWorkGuard':
      return [];
    case 'reinforcement.startRealignment': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path string.');
      }
      if (!isNonEmptyString(request.payload.triggerTaskId)) {
        errors.push('payload.triggerTaskId must be a non-empty string.');
      }
      return errors;
    }
    case 'reinforcement.runRealignmentAnalysis': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path string.');
      }
      if (!isNonEmptyString(request.payload.realignmentId)) {
        errors.push('payload.realignmentId must be a non-empty string.');
      }
      return errors;
    }
    case 'reinforcement.dismissRealignment': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path string.');
      }
      if (!isNonEmptyString(request.payload.realignmentId)) {
        errors.push('payload.realignmentId must be a non-empty string.');
      }
      return errors;
    }
    case 'reinforcement.listTasks': {
      if (request.payload !== undefined && !isRecord(request.payload)) {
        return ['payload must be an object when provided.'];
      }
      if (request.payload !== undefined && request.payload !== null) {
        const payload = request.payload as Record<string, unknown>;
        if ('year' in payload && !isNonEmptyString(payload.year)) {
          return ['payload.year must be a non-empty string when provided.'];
        }
      }
      return [];
    }
    case 'externalMcp.list':
    case 'agentConfig.loadAgents':
    case 'agentConfig.loadModelCatalog':
    case 'agentConfig.loadCapabilities':
      return [];
    case 'agentConfig.saveAgentModels':
      return validateAgentConfigAssignments(request.payload);
    case 'systemSettings.read':
    case 'systemSettings.restart':
      return validateSystemSettingsReadPayload(request.payload);
    case 'systemSettings.save':
      return validateSystemSettingsSavePayload(request.payload);
    case 'agentConfig.addModel': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.display_name)) {
        errors.push('payload.display_name must be a non-empty string.');
      }
      if (!isValidAgentModelId(request.payload.model_id)) {
        errors.push('payload.model_id must match the approved agent model pattern.');
      }
      return errors;
    }
    case 'agentConfig.removeModel': {
      if (!isRecord(request.payload)) {
        return ['payload must be an object.'];
      }
      if (!isValidAgentModelId(request.payload.model_id)) {
        return ['payload.model_id must match the approved agent model pattern.'];
      }
      return [];
    }
    case 'agentConfig.listExtensions':
      return validateListExtensionsPayload(request.payload);
    case 'agentConfig.addExtension':
      return validateAddExtensionPayload(request.payload);
    case 'agentConfig.reseedExtension':
      return validateReseedExtensionPayload(request.payload);
    case 'agentConfig.deleteExtension':
      return validateDeleteExtensionPayload(request.payload);
    case 'agentConfig.loadExtensionAssignments':
      return validateLoadExtensionAssignmentsPayload(request.payload);
    case 'agentConfig.saveExtensionAssignments':
      return validateSaveExtensionAssignmentsPayload(request.payload);
    case 'agentConfig.loadExternalMcpAssignments':
      return validateLoadExternalMcpAssignmentsPayload(request.payload);
    case 'agentConfig.saveExternalMcpAssignments':
      return validateSaveExternalMcpAssignmentsPayload(request.payload);
    case 'externalMcp.add':
    case 'externalMcp.update': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isRecord(request.payload.server)) return ['payload.server must be an object.'];
      const s = request.payload.server;
      const errors: string[] = [];
      if (!isNonEmptyString(s.id)) errors.push('payload.server.id must be a non-empty string.');
      if (!isNonEmptyString(s.display_name)) errors.push('payload.server.display_name must be a non-empty string.');
      if (!isNonEmptyString(s.purpose) || s.purpose.trim().length < EXTERNAL_MCP_MIN_PURPOSE_LENGTH) {
        errors.push(`payload.server.purpose must describe when to use this server (at least ${EXTERNAL_MCP_MIN_PURPOSE_LENGTH} characters).`);
      }
      if (
        !Array.isArray(s.preferred_for) ||
        !s.preferred_for.some((item) => isNonEmptyString(item))
      ) {
        errors.push('payload.server.preferred_for requires at least one usage cue.');
      }
      if (!isNonEmptyString(s.transport)) errors.push('payload.server.transport must be a non-empty string.');
      if (typeof s.enabled !== 'boolean') errors.push('payload.server.enabled must be a boolean.');
      // Transport-conditional shape checks. The platform validator
      // (validateExternalMcpRegistry) remains the deep authority for url
      // scheme, env-reference format, command, tools, and cwd rules.
      if (s.transport === 'local') {
        if (!isNonEmptyString(s.command)) {
          errors.push('payload.server.command must be a non-empty string for a local server.');
        }
        if (!Array.isArray(s.tools) || s.tools.length === 0 || !s.tools.every(isNonEmptyString)) {
          errors.push('payload.server.tools must be a non-empty array of strings for a local server.');
        } else if (s.tools.includes('*')) {
          errors.push('payload.server.tools must not contain "*" for a local server.');
        }
      } else if (!isNonEmptyString(s.url)) {
        errors.push('payload.server.url must be a non-empty string.');
      }
      return errors;
    }
    case 'externalMcp.remove':
    case 'externalMcp.toggleEnabled': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.serverId)) return ['payload.serverId must be a non-empty string.'];
      return [];
    }
    case 'externalMcp.validateConnection': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.transport)) return ['payload.transport must be a non-empty string.'];
      if (!isNonEmptyString(request.payload.url)) return ['payload.url must be a non-empty string.'];
      return [];
    }
    case 'externalMcp.validateLocalCommand': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.command)) return ['payload.command must be a non-empty string.'];
      return [];
    }
    case 'taskBoard.readBoard':
      return [];
    case 'taskNotifications.read':
      return validateNoPayloadRequest(request.payload);
    case 'taskNotifications.markSeen':
      return validateTaskNotificationsMarkSeenPayload(request.payload);
    case 'taskNotifications.dismiss':
      return validateTaskNotificationsDismissPayload(request.payload);
    case 'taskNotifications.dismissAll':
      return validateNoPayloadRequest(request.payload);
    case 'taskBoard.readTaskContent': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.fileName)) {
        errors.push('payload.fileName must be a non-empty string.');
      }
      const validColumns = ['open', 'pending', 'error', 'completed'] as const;
      if (!isOneOf(request.payload.column, validColumns)) {
        errors.push('payload.column must be open, pending, error, or completed.');
      }
      if (
        request.payload.artifactRelativePath !== undefined
        && !isNonEmptyString(request.payload.artifactRelativePath)
      ) {
        errors.push('payload.artifactRelativePath must be a non-empty string when provided.');
      }
      return errors;
    }
    case 'taskBoard.readChildChainBranchInventory': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.taskId)) {
        errors.push('payload.taskId must be a non-empty string.');
      }
      if (
        request.payload.expectedRootTaskId !== undefined
        && request.payload.expectedRootTaskId !== null
        && !isNonEmptyString(request.payload.expectedRootTaskId)
      ) {
        errors.push('payload.expectedRootTaskId must be a non-empty string or null when provided.');
      }
      return errors;
    }
    case 'taskBoard.reorderPending': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!Array.isArray(request.payload.order)) return ['payload.order must be a string array.'];
      const orderErrors: string[] = [];
      for (const [index, item] of request.payload.order.entries()) {
        if (!isNonEmptyString(item)) {
          orderErrors.push(`payload.order[${index}] must be a non-empty string.`);
        }
      }
      return orderErrors;
    }
    case 'taskBoard.requeueErrorItem': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.fileName)) {
        errors.push('payload.fileName must be a non-empty string.');
      }
      if (typeof request.payload.insertAtIndex !== 'number') {
        errors.push('payload.insertAtIndex must be a number.');
      }
      return errors;
    }
    case 'taskBoard.deleteTask': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.fileName)) {
        errors.push('payload.fileName must be a non-empty string.');
      }
      if (!isOneOf(request.payload.column, ['open', 'pending', 'error'] as const)) {
        errors.push('payload.column must be one of: open, pending, error.');
      }
      return errors;
    }
    case 'taskBoard.moveToPending': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.fileName)) {
        errors.push('payload.fileName must be a non-empty string.');
      }
      if (typeof request.payload.insertAtIndex !== 'number') {
        errors.push('payload.insertAtIndex must be a number.');
      }
      return errors;
    }
    case 'taskBoard.moveToOpen': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.fileName)) {
        errors.push('payload.fileName must be a non-empty string.');
      }
      if (
        request.payload.sourceColumn !== undefined
        && !isOneOf(request.payload.sourceColumn, ['error', 'pending'] as const)
      ) {
        errors.push('payload.sourceColumn must be one of: error, pending.');
      }
      return errors;
    }
    case 'taskBoard.killTask':
    case 'taskBoard.retryKillCleanup': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.fileName) || !request.payload.fileName.endsWith('.md')) {
        errors.push('payload.fileName must be a non-empty markdown file name.');
      }
      if (!isNonEmptyString(request.payload.taskId)) {
        errors.push('payload.taskId must be a non-empty string.');
      }
      if (
        typeof request.payload.fileName === 'string'
        && typeof request.payload.taskId === 'string'
        && request.payload.fileName.replace(/\.md$/, '') !== request.payload.taskId
      ) {
        errors.push('payload.taskId must match payload.fileName without the .md suffix.');
      }
      return errors;
    }
    case 'services.readStatus':
    case 'services.startBackend':
    case 'services.stopBackend':
    case 'services.healthCheck':
      return [];
    case 'deepFocus.saveSelections': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.contextPackDir)) {
        return ['payload.contextPackDir must be a non-empty string.'];
      }
      if (!isRecord(request.payload.selections)) {
        return ['payload.selections must be an object.'];
      }
      return [];
    }
    case 'deepFocus.loadSelections':
    case 'deepFocus.clearSelections': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.contextPackDir)) {
        return ['payload.contextPackDir must be a non-empty string.'];
      }
      return [];
    }
    case 'focusFilters.list':
    case 'focusFilters.delete': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path string.');
      }
      if (
        request.action === 'focusFilters.delete' &&
        !isNonEmptyString(request.payload.filterId)
      ) {
        errors.push('payload.filterId must be a non-empty string.');
      }
      return errors;
    }
    case 'focusFilters.create': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        errors.push('payload.contextPackDir must be an absolute path string.');
      }
      if (!isNonEmptyString(request.payload.name)) {
        errors.push('payload.name must be a non-empty string.');
      }
      if (!isRecord(request.payload.selection)) {
        errors.push('payload.selection must be an object.');
      } else {
        errors.push(...validateFocusFilterRepositoryTypes(request.payload.selection));
      }
      return errors;
    }
    case 'contextPackSidebarState.save': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (
        request.payload.selectedContextPackDir !== null &&
        !isAbsolutePath(request.payload.selectedContextPackDir)
      ) {
        errors.push('payload.selectedContextPackDir must be null or an absolute path string.');
      }
      if (
        request.payload.selection !== null &&
        !isRecord(request.payload.selection)
      ) {
        errors.push('payload.selection must be null or an object.');
      }
      if (
        request.payload.selection !== null &&
        request.payload.selectedContextPackDir === null
      ) {
        errors.push('payload.selectedContextPackDir must be non-null when selection is present.');
      }
      return errors;
    }
    case 'contextPack.delete': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isAbsolutePath(request.payload.contextPackDir)) {
        return ['payload.contextPackDir must be an absolute path string.'];
      }
      return [];
    }
    case 'agentInstructions.listFiles': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const dirs = ['profiles', 'instructions', 'prompts', 'templates'] as const;
      if (!isOneOf(request.payload.directory, dirs)) {
        return ['payload.directory must be profiles, instructions, prompts, or templates.'];
      }
      return [];
    }
    case 'agentInstructions.readFile': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.relativePath)) {
        return ['payload.relativePath must be a non-empty string.'];
      }
      return [];
    }
    case 'agentInstructions.writeFile': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      const errors: string[] = [];
      if (!isNonEmptyString(request.payload.relativePath)) {
        errors.push('payload.relativePath must be a non-empty string.');
      }
      if (!isString(request.payload.content)) {
        errors.push('payload.content must be a string.');
      }
      return errors;
    }
    case 'planner.uploadSpec': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.content)) {
        return ['planner.uploadSpec requires a non-empty content string in the payload.'];
      }
      if (
        request.payload.requirePlannerSidecar !== undefined &&
        typeof request.payload.requirePlannerSidecar !== 'boolean'
      ) {
        return ['payload.requirePlannerSidecar must be a boolean when provided.'];
      }
      if (
        request.payload.expectedTaskKind !== undefined &&
        !isOneOf(request.payload.expectedTaskKind, TASK_KINDS)
      ) {
        return ['payload.expectedTaskKind must be standard or child-task when provided.'];
      }
      if (
        request.payload.expectedTaskKind !== undefined &&
        request.payload.requirePlannerSidecar !== true
      ) {
        return ['payload.expectedTaskKind requires payload.requirePlannerSidecar to be true.'];
      }
      return [];
    }
    case 'cancel-task': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isNonEmptyString(request.payload.taskId)) {
        return ['cancel-task requires a non-empty taskId string in the payload.'];
      }
      return [];
    }
    case 'terminal.setTaskScope': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!('taskGuid' in request.payload)) {
        return ['payload.taskGuid must be null or a non-empty string.'];
      }
      if (request.payload.taskGuid !== null && !isNonEmptyString(request.payload.taskGuid)) {
        return ['payload.taskGuid must be null or a non-empty string.'];
      }
      return [];
    }
    default:
      return ['action must be one of the approved desktop actions.'];
  }
}

export function validatePlannerValidateChildTaskFocusResponse(response: unknown): string[] {
  if (!isRecord(response)) {
    return ['response must be an object.'];
  }
  const errors: string[] = [];
  if (response.action !== 'planner.validateChildTaskFocus') {
    errors.push('response.action must be planner.validateChildTaskFocus.');
  }
  if (!isOneOf(response.mode, PLANNER_FOCUS_VALIDATION_MODES)) {
    errors.push('response.mode must be valid or fallback.');
  }
  if (!Array.isArray(response.issues)) {
    errors.push('response.issues must be an array.');
  } else {
    for (const [index, issue] of response.issues.entries()) {
      errors.push(...validatePlannerFocusValidationIssue(issue, `response.issues[${index}]`));
    }
  }
  if (response.mode === 'valid') {
    if (response.message !== PLANNER_FOCUS_VALID_MESSAGE) {
      errors.push('response.message must equal the valid planner focus validation message.');
    }
    if (Array.isArray(response.issues) && response.issues.length > 0) {
      errors.push('response.issues must be empty when response.mode is valid.');
    }
  }
  if (response.mode === 'fallback') {
    if (response.message !== PLANNER_FOCUS_FALLBACK_MESSAGE) {
      errors.push('response.message must equal the fallback planner focus validation message.');
    }
    if (Array.isArray(response.issues) && response.issues.length === 0) {
      errors.push('response.issues must not be empty when response.mode is fallback.');
    }
  }
  return errors;
}
