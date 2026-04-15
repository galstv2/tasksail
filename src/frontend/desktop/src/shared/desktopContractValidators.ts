import type { DesktopActionRequest, WorkspaceScopeMode } from './desktopContract';

const DESKTOP_ACTION_NAMES = [
  'planner.submitDraft',
  'planner.startSession',
  'planner.sendMessage',
  'planner.endSession',
  'planner.saveDraft',
  'planner.readStagedDraft',
  'planner.finalizeSpec',
  'queue.readStatus',
  'queue.deletePendingItem',
  'environment.readStatus',
  'observability.readSnapshot',
  'followup.begin',
  'contextPack.pickDirectory',
  'contextPack.discoverPrefill',
  'contextPack.create',
  'contextPack.list',
  'contextPack.listRepoTree',
  'contextPack.reseed',
  'contextPack.previewSwitch',
  'contextPack.applySwitch',
  'contextPack.clearActive',
  'contextPack.activate',
  'contextPack.setRepositoryType',
  'planner.pickMarkdownFile',
  'planner.listArchivedTasks',
  'reinforcement.submitFeedback',
  'reinforcement.updateRealignmentDoc',
  'reinforcement.readOverview',
  'reinforcement.listTasks',
  'reinforcement.readAgentRewards',
  'reinforcement.listRealignmentSessions',
  'reinforcement.readRealignmentDoc',
  'reinforcement.checkActiveWorkGuard',
  'reinforcement.startRealignment',
  'externalMcp.list',
  'externalMcp.add',
  'externalMcp.update',
  'externalMcp.remove',
  'externalMcp.toggleEnabled',
  'externalMcp.validateConnection',
  'agentConfig.loadAgents',
  'agentConfig.loadModelCatalog',
  'agentConfig.saveAgentModels',
  'agentConfig.addModel',
  'agentConfig.removeModel',
  'taskBoard.readBoard',
  'taskBoard.readTaskContent',
  'taskBoard.reorderPending',
  'taskBoard.requeueErrorItem',
  'taskBoard.deleteTask',
  'taskBoard.moveToPending',
  'taskBoard.moveToOpen',
  'services.readStatus',
  'services.startBackend',
  'services.stopBackend',
  'services.healthCheck',
  'deepFocus.saveSelections',
  'deepFocus.loadSelections',
  'deepFocus.clearSelections',
  'agentInstructions.listFiles',
  'agentInstructions.readFile',
  'agentInstructions.writeFile',
] as const;

const COMPOSER_STAGES = ['compose', 'preview', 'confirm'] as const;
const TASK_KINDS = ['standard', 'child-task'] as const;
const SUGGESTED_PATHS = ['sequential', 'parallel'] as const;
const SOURCE_STATES = ['idle', 'active', 'blocked', 'completed', 'complete'] as const;
const WORKSPACE_SCOPE_MODES: readonly WorkspaceScopeMode[] = ['focused'] as const;
const CONTEXT_PACK_FOCUS_TARGET_KINDS = ['directory', 'file'] as const;
const CONTEXT_PACK_DIRECTORY_PURPOSES = [
  'discovery-root',
  'context-pack-destination',
] as const;
const CONTEXT_PACK_DISCOVERY_MODES = [
  'auto',
  'distributed',
  'monolith',
] as const;
const CONTEXT_PACK_REPOSITORY_TYPES = ['primary', 'support'] as const;
const CONTEXT_PACK_SYSTEM_LAYERS = [
  'backend',
  'frontend',
  'infrastructure',
  'database',
  'documents',
  'shared',
] as const;
const REINFORCEMENT_FEEDBACK_TYPES = ['none', 'positive', 'negative'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return isString(value) && allowed.includes(value as T[number]);
}

function isAbsolutePath(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  if (value.includes('..')) return false;
  if (value.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

function validateSelectedIds(
  value: unknown,
  fieldName: 'selectedRepoIds' | 'selectedFocusIds',
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [`payload.${fieldName} must be an array when provided.`];
  }

  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      errors.push(
        `payload.${fieldName}[${index}] must be a non-empty string.`,
      );
    }
  }
  return errors;
}

