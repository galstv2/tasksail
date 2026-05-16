import {
  type WorkspaceScopeMode,
} from './desktopContract';
export const COMPOSER_STAGES = ['compose', 'preview', 'confirm'] as const;
export const TASK_KINDS = ['standard', 'child-task'] as const;
const SUGGESTED_PATHS = ['sequential', 'parallel'] as const;
const SOURCE_STATES = ['idle', 'active', 'blocked', 'completed', 'complete'] as const;
const WORKSPACE_SCOPE_MODES: readonly WorkspaceScopeMode[] = ['focused'] as const;
const CONTEXT_PACK_FOCUS_TARGET_KINDS = ['directory', 'file'] as const;
const CONTEXT_PACK_PRIMARY_FOCUS_TARGET_ROLES = ['anchor', 'primary'] as const;
export const CONTEXT_PACK_DIRECTORY_PURPOSES = [
  'discovery-root',
  'context-pack-destination',
] as const;
export const CONTEXT_PACK_DISCOVERY_MODES = [
  'auto',
  'distributed',
  'distributed-platform',
  'monolith',
  'monolith-platform',
] as const;
const CONTEXT_PACK_CREATE_MODES = [
  'distributed',
  'distributed-platform',
  'monolith',
  'monolith-platform',
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
export const REINFORCEMENT_FEEDBACK_TYPES = ['none', 'positive', 'negative'] as const;
export const PLANNER_FOCUS_VALIDATION_MODES = ['valid', 'fallback'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

export function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return isString(value) && allowed.includes(value as T[number]);
}

export function isAbsolutePath(value: unknown): value is string {
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

export function validateContextPackSwitchPayload(value: unknown): string[] {
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

function validatePrimaryFocusTargetList(
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
  const normalizedPrimaries = value
    .filter(isRecord)
    .map((item) => ({
      path: typeof item.path === 'string' ? normalizeContractPath(item.path) : '',
      kind: item.kind,
      repoLocalPath: typeof item.repoLocalPath === 'string' ? item.repoLocalPath : '',
    }));
  for (const [index, item] of value.entries()) {
    const itemField = `${fieldName}[${index}]`;
    errors.push(...validateDeepFocusTarget(item, itemField));
    if (
      isRecord(item)
      && item.role !== undefined
      && !isOneOf(item.role, CONTEXT_PACK_PRIMARY_FOCUS_TARGET_ROLES)
    ) {
      errors.push(`${itemField}.role must be anchor or primary when provided.`);
    }
    if (isRecord(item)) {
      errors.push(
        ...validatePrimaryScopedFields(item, index, itemField, normalizedPrimaries),
      );
    }
  }
  return errors;
}

export function validatePlannerFocusSnapshot(
  value: unknown,
  fieldName = 'payload.childTaskFocusSnapshot',
): string[] {
  if (!isRecord(value)) {
    return [`${fieldName} must be an object.`];
  }
  const errors: string[] = [];
  if (value.version !== 1) {
    errors.push(`${fieldName}.version must be 1.`);
  }
  for (const key of ['contextPackDir', 'contextPackId', 'title', 'primaryRepoId', 'primaryRepoRoot'] as const) {
    if (!isNonEmptyString(value[key])) {
      errors.push(`${fieldName}.${key} must be a non-empty string.`);
    }
  }
  if (value.primaryFocusRelativePath !== null && !isNonEmptyString(value.primaryFocusRelativePath)) {
    errors.push(`${fieldName}.primaryFocusRelativePath must be a non-empty string or null.`);
  }
  if (value.primaryFocusTargetKind !== null && !isOneOf(value.primaryFocusTargetKind, CONTEXT_PACK_FOCUS_TARGET_KINDS)) {
    errors.push(`${fieldName}.primaryFocusTargetKind must be directory, file, or null.`);
  }
  errors.push(...validatePrimaryFocusTargetList(value.primaryFocusTargets, `${fieldName}.primaryFocusTargets`));
  if (value.selectedTestTarget !== null) {
    errors.push(...validateDeepFocusTarget(value.selectedTestTarget, `${fieldName}.selectedTestTarget`));
  }
  errors.push(...validateDeepFocusTargetList(value.supportTargets, `${fieldName}.supportTargets`));
  if (typeof value.deepFocusEnabled !== 'boolean') {
    errors.push(`${fieldName}.deepFocusEnabled must be a boolean.`);
  }
  if (!isRecord(value.contextPackBinding)) {
    errors.push(`${fieldName}.contextPackBinding must be an object.`);
  } else {
    const binding = value.contextPackBinding;
    for (const key of ['contextPackDir', 'contextPackId', 'scopeMode'] as const) {
      if (!isNonEmptyString(binding[key])) {
        errors.push(`${fieldName}.contextPackBinding.${key} must be a non-empty string.`);
      }
    }
    errors.push(...validateSelectedIds(binding.selectedRepoIds, 'selectedRepoIds').map((error) => error.replace('payload.', `${fieldName}.contextPackBinding.`)));
    errors.push(...validateSelectedIds(binding.selectedFocusIds, 'selectedFocusIds').map((error) => error.replace('payload.', `${fieldName}.contextPackBinding.`)));
    if (typeof binding.deepFocusEnabled !== 'boolean') {
      errors.push(`${fieldName}.contextPackBinding.deepFocusEnabled must be a boolean.`);
    }
    if (binding.selectedFocusPath !== null && !isString(binding.selectedFocusPath)) {
      errors.push(`${fieldName}.contextPackBinding.selectedFocusPath must be a string or null.`);
    }
    if (binding.selectedFocusTargetKind !== null && !isOneOf(binding.selectedFocusTargetKind, CONTEXT_PACK_FOCUS_TARGET_KINDS)) {
      errors.push(`${fieldName}.contextPackBinding.selectedFocusTargetKind must be directory, file, or null.`);
    }
    errors.push(...validatePrimaryFocusTargetList(binding.selectedFocusTargets, `${fieldName}.contextPackBinding.selectedFocusTargets`));
    if (binding.selectedTestTarget !== null) {
      errors.push(...validateDeepFocusTarget(binding.selectedTestTarget, `${fieldName}.contextPackBinding.selectedTestTarget`));
    }
    errors.push(...validateDeepFocusTargetList(binding.selectedSupportTargets, `${fieldName}.contextPackBinding.selectedSupportTargets`));
  }
  return errors;
}

export function validatePlannerChildTaskLineage(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload.childTaskLineage must be an object.'];
  }
  const errors: string[] = [];
  for (const key of ['parentTaskId', 'parentQmdRecordId', 'parentQmdScope', 'rootTaskId', 'followUpReason'] as const) {
    if (!isNonEmptyString(value[key])) {
      errors.push(`payload.childTaskLineage.${key} must be a non-empty string.`);
    }
  }
  return errors;
}

export function validatePlannerFocusValidationIssue(value: unknown, fieldName: string): string[] {
  if (!isRecord(value)) {
    return [`${fieldName} must be an object.`];
  }
  const errors: string[] = [];
  const issueCodes = [
    'context-pack-missing',
    'context-pack-mismatch',
    'context-pack-binding-mismatch',
    'primary-repo-missing',
    'primary-focus-path-missing',
    'primary-focus-target-missing',
    'selected-test-target-missing',
    'support-target-missing',
    'scoped-test-target-missing',
    'scoped-support-target-missing',
    'selected-repo-id-missing',
    'selected-focus-id-missing',
  ] as const;
  if (!isOneOf(value.code, issueCodes)) {
    errors.push(`${fieldName}.code must be a supported planner focus validation issue code.`);
  }
  if (!isNonEmptyString(value.label)) {
    errors.push(`${fieldName}.label must be a non-empty string.`);
  }
  if (value.path !== undefined && !isNonEmptyString(value.path)) {
    errors.push(`${fieldName}.path must be a non-empty string when provided.`);
  }
  if (value.id !== undefined && !isNonEmptyString(value.id)) {
    errors.push(`${fieldName}.id must be a non-empty string when provided.`);
  }
  return errors;
}

function validatePrimaryScopedFields(
  item: Record<string, unknown>,
  primaryIndex: number,
  itemField: string,
  primaries: Array<{ path: string; kind: unknown; repoLocalPath: string }>,
): string[] {
  const errors: string[] = [];
  const primaryPath = typeof item.path === 'string' ? normalizeContractPath(item.path) : '';
  // Cross-repo entries with identical relative paths are not overlaps. Legacy
  // single-repo state has all-equal (or all-empty) repoLocalPath, so the
  // existing same-repo rules still apply unchanged.
  const currentRepoLocalPath = typeof item.repoLocalPath === 'string' ? item.repoLocalPath : '';
  const hasTestTarget = item.testTarget !== undefined && item.testTarget !== null;
  const hasSupportTargets = Array.isArray(item.supportTargets) && item.supportTargets.length > 0;

  if (hasTestTarget) {
    errors.push(...validateDeepFocusTarget(item.testTarget, `${itemField}.testTarget`));
  }
  if (item.supportTargets !== undefined) {
    errors.push(...validateDeepFocusTargetList(item.supportTargets, `${itemField}.supportTargets`));
  }

  if (primaryPath === '' && (hasTestTarget || hasSupportTargets)) {
    errors.push(`${itemField} repo-root primary cannot include testTarget or supportTargets.`);
  }

  if (isRecord(item.testTarget)) {
    const testPath = typeof item.testTarget.path === 'string'
      ? normalizeContractPath(item.testTarget.path)
      : '';
    if (testPath === primaryPath) {
      errors.push(`${itemField}.testTarget overlaps primary[${primaryIndex}].`);
    }
    primaries.forEach((primary, otherIndex) => {
      if (otherIndex === primaryIndex) return;
      if (currentRepoLocalPath !== primary.repoLocalPath) return;
      if (testPath === primary.path) {
        errors.push(`${itemField}.testTarget overlaps primary[${otherIndex}].`);
      }
    });
    if (primaryPath !== '' && isStrictAncestorContractPath(testPath, primaryPath)) {
      errors.push(`${itemField}.testTarget contains primary[${primaryIndex}].`);
    }
  }

  if (Array.isArray(item.supportTargets)) {
    item.supportTargets.forEach((supportTarget, supportIndex) => {
      if (!isRecord(supportTarget)) {
        return;
      }
      const supportField = `${itemField}.supportTargets[${supportIndex}]`;
      const supportPath = typeof supportTarget.path === 'string'
        ? normalizeContractPath(supportTarget.path)
        : '';
      const testPath = isRecord(item.testTarget) && typeof item.testTarget.path === 'string'
        ? normalizeContractPath(item.testTarget.path)
        : undefined;
      if (supportPath === testPath) {
        errors.push(`${supportField} overlaps ${itemField}.testTarget.`);
      }
      primaries.forEach((primary, otherIndex) => {
        // Cross-repo entries with identical relative paths are not overlaps.
        // Same-primary always shares its own repoLocalPath, so self-overlap
        // detection still works as before.
        if (currentRepoLocalPath !== primary.repoLocalPath) return;
        if (supportPath === primary.path) {
          errors.push(`${supportField} overlaps primary[${otherIndex}].`);
        }
        const writableRoot = primary.kind === 'file'
          ? parentContractPath(primary.path)
          : primary.path;
        if (isDescendantOrEqualContractPath(supportPath, writableRoot)) {
          errors.push(`${supportField} overlaps primary[${otherIndex}] writable root.`);
        }
      });
    });
  }

  if (item.kind === 'file' && primaryPath === '') {
    errors.push(`${itemField}.path repo-root target must be a directory, not a file.`);
  }

  return errors;
}

function normalizeContractPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

function parentContractPath(value: string): string {
  return normalizeContractPath(value).split('/').filter(Boolean).slice(0, -1).join('/');
}

function isDescendantOrEqualContractPath(candidatePath: string, parentPath: string): boolean {
  if (parentPath === '') {
    return true;
  }
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}/`);
}

function isStrictAncestorContractPath(candidatePath: string, childPath: string): boolean {
  return candidatePath !== childPath && isDescendantOrEqualContractPath(childPath, candidatePath);
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
    ...validatePrimaryFocusTargetList(
      value.selectedFocusTargets,
      'payload.selectedFocusTargets',
    ),
  );

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
    const selectedFocusTargets = Array.isArray(value.selectedFocusTargets)
      ? value.selectedFocusTargets
      : [];
    const hasRepoAnchor = isNonEmptyString(value.deepFocusPrimaryRepoId);
    const hasFocusAnchor = isNonEmptyString(value.deepFocusPrimaryFocusId);
    if (hasRepoAnchor && hasFocusAnchor) {
      errors.push(
        'payload.deepFocusPrimaryRepoId and payload.deepFocusPrimaryFocusId cannot both be set.',
      );
    }
    if (selectedFocusTargets.length > 0) {
      if (!hasRepoAnchor && !hasFocusAnchor) {
        errors.push(
          'payload.deepFocusPrimaryRepoId or payload.deepFocusPrimaryFocusId is required when Deep Focus primaries are selected.',
        );
      }
      selectedFocusTargets.forEach((entry, index) => {
        if (!isRecord(entry)) return;
        if (!isNonEmptyString(entry.repoLocalPath)) {
          errors.push(
            `payload.selectedFocusTargets[${index}].repoLocalPath must be a non-empty string in Deep Focus mode.`,
          );
        }
        if (hasRepoAnchor && !isNonEmptyString(entry.repoId)) {
          errors.push(
            `payload.selectedFocusTargets[${index}].repoId must be a non-empty string when payload.deepFocusPrimaryRepoId is set.`,
          );
        }
        if (hasFocusAnchor && !isNonEmptyString(entry.focusId)) {
          errors.push(
            `payload.selectedFocusTargets[${index}].focusId must be a non-empty string when payload.deepFocusPrimaryFocusId is set.`,
          );
        }
      });
      const anchor = selectedFocusTargets.find(
        (entry) => isRecord(entry) && entry.role === 'anchor',
      ) ?? selectedFocusTargets.find(isRecord);
      if (isRecord(anchor)) {
        if (
          hasRepoAnchor
          && isNonEmptyString(anchor.repoId)
          && value.deepFocusPrimaryRepoId !== anchor.repoId
        ) {
          errors.push(
            'payload.deepFocusPrimaryRepoId must equal the anchor target repoId.',
          );
        }
        if (
          hasFocusAnchor
          && isNonEmptyString(anchor.focusId)
          && value.deepFocusPrimaryFocusId !== anchor.focusId
        ) {
          errors.push(
            'payload.deepFocusPrimaryFocusId must equal the anchor target focusId.',
          );
        }
      }
    }
    return errors;
  }

  if (
    value.selectedFocusPath !== undefined
    || value.selectedFocusTargetKind !== undefined
    || (Array.isArray(value.selectedFocusTargets) && value.selectedFocusTargets.length > 0)
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

export function validateContextPackDirPayload(value: unknown): string[] {
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

export function isValidAgentModelId(value: unknown): value is string {
  return isNonEmptyString(value) && AGENT_MODEL_ID_PATTERN.test(value);
}

export function validateAgentConfigAssignments(value: unknown): string[] {
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

export function validateContextPackCreatePayload(value: unknown): string[] {
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
  if (!isOneOf(value.mode, CONTEXT_PACK_CREATE_MODES)) {
    errors.push('payload.mode must be one of distributed, distributed-platform, monolith, monolith-platform.');
  }
  if (value.confirmOverwrite !== undefined && typeof value.confirmOverwrite !== 'boolean') {
    errors.push('payload.confirmOverwrite must be a boolean when provided.');
  }
  if (value.allowScaryPath !== undefined && typeof value.allowScaryPath !== 'boolean') {
    errors.push('payload.allowScaryPath must be a boolean when provided.');
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

export function validatePlannerDirectSubmissionDraft(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['payload.draft must be an object.'];
  }

  const errors = validatePlannerDraftModel(value);

  if (!isOneOf(value.taskKind, TASK_KINDS)) {
    errors.push('payload.draft.taskKind must be standard or child-task.');
  }

  return errors;
}

export function validateFollowUpDirectSubmissionDraft(value: unknown): string[] {
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
