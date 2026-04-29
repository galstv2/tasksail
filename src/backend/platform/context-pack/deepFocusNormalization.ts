export type FocusTargetKind = 'directory' | 'file';

export interface FocusTarget {
  path: string;
  kind: FocusTargetKind;
}

export type WritableRootReason =
  | 'selected-primary'
  | 'primary-focus-parent'
  | 'test-target';

export interface WritableRoot {
  path: string;
  kind: FocusTargetKind;
  reason: WritableRootReason;
}

export type ReadonlyContextRootReason = 'support-target';

export interface ReadonlyContextRoot {
  path: string;
  kind: FocusTargetKind;
  reason: ReadonlyContextRootReason;
}

export interface NormalizedSupportTarget extends FocusTarget {
  effectiveScope:
    | 'exact-file'
    | 'directory-minus-primary'
    | 'directory-minus-test'
    | 'directory-minus-primary-and-test'
    | 'full-directory';
}

/** Returns true if candidatePath is a descendant of (or equal to) parentPath. */
export function isDescendantOrEqual(candidatePath: string, parentPath: string): boolean {
  const normalizedCandidate = normalizeRelativePath(candidatePath);
  const normalizedParent = normalizeRelativePath(parentPath);
  if (!normalizedParent) {
    return true;
  }
  return normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

/** Returns true if candidatePath is a strict ancestor of childPath. */
export function isStrictAncestor(candidatePath: string, childPath: string): boolean {
  const normalizedCandidate = normalizeRelativePath(candidatePath);
  const normalizedChild = normalizeRelativePath(childPath);
  return normalizedCandidate !== normalizedChild
    && isDescendantOrEqual(normalizedChild, normalizedCandidate);
}

/**
 * Normalize a relative path for comparison.
 *
 * This must stay aligned with confinement path normalization.
 */
export function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

/** Validate a test target against the primary target. Returns null if invalid. */
export function validateTestTarget(options: {
  primaryPath: string;
  primaryKind: FocusTargetKind;
  testTarget: FocusTarget;
}): { valid: true } | { valid: false; reason: string } {
  const { path: rawPath, kind } = options.testTarget;
  if (!isValidTargetKind(kind)) {
    return { valid: false, reason: 'Test target kind must be "directory" or "file".' };
  }

  const invalidReason = getInvalidRelativePathReason(rawPath, 'Test target');
  if (invalidReason) {
    return { valid: false, reason: invalidReason };
  }

  const primaryPath = normalizeRelativePath(options.primaryPath);
  const testPath = normalizeRelativePath(rawPath);
  if (!testPath && kind === 'file') {
    return { valid: false, reason: 'Test target root path must be a directory, not a file.' };
  }

  if (options.primaryKind === 'file' && !primaryPath) {
    return { valid: false, reason: 'Primary file target cannot be the repo root.' };
  }

  return { valid: true };
}

/** Validate and normalize a selectedSupportTargets array against primary and test targets. */
export function normalizeSupportTargets(options: {
  primaryPath: string;
  primaryKind: FocusTargetKind;
  testTarget?: FocusTarget;
  rawTargets: Array<FocusTarget>;
}): NormalizedSupportTarget[] {
  const primaryPath = normalizeRelativePath(options.primaryPath);
  const testPath = options.testTarget ? normalizeRelativePath(options.testTarget.path) : undefined;

  if (!isValidTargetKind(options.primaryKind)) {
    throw new Error('Primary target kind must be "directory" or "file".');
  }
  if (!primaryPath && options.primaryKind === 'file') {
    throw new Error('Primary file target cannot be the repo root.');
  }

  if (options.testTarget) {
    const validation = validateTestTarget({
      primaryPath,
      primaryKind: options.primaryKind,
      testTarget: options.testTarget,
    });
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
  }

  const normalizedTargets = options.rawTargets.map((target) =>
    normalizeSupportTarget({ target, primaryPath, testPath }),
  );

  normalizedTargets.sort(compareNormalizedSupportTargets);

  const kept: NormalizedSupportTarget[] = [];
  for (const target of normalizedTargets) {
    if (kept.some((candidate) => subsumesSupportTarget(candidate, target))) {
      continue;
    }
    kept.push(target);
  }

  return kept;
}

function normalizeSupportTarget(options: {
  target: FocusTarget;
  primaryPath: string;
  testPath?: string;
}): NormalizedSupportTarget {
  const { target, primaryPath, testPath } = options;
  if (!isValidTargetKind(target.kind)) {
    throw new Error('Support target kind must be "directory" or "file".');
  }

  const invalidReason = getInvalidRelativePathReason(target.path, 'Support target');
  if (invalidReason) {
    throw new Error(invalidReason);
  }

  const normalizedPath = normalizeRelativePath(target.path);
  if (!normalizedPath && target.kind === 'file') {
    throw new Error('Support target root path must be a directory, not a file.');
  }

  if (normalizedPath === options.primaryPath) {
    throw new Error(`Support target "${target.path}" duplicates the primary target.`);
  }
  if (testPath !== undefined && normalizedPath === testPath) {
    throw new Error(`Support target "${target.path}" duplicates the test target.`);
  }
  if (isStrictDescendant(normalizedPath, primaryPath)) {
    throw new Error(`Support target "${target.path}" cannot be nested inside the primary target.`);
  }
  if (testPath !== undefined && isStrictDescendant(normalizedPath, testPath)) {
    throw new Error(`Support target "${target.path}" cannot be nested inside the test target.`);
  }

  if (target.kind === 'file') {
    return { path: normalizedPath, kind: 'file', effectiveScope: 'exact-file' };
  }

  const containsPrimary = isStrictAncestor(normalizedPath, primaryPath);
  const containsTest = testPath !== undefined && isStrictAncestor(normalizedPath, testPath);
  if (containsPrimary && containsTest) {
    return { path: normalizedPath, kind: 'directory', effectiveScope: 'directory-minus-primary-and-test' };
  }
  if (containsPrimary) {
    return { path: normalizedPath, kind: 'directory', effectiveScope: 'directory-minus-primary' };
  }
  if (containsTest) {
    return { path: normalizedPath, kind: 'directory', effectiveScope: 'directory-minus-test' };
  }
  return { path: normalizedPath, kind: 'directory', effectiveScope: 'full-directory' };
}

function getInvalidRelativePathReason(rawPath: string, label: string): string | undefined {
  if (typeof rawPath !== 'string') {
    return `${label} path must be a string.`;
  }
  const normalizedPath = normalizeRelativePath(rawPath.trim());
  if (normalizedPath.startsWith('/')) {
    return `${label} path must be relative, not absolute.`;
  }
  if (hasTraversal(normalizedPath)) {
    return `${label} path must not contain ".." traversal segments.`;
  }
  return undefined;
}

export function hasTraversal(normalizedPath: string): boolean {
  return normalizedPath === '..'
    || normalizedPath.startsWith('../')
    || normalizedPath.endsWith('/..')
    || normalizedPath.includes('/../');
}

function isValidTargetKind(value: unknown): value is FocusTargetKind {
  return value === 'directory' || value === 'file';
}

function isStrictDescendant(candidatePath: string, parentPath: string): boolean {
  return candidatePath !== normalizeRelativePath(parentPath)
    && isDescendantOrEqual(candidatePath, parentPath);
}

function compareNormalizedSupportTargets(
  left: NormalizedSupportTarget,
  right: NormalizedSupportTarget,
): number {
  const pathOrder = left.path.localeCompare(right.path);
  if (pathOrder !== 0) {
    return pathOrder;
  }
  if (left.kind === right.kind) {
    return 0;
  }
  return left.kind === 'directory' ? -1 : 1;
}

function subsumesSupportTarget(
  candidate: NormalizedSupportTarget,
  target: NormalizedSupportTarget,
): boolean {
  if (candidate.path === target.path) {
    if (candidate.kind !== target.kind) {
      throw new Error(`Support target "${target.path}" has conflicting kinds.`);
    }
    return true;
  }
  return candidate.kind === 'directory' && isStrictAncestor(candidate.path, target.path);
}