function validateContextPackSwitchPayload(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload must be an object.'];
  }

  const errors: string[] = [];
  if (!isAbsolutePath(value.contextPackDir)) {
    errors.push('payload.contextPackDir must be an absolute path string.');
  }
  if (!isOneOf(value.scopeMode, WORKSPACE_SCOPE_MODES)) {
    errors.push('payload.scopeMode must be focused.');
  }
  errors.push(...validateSelectedIds(value.selectedRepoIds, 'selectedRepoIds'));
  errors.push(...validateSelectedIds(value.selectedFocusIds, 'selectedFocusIds'));
  errors.push(...validateDeepFocusSwitchFields(value));
  return errors;
}

function isRelativeContractPath(value: unknown): value is string {
  return typeof value === 'string'
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !/(^|[\\/])\.\.([\\/]|$)/.test(value);
}

function validateOptionalRelativePath(
  value: unknown,
  fieldName: string,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!isRelativeContractPath(value)) {
    return [`${fieldName} must be a repo-root-relative path without traversal.`];
  }
  return [];
}

function validateDeepFocusTarget(
  value: unknown,
  fieldName: string,
): string[] {
  if (!isRecord(value)) {
    return [`${fieldName} must be an object.`];
  }

  const errors = validateOptionalRelativePath(value.path, `${fieldName}.path`);
  if (!isOneOf(value.kind, CONTEXT_PACK_FOCUS_TARGET_KINDS)) {
    errors.push(`${fieldName}.kind must be directory or file.`);
  }
  return errors;
}

function validateDeepFocusTargetList(
  value: unknown,
  fieldName: string,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`${fieldName} must be an array when provided.`];
  }

  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    errors.push(...validateDeepFocusTarget(item, `${fieldName}[${index}]`));
  }
  return errors;
}

function validateDeepFocusSwitchFields(
  value: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const normalizedSelectedFocusPath = typeof value.selectedFocusPath === 'string'
    ? value.selectedFocusPath.trim()
    : undefined;
  if (
    value.deepFocusEnabled !== undefined
    && typeof value.deepFocusEnabled !== 'boolean'
  ) {
    errors.push('payload.deepFocusEnabled must be a boolean when provided.');
  }

  errors.push(
    ...validateOptionalRelativePath(
      value.selectedFocusPath,
      'payload.selectedFocusPath',
    ),
  );

  if (
    value.selectedFocusTargetKind !== undefined
    && value.selectedFocusTargetKind !== null
    && !isOneOf(value.selectedFocusTargetKind, CONTEXT_PACK_FOCUS_TARGET_KINDS)
  ) {
    errors.push(
      'payload.selectedFocusTargetKind must be directory or file when provided.',
    );
  }

  if (
    value.selectedTestTarget !== undefined
    && value.selectedTestTarget !== null
  ) {
    errors.push(
      ...validateDeepFocusTarget(
        value.selectedTestTarget,
        'payload.selectedTestTarget',
      ),
    );
  }

  errors.push(
    ...validateDeepFocusTargetList(
      value.selectedSupportTargets,
      'payload.selectedSupportTargets',
    ),
  );

  const deepFocusEnabled = value.deepFocusEnabled === true;
  if (deepFocusEnabled) {
    if (
      normalizedSelectedFocusPath !== undefined
      && normalizedSelectedFocusPath.length > 0
      && value.selectedFocusTargetKind == null
    ) {
      errors.push(
        'payload.selectedFocusTargetKind is required when payload.selectedFocusPath is provided in Deep Focus mode.',
      );
    }
    if (
      (normalizedSelectedFocusPath === undefined || normalizedSelectedFocusPath.length === 0)
      && value.selectedFocusTargetKind === 'file'
    ) {
      errors.push(
        'payload.selectedFocusTargetKind cannot be file when payload.selectedFocusPath is empty in Deep Focus mode.',
      );
    }
    return errors;
  }

  if (
    value.selectedFocusPath !== undefined
    || value.selectedFocusTargetKind !== undefined
    || value.selectedTestTarget !== undefined
    || value.deepFocusPrimaryRepoId !== undefined
    || value.deepFocusPrimaryFocusId !== undefined
  ) {
    errors.push(
      'payload.deepFocusEnabled must be true when Deep Focus target metadata is provided.',
    );
  }
  if (
    Array.isArray(value.selectedSupportTargets)
    && value.selectedSupportTargets.length > 0
  ) {
    errors.push(
      'payload.selectedSupportTargets must be absent or empty unless payload.deepFocusEnabled is true.',
    );
  }
  return errors;
}

