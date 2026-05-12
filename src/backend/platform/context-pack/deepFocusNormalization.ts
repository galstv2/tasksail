export type FocusTargetKind = 'directory' | 'file';

export interface FocusTarget {
  path: string;
  kind: FocusTargetKind;
}

export interface PrimaryFocusTarget extends FocusTarget {
  /**
   * Repo-local path of the top-level repo this primary belongs to.
   * Required for new commits. Optional in the type to allow legacy state to
   * deserialize and be migrated by the hydration shim. New state must always
   * set it.
   */
  repoLocalPath?: string;
  /**
   * Manifest repo identifier (distributed-mode anchor scalar source).
   * Optional for legacy compatibility; new commits in distributed mode set it.
   */
  repoId?: string;
  /**
   * Manifest focus identifier (monolith-mode anchor scalar source).
   * Optional for legacy compatibility; new commits in monolith mode set it.
   */
  focusId?: string;
  role?: 'anchor' | 'primary';
  testTarget?: FocusTarget | null;
  supportTargets?: FocusTarget[];
}

export type WritableRootReason =
  | 'selected-primary'
  | 'primary-focus-parent'
  | 'test-target'
  | 'scoped-test-target';

export interface WritableRoot {
  repoLocalPath?: string;
  path: string;
  kind: FocusTargetKind;
  reason: WritableRootReason;
  sourceTargets?: PrimaryFocusTarget[];
}

export type ReadonlyContextRootReason =
  | 'support-target'
  | 'scoped-support-target'
  | 'support-repo';

export interface ReadonlyContextRoot {
  repoLocalPath?: string;
  path: string;
  kind: FocusTargetKind;
  reason: ReadonlyContextRootReason;
  sourceTargets?: PrimaryFocusTarget[];
}

export interface NormalizedSupportTarget extends FocusTarget {
  effectiveScope:
    | 'exact-file'
    | 'directory-minus-primary'
    | 'directory-minus-test'
    | 'directory-minus-primary-and-test'
    | 'full-directory';
}

export function normalizePrimaryFocusTargets(options: {
  rawTargets?: PrimaryFocusTarget[] | null;
  legacyPath?: string | null;
  legacyKind?: FocusTargetKind | null;
}): {
  anchor: PrimaryFocusTarget | undefined;
  targets: PrimaryFocusTarget[];
} {
  const rawTargets = Array.isArray(options.rawTargets) ? options.rawTargets : undefined;
  if (rawTargets) {
    const targets: PrimaryFocusTarget[] = [];
    const byKey = new Map<string, number>();
    let explicitAnchorKey: string | undefined;

    for (const [index, rawTarget] of rawTargets.entries()) {
      const target = normalizePrimaryFocusTarget(rawTarget, `selectedFocusTargets[${index}]`);
      const key = primaryIdentityKey(target);
      const existingIndex = byKey.get(key);
      if (target.role === 'anchor') {
        if (explicitAnchorKey !== undefined && explicitAnchorKey !== key) {
          throw new Error('Primary target selection cannot contain more than one anchor.');
        }
        explicitAnchorKey = key;
      }
      if (existingIndex !== undefined) {
        const existing = targets[existingIndex]!;
        if (target.role === 'anchor') {
          existing.role = 'anchor';
        }
        mergeDuplicatePrimaryTarget(existing, target);
        continue;
      }
      byKey.set(key, targets.length);
      targets.push(target);
    }

    if (targets.length === 0) {
      return { anchor: undefined, targets: [] };
    }

    const anchorIndex = explicitAnchorKey !== undefined
      ? targets.findIndex((target) => primaryIdentityKey(target) === explicitAnchorKey)
      : 0;
    const normalizedTargets: PrimaryFocusTarget[] = targets.map((target, index) => ({
      ...target,
      role: index === anchorIndex ? 'anchor' : 'primary',
    }));
    validateScopedPrimaryTargets(normalizedTargets);
    const anchor = normalizedTargets[anchorIndex];
    return { anchor, targets: normalizedTargets };
  }

  if (options.legacyPath === undefined || options.legacyPath === null) {
    return { anchor: undefined, targets: [] };
  }
  const legacyKind = options.legacyKind ?? 'directory';
  const anchor = normalizePrimaryFocusTarget(
    { path: options.legacyPath, kind: legacyKind, role: 'anchor' },
    'Primary target',
  );
  return { anchor, targets: [anchor] };
}