function validateContextPackDirPayload(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload must be an object.'];
  }

  const errors: string[] = [];
  if (!isAbsolutePath(value.contextPackDir)) {
    errors.push('payload.contextPackDir must be an absolute path string.');
  }
  return errors;
}

// Keep in sync with AGENT_MODEL_PATTERN in src/backend/platform/workflow-policy/models.ts
const AGENT_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

function isValidAgentModelId(value: unknown): value is string {
  return isNonEmptyString(value) && AGENT_MODEL_ID_PATTERN.test(value);
}

function validateAgentConfigAssignments(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload must be an object.'];
  }

  if (!Array.isArray(value.assignments)) {
    return ['payload.assignments must be an array.'];
  }

  const errors: string[] = [];
  for (const [index, assignment] of value.assignments.entries()) {
    if (!isRecord(assignment)) {
      errors.push(`payload.assignments[${index}] must be an object.`);
      continue;
    }
    if (!isNonEmptyString(assignment.agent_id)) {
      errors.push(`payload.assignments[${index}].agent_id must be a non-empty string.`);
    }
    if (!isValidAgentModelId(assignment.model_id)) {
      errors.push(
        `payload.assignments[${index}].model_id must match the approved agent model pattern.`,
      );
    }
  }
  return errors;
}

function validateStringArrayField(
  value: unknown,
  fieldName: string,
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [`${fieldName} must be an array when provided.`];
  }

  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      errors.push(`${fieldName}[${index}] must be a non-empty string.`);
    }
  }
  return errors;
}

function validateContextPackBootstrapRepositoryInput(
  value: unknown,
  index: number,
): string[] {
  if (!isRecord(value)) {
    return [`payload.bootstrapAnswers.repositories[${index}] must be an object.`];
  }

  const errors: string[] = [];
  if (!isAbsolutePath(value.repoRoot)) {
    errors.push(
      `payload.bootstrapAnswers.repositories[${index}].repoRoot must be an absolute path string.`,
    );
  }
  if (!isNonEmptyString(value.repoName)) {
    errors.push(
      `payload.bootstrapAnswers.repositories[${index}].repoName must be a non-empty string.`,
    );
  }
  if (value.repoId !== undefined && !isNonEmptyString(value.repoId)) {
    errors.push(
      `payload.bootstrapAnswers.repositories[${index}].repoId must be a non-empty string when provided.`,
    );
  }
  if (
    value.repositoryType !== undefined &&
    !isOneOf(value.repositoryType, CONTEXT_PACK_REPOSITORY_TYPES)
  ) {
    errors.push(
      `payload.bootstrapAnswers.repositories[${index}].repositoryType must be primary or support when provided.`,
    );
  }
  if (!isOneOf(value.systemLayer, CONTEXT_PACK_SYSTEM_LAYERS)) {
    errors.push(
      `payload.bootstrapAnswers.repositories[${index}].systemLayer must be backend, frontend, infrastructure, database, documents, or shared.`,
    );
  }
  errors.push(
    ...validateStringArrayField(
      value.languages,
      `payload.bootstrapAnswers.repositories[${index}].languages`,
    ),
    ...validateStringArrayField(
      value.artifactRoots,
      `payload.bootstrapAnswers.repositories[${index}].artifactRoots`,
    ),
    ...validateStringArrayField(
      value.documentPaths,
      `payload.bootstrapAnswers.repositories[${index}].documentPaths`,
    ),
    ...validateStringArrayField(
      value.adjacentRepoIds,
      `payload.bootstrapAnswers.repositories[${index}].adjacentRepoIds`,
    ),
    ...validateStringArrayField(
      value.dependsOnRepoIds,
      `payload.bootstrapAnswers.repositories[${index}].dependsOnRepoIds`,
    ),
    ...validateStringArrayField(
      value.usedByRepoIds,
      `payload.bootstrapAnswers.repositories[${index}].usedByRepoIds`,
    ),
  );
  if (
    value.activationPriority !== undefined &&
    typeof value.activationPriority !== 'number'
  ) {
    errors.push(
      `payload.bootstrapAnswers.repositories[${index}].activationPriority must be a number when provided.`,
    );
  }
  return errors;
}

function validateContextPackBootstrapFocusAreaInput(
  value: unknown,
  index: number,
): string[] {
  if (!isRecord(value)) {
    return [`payload.bootstrapAnswers.focusableAreas[${index}] must be an object.`];
  }

  const errors: string[] = [];
  if (
    !isNonEmptyString(value.focusId) &&
    !isNonEmptyString(value.relativePath) &&
    !isAbsolutePath(value.path)
  ) {
    errors.push(
      `payload.bootstrapAnswers.focusableAreas[${index}] must include focusId, relativePath, or an absolute path.`,
    );
  }
  errors.push(
    ...validateStringArrayField(
      value.adjacentFocusAreaIds,
      `payload.bootstrapAnswers.focusableAreas[${index}].adjacentFocusAreaIds`,
    ),
  );
  if (
    value.activationPriority !== undefined &&
    typeof value.activationPriority !== 'number'
  ) {
    errors.push(
      `payload.bootstrapAnswers.focusableAreas[${index}].activationPriority must be a number when provided.`,
    );
  }
  return errors;
}

function validateContextPackCreatePayload(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload must be an object.'];
  }

  const errors: string[] = [];
  if (!isAbsolutePath(value.contextPackDir)) {
    errors.push('payload.contextPackDir must be an absolute path string.');
  }
  if (!isAbsolutePath(value.discoveryRoot)) {
    errors.push('payload.discoveryRoot must be an absolute path string.');
  }
  if (!isOneOf(value.mode, CONTEXT_PACK_DISCOVERY_MODES)) {
    errors.push('payload.mode must be auto, distributed, or monolith.');
  }
  if (!isRecord(value.bootstrapAnswers)) {
    errors.push('payload.bootstrapAnswers must be an object.');
    return errors;
  }

  if (!isNonEmptyString(value.bootstrapAnswers.contextPackId)) {
    errors.push('payload.bootstrapAnswers.contextPackId must be a non-empty string.');
  }
  if (!isNonEmptyString(value.bootstrapAnswers.estateName)) {
    errors.push('payload.bootstrapAnswers.estateName must be a non-empty string.');
  }
  if (
    value.bootstrapAnswers.defaultScopeMode !== undefined &&
    !isOneOf(value.bootstrapAnswers.defaultScopeMode, WORKSPACE_SCOPE_MODES)
  ) {
    errors.push(
      'payload.bootstrapAnswers.defaultScopeMode must be focused when provided.',
    );
  }
  if (!Array.isArray(value.bootstrapAnswers.repositories)) {
    errors.push('payload.bootstrapAnswers.repositories must be a non-empty array.');
  } else if (value.bootstrapAnswers.repositories.length === 0) {
    errors.push('payload.bootstrapAnswers.repositories must be a non-empty array.');
  } else {
    for (const [index, repository] of value.bootstrapAnswers.repositories.entries()) {
      errors.push(...validateContextPackBootstrapRepositoryInput(repository, index));
    }
  }

  errors.push(
    ...validateStringArrayField(
      value.bootstrapAnswers.primaryWorkingRepoIds,
      'payload.bootstrapAnswers.primaryWorkingRepoIds',
    ),
    ...validateStringArrayField(
      value.bootstrapAnswers.primaryFocusAreaIds,
      'payload.bootstrapAnswers.primaryFocusAreaIds',
    ),
  );

  if (value.bootstrapAnswers.focusableAreas !== undefined) {
    if (!Array.isArray(value.bootstrapAnswers.focusableAreas)) {
      errors.push('payload.bootstrapAnswers.focusableAreas must be an array when provided.');
    } else {
      for (const [index, focusArea] of value.bootstrapAnswers.focusableAreas.entries()) {
        errors.push(...validateContextPackBootstrapFocusAreaInput(focusArea, index));
      }
    }
  }
  return errors;
}