function primaryIdentityKey(target: PrimaryFocusTarget): string {
  return [
    target.repoLocalPath ?? '',
    target.repoId ?? '',
    target.focusId ?? '',
    target.path,
    target.kind,
  ].join('\0');
}

function normalizePrimaryFocusTarget(target: PrimaryFocusTarget, label: string): PrimaryFocusTarget {
  if (!target || typeof target !== 'object') {
    throw new Error(`${label} must be an object.`);
  }
  if (!isValidTargetKind(target.kind)) {
    throw new Error(`${label} kind must be "directory" or "file".`);
  }
  if (target.role !== undefined && target.role !== 'anchor' && target.role !== 'primary') {
    throw new Error(`${label} role must be "anchor" or "primary".`);
  }
  const invalidReason = getInvalidRelativePathReason(target.path, label);
  if (invalidReason) {
    throw new Error(invalidReason);
  }
  const normalizedPath = normalizeRelativePath(target.path.trim());
  if (!normalizedPath && target.kind === 'file') {
    throw new Error(`${label} repo-root path must be a directory, not a file.`);
  }
  const testTarget = normalizeScopedTestTarget(target.testTarget, label);
  const supportTargets = normalizeScopedSupportTargets(target.supportTargets, label);
  if (!normalizedPath && (testTarget || supportTargets.length > 0)) {
    throw new Error(
      `scoped-fields-on-repo-root-primary: ${label} repo-root primary cannot include testTarget or supportTargets.`,
    );
  }
  return {
    path: normalizedPath,
    kind: target.kind,
    ...(typeof target.repoLocalPath === 'string' && target.repoLocalPath
      ? { repoLocalPath: target.repoLocalPath }
      : {}),
    ...(typeof target.repoId === 'string' && target.repoId
      ? { repoId: target.repoId }
      : {}),
    ...(typeof target.focusId === 'string' && target.focusId
      ? { focusId: target.focusId }
      : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(testTarget ? { testTarget } : {}),
    ...(supportTargets.length > 0 ? { supportTargets } : {}),
  };
}

function normalizeScopedTestTarget(
  target: FocusTarget | null | undefined,
  label: string,
): FocusTarget | undefined {
  if (target === undefined || target === null) {
    return undefined;
  }
  return normalizeNestedFocusTarget(target, `${label}.testTarget`);
}

function normalizeScopedSupportTargets(
  targets: FocusTarget[] | undefined,
  label: string,
): FocusTarget[] {
  if (targets === undefined) {
    return [];
  }
  if (!Array.isArray(targets)) {
    throw new Error(`${label}.supportTargets must be an array when provided.`);
  }
  const normalizedTargets: FocusTarget[] = [];
  const seen = new Set<string>();
  for (const [index, target] of targets.entries()) {
    const normalized = normalizeNestedFocusTarget(target, `${label}.supportTargets[${index}]`);
    const key = `${normalized.path}\0${normalized.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalizedTargets.push(normalized);
  }
  return normalizedTargets;
}

function normalizeNestedFocusTarget(target: FocusTarget, label: string): FocusTarget {
  if (!target || typeof target !== 'object') {
    throw new Error(`${label} must be an object.`);
  }
  if (!isValidTargetKind(target.kind)) {
    throw new Error(`${label} kind must be "directory" or "file".`);
  }
  const invalidReason = getInvalidRelativePathReason(target.path, label);
  if (invalidReason) {
    throw new Error(invalidReason);
  }
  const normalizedPath = normalizeRelativePath(target.path.trim());
  if (!normalizedPath && target.kind === 'file') {
    throw new Error(`${label} repo-root path must be a directory, not a file.`);
  }
  return { path: normalizedPath, kind: target.kind };
}

function mergeDuplicatePrimaryTarget(existing: PrimaryFocusTarget, duplicate: PrimaryFocusTarget): void {
  if (
    existing.testTarget === undefined
    && duplicate.testTarget !== undefined
    && duplicate.testTarget !== null
  ) {
    existing.testTarget = duplicate.testTarget;
  }
  if (duplicate.supportTargets?.length) {
    existing.supportTargets = dedupeFocusTargets([
      ...(existing.supportTargets ?? []),
      ...duplicate.supportTargets,
    ]);
  }
}

function dedupeFocusTargets(targets: FocusTarget[]): FocusTarget[] {
  const seen = new Set<string>();
  const kept: FocusTarget[] = [];
  for (const target of targets) {
    const key = `${target.path}\0${target.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(target);
  }
  return kept;
}

function validateScopedPrimaryTargets(targets: PrimaryFocusTarget[]): void {
  for (const [index, primary] of targets.entries()) {
    validatePrimaryScopedFields(primary, index, targets);
  }
  validateScopedSupportUnion(targets);
}

function validatePrimaryScopedFields(
  primary: PrimaryFocusTarget,
  primaryIndex: number,
  targets: PrimaryFocusTarget[],
): void {
  if (primary.testTarget) {
    if (primary.testTarget.path === primary.path) {
      throw new Error(`selectedFocusTargets[${primaryIndex}].testTarget overlaps primary[${primaryIndex}].`);
    }
    const otherPrimaryIndex = targets.findIndex((target, index) =>
      index !== primaryIndex
        && sameRepoValidationScope(primary, target)
        && target.path === primary.testTarget?.path,
    );
    if (otherPrimaryIndex !== -1) {
      throw new Error(`selectedFocusTargets[${primaryIndex}].testTarget overlaps primary[${otherPrimaryIndex}].`);
    }
    if (isStrictAncestor(primary.testTarget.path, primary.path)) {
      throw new Error(`selectedFocusTargets[${primaryIndex}].testTarget contains primary[${primaryIndex}].`);
    }
  }

  for (const [supportIndex, supportTarget] of (primary.supportTargets ?? []).entries()) {
    const supportField = `selectedFocusTargets[${primaryIndex}].supportTargets[${supportIndex}]`;
    if (supportTarget.path === primary.path) {
      throw new Error(`${supportField} overlaps primary[${primaryIndex}].`);
    }
    if (isDescendantOrEqual(supportTarget.path, getPrimaryWritableRoot(primary))) {
      throw new Error(`${supportField} overlaps primary[${primaryIndex}] writable root.`);
    }
    if (primary.testTarget && supportTarget.path === primary.testTarget.path) {
      throw new Error(`${supportField} overlaps selectedFocusTargets[${primaryIndex}].testTarget.`);
    }
    const otherPrimaryIndex = targets.findIndex((target, index) =>
      index !== primaryIndex
        && sameRepoValidationScope(primary, target)
        && target.path === supportTarget.path,
    );
    if (otherPrimaryIndex !== -1) {
      throw new Error(`${supportField} overlaps primary[${otherPrimaryIndex}].`);
    }
  }
}

function validateScopedSupportUnion(targets: PrimaryFocusTarget[]): void {
  if (targets.length <= 1) {
    return;
  }
  for (const [primaryIndex, primary] of targets.entries()) {
    for (const [supportIndex, supportTarget] of (primary.supportTargets ?? []).entries()) {
      for (const [otherPrimaryIndex, otherPrimary] of targets.entries()) {
        if (!sameRepoValidationScope(primary, otherPrimary)) {
          continue;
        }
        const supportField = `selectedFocusTargets[${primaryIndex}].supportTargets[${supportIndex}]`;
        if (isDescendantOrEqual(supportTarget.path, getPrimaryWritableRoot(otherPrimary))) {
          throw new Error(`${supportField} overlaps primary[${otherPrimaryIndex}] writable root.`);
        }
        if (isStrictAncestor(supportTarget.path, otherPrimary.path)) {
          throw new Error(`${supportField} contains primary[${otherPrimaryIndex}].`);
        }
      }
    }
  }
}

function sameRepoValidationScope(a: PrimaryFocusTarget, b: PrimaryFocusTarget): boolean {
  if (!a.repoLocalPath || !b.repoLocalPath) {
    return true;
  }
  return a.repoLocalPath === b.repoLocalPath;
}

function getPrimaryWritableRoot(primary: PrimaryFocusTarget): string {
  return primary.kind === 'file' ? normalizeParentRelativePath(primary.path) : primary.path;
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
  primaryTargets?: PrimaryFocusTarget[];
  testTarget?: FocusTarget;
  rawTargets: Array<FocusTarget>;
}): NormalizedSupportTarget[] {
  const primaryPath = normalizeRelativePath(options.primaryPath);
  const testPath = options.testTarget ? normalizeRelativePath(options.testTarget.path) : undefined;
  const primaryTargets: PrimaryFocusTarget[] = options.primaryTargets?.length
    ? options.primaryTargets.map((target) => ({
        path: normalizeRelativePath(target.path),
        kind: target.kind,
        role: target.role,
        ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
        ...(target.repoId ? { repoId: target.repoId } : {}),
        ...(target.focusId ? { focusId: target.focusId } : {}),
      }))
    : [{ path: primaryPath, kind: options.primaryKind }];
  const currentPrimary = primaryTargets.find((target) =>
    target.path === primaryPath && target.kind === options.primaryKind && target.role === 'anchor',
  ) ?? primaryTargets.find((target) =>
    target.path === primaryPath && target.kind === options.primaryKind,
  ) ?? { path: primaryPath, kind: options.primaryKind };
  const strictMultiPrimaryOverlap = primaryTargets.length > 1;

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
    normalizeSupportTarget({
      target,
      primaryPath,
      testPath,
      primaryTargets,
      currentPrimary,
      strictMultiPrimaryOverlap,
    }),
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
  primaryTargets: PrimaryFocusTarget[];
  currentPrimary: PrimaryFocusTarget;
  strictMultiPrimaryOverlap: boolean;
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

  const duplicatePrimary = options.primaryTargets.find((primaryTarget) =>
    sameRepoValidationScope(options.currentPrimary, primaryTarget)
      && normalizedPath === normalizeRelativePath(primaryTarget.path),
  );
  if (duplicatePrimary) {
    throw new Error(`Support target "${target.path}" duplicates a primary target.`);
  }
  if (testPath !== undefined && normalizedPath === testPath) {
    throw new Error(`Support target "${target.path}" duplicates the test target.`);
  }
  if (options.strictMultiPrimaryOverlap) {
    for (const primaryTarget of options.primaryTargets) {
      if (!sameRepoValidationScope(options.currentPrimary, primaryTarget)) {
        continue;
      }
      const primaryTargetPath = normalizeRelativePath(primaryTarget.path);
      const writableRoot = primaryTarget.kind === 'file'
        ? normalizeParentRelativePath(primaryTargetPath)
        : primaryTargetPath;
      if (isStrictDescendant(normalizedPath, writableRoot) || normalizedPath === writableRoot) {
        throw new Error(`Support target "${target.path}" cannot be inside a primary writable root.`);
      }
      if (isStrictAncestor(normalizedPath, primaryTargetPath)) {
        throw new Error(`Support target "${target.path}" cannot be an ancestor of a primary target.`);
      }
    }
  } else if (isStrictDescendant(normalizedPath, primaryPath)) {
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

export function normalizeParentRelativePath(relativePath: string): string {
  const parentRelativePath = relativePath.split('/').filter(Boolean).slice(0, -1).join('/');
  return normalizeRelativePath(parentRelativePath);
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