export function validatePlannerDraftModel(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload.draft must be an object.'];
  }

  const errors: string[] = [];
  const requiredStringFields = [
    'summary',
    'desiredOutcome',
    'constraints',
    'acceptanceSignals',
    'carryForwardSummary',
    'planningNotes',
  ] as const;

  for (const field of requiredStringFields) {
    if (!isString(value[field])) {
      errors.push(`payload.draft.${field} must be a string.`);
    }
  }

  if (!isOneOf(value.suggestedPath, SUGGESTED_PATHS)) {
    errors.push(
      'payload.draft.suggestedPath must be sequential or parallel.',
    );
  }

  if (
    value.sourceState !== undefined &&
    !isOneOf(value.sourceState, SOURCE_STATES)
  ) {
    errors.push(
      'payload.draft.sourceState must be idle, active, blocked, complete, or completed.',
    );
  }

  return errors;
}

function validatePlannerDirectSubmissionDraft(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload.draft must be an object.'];
  }

  const errors = validatePlannerDraftModel(value);

  if (!isOneOf(value.taskKind, TASK_KINDS)) {
    errors.push('payload.draft.taskKind must be standard or child-task.');
  }

  return errors;
}

function validateFollowUpDirectSubmissionDraft(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload.draft must be an object.'];
  }

  const errors = validatePlannerDirectSubmissionDraft(value);

  if (value.taskKind !== 'child-task') {
    errors.push('payload.draft.taskKind must be child-task.');
  }

  const requiredStringFields = [
    'parentTaskId',
    'parentQmdRecordId',
    'parentQmdScope',
    'rootTaskId',
    'followupReason',
  ] as const;

  for (const field of requiredStringFields) {
    if (!isString(value[field])) {
      errors.push(`payload.draft.${field} must be a string.`);
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
    case 'planner.endSession':
    case 'planner.saveDraft':
    case 'planner.readStagedDraft':
    case 'planner.pickMarkdownFile':
    case 'planner.listArchivedTasks':
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
        if (!isString(request.payload.relativePath)) {
          errors.push('payload.relativePath must be a string when provided.');
        } else if (
          request.payload.relativePath.startsWith('/')
          || request.payload.relativePath.startsWith('\\')
          || /^[A-Za-z]:[\\/]/.test(request.payload.relativePath)
          || request.payload.relativePath.includes('..')
        ) {
          errors.push('payload.relativePath must be a repo-root-relative path without traversal.');
        }
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
        errors.push('payload.mode must be auto, distributed, or monolith.');
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
      return [];
    case 'agentConfig.saveAgentModels':
      return validateAgentConfigAssignments(request.payload);
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
    case 'externalMcp.add':
    case 'externalMcp.update': {
      if (!isRecord(request.payload)) return ['payload must be an object.'];
      if (!isRecord(request.payload.server)) return ['payload.server must be an object.'];
      const s = request.payload.server;
      const errors: string[] = [];
      if (!isNonEmptyString(s.id)) errors.push('payload.server.id must be a non-empty string.');
      if (!isNonEmptyString(s.display_name)) errors.push('payload.server.display_name must be a non-empty string.');
      if (!isNonEmptyString(s.purpose)) errors.push('payload.server.purpose must be a non-empty string.');
      if (!isNonEmptyString(s.transport)) errors.push('payload.server.transport must be a non-empty string.');
      if (!isNonEmptyString(s.url)) errors.push('payload.server.url must be a non-empty string.');
      if (typeof s.enabled !== 'boolean') errors.push('payload.server.enabled must be a boolean.');
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
    case 'taskBoard.readBoard':
      return [];
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
    default:
      return ['action must be one of the approved desktop actions.'];
  }
}
