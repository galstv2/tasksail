import path from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import {
  hasTraversal,
  isStrictAncestor,
  normalizePrimaryFocusTargets,
  normalizeRelativePath,
  normalizeSupportTargets,
  validateTestTarget,
  type FocusTarget,
  type FocusTargetKind,
  type NormalizedSupportTarget,
  type PrimaryFocusTarget,
} from './deepFocusNormalization.js';
import type { AuthoritativeSelection } from './authoritativeSelectionReader.js';

export interface ResolvedDeepFocusSelection {
  deepFocusEnabled: true;
  primaryFocusRelativePath: string;
  primaryFocusTargetKind?: FocusTargetKind;
  primaryFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: FocusTarget | null;
  testTarget?: {
    path: string;
    kind: FocusTargetKind;
    resolvedPath: string;
    repoLocalPath?: string;
    repoId?: string;
    focusId?: string;
  };
  supportTargets?: NormalizedSupportTarget[];
  warnings?: string[];
}

/**
 * Validate a Deep Focus authoritative selection against the filesystem and
 * normalize it into the shape consumed by writable-root derivation.
 *
 * Throws if any selected target is missing on disk, escapes the primary repo,
 * or violates monolith focus-area containment. The anchor target's scalar path
 * fields are populated for legacy consumers; the full ordered target list is
 * returned alongside.
 */
export function resolveDeepFocusSelection(options: {
  selection: AuthoritativeSelection;
  estateType?: string;
  primaryRepoRoot: string;
  declaredRepoRoots?: string[];
  legacyPrimaryFocusRelativePath?: string;
}): ResolvedDeepFocusSelection {
  const canonicalRoot = realpathSync(options.primaryRepoRoot);
  const hasRawPrimaryTargets = Array.isArray(options.selection.selectedFocusTargets);
  const normalizedPrimaryTargets = hasRawPrimaryTargets
    ? normalizePrimaryFocusTargets({
        rawTargets: options.selection.selectedFocusTargets,
        legacyPath: options.selection.selectedFocusPath ?? options.legacyPrimaryFocusRelativePath ?? '',
        legacyKind: options.selection.selectedFocusTargetKind ?? 'directory',
      })
    : { anchor: undefined, targets: [] };
  const resolvedPrimaryTargets = hasRawPrimaryTargets
    ? resolvePrimaryDeepFocusTargets({
        ...options,
        canonicalRoot,
        normalizedTargets: normalizedPrimaryTargets.targets,
      })
    : [];
  const primaryTarget = resolvedPrimaryTargets.find((target) => target.role === 'anchor')
    ?? resolvedPrimaryTargets[0]
    ?? resolvePrimaryDeepFocusTarget({ ...options, canonicalRoot });
  const validatedTestTarget = resolveValidatedTestTarget(
    options.primaryRepoRoot,
    primaryTarget,
    options.selection.selectedTestTarget,
    canonicalRoot,
    options.declaredRepoRoots,
  );
  const supportTargets = resolveValidatedSupportTargets(
    options.primaryRepoRoot,
    primaryTarget,
    resolvedPrimaryTargets,
    validatedTestTarget?.rawTarget,
    options.selection.selectedSupportTargets ?? [],
    canonicalRoot,
    options.declaredRepoRoots,
  );
  const warnings = collectDeepFocusWarnings(resolvedPrimaryTargets.length > 0 ? resolvedPrimaryTargets : [primaryTarget], validatedTestTarget?.rawTarget);

  return {
    deepFocusEnabled: true,
    primaryFocusRelativePath: primaryTarget.path,
    primaryFocusTargetKind: primaryTarget.kind,
    primaryFocusTargets: resolvedPrimaryTargets.length > 0
      ? resolvedPrimaryTargets
      : [{
          path: primaryTarget.path,
          kind: primaryTarget.kind ?? 'directory',
          role: 'anchor',
        }],
    selectedTestTarget: validatedTestTarget?.rawTarget ?? (options.selection.selectedTestTarget === null ? null : undefined),
    testTarget: dedupeResolvedTestTarget(primaryTarget, validatedTestTarget),
    supportTargets: supportTargets.length > 0 ? supportTargets : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function resolvePrimaryDeepFocusTargets(options: {
  selection: AuthoritativeSelection;
  estateType?: string;
  primaryRepoRoot: string;
  declaredRepoRoots?: string[];
  legacyPrimaryFocusRelativePath?: string;
  canonicalRoot?: string;
  normalizedTargets: PrimaryFocusTarget[];
}): PrimaryFocusTarget[] {
  const declaredRootSet = createDeclaredRepoRootSet(options.declaredRepoRoots);
  if (options.normalizedTargets.length > 1) {
    const missingRepoLocalPath = options.normalizedTargets.find((target) => !target.repoLocalPath);
    if (missingRepoLocalPath) {
      throw new Error(
        `Primary Deep Focus target "${missingRepoLocalPath.path}" is missing required repoLocalPath metadata for a multi-primary selection.`,
      );
    }
  }

  const resolvedTargets: PrimaryFocusTarget[] = [];
  for (const target of options.normalizedTargets) {
    const targetRepoRoot = resolveTargetRepoRoot({
      primaryRepoRoot: options.primaryRepoRoot,
      target,
      declaredRootSet,
      canonicalRoot: options.canonicalRoot,
    });
    const resolved = resolveExistingFocusTarget(
      targetRepoRoot.repoRoot,
      target,
      'Primary Deep Focus target',
      targetRepoRoot.canonicalRoot,
    );
    if (
      isMonolithEstateType(options.estateType)
      && options.legacyPrimaryFocusRelativePath
      && resolved.path
      && !doesTargetCover(options.legacyPrimaryFocusRelativePath, 'directory', resolved.path)
    ) {
      throw new Error(
        `Primary Deep Focus target "${target.path}" must stay within the selected monolith focus area "${options.legacyPrimaryFocusRelativePath}".`,
      );
    }
    resolvedTargets.push({
      path: resolved.path,
      kind: resolved.kind ?? target.kind,
      ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
      ...(target.repoId ? { repoId: target.repoId } : {}),
      ...(target.focusId ? { focusId: target.focusId } : {}),
      ...(target.role ? { role: target.role } : {}),
      ...resolveScopedFocusTargets({
        primaryRepoRoot: targetRepoRoot.repoRoot,
        ownerTarget: resolved,
        target,
        estateType: options.estateType,
        legacyPrimaryFocusRelativePath: options.legacyPrimaryFocusRelativePath,
        canonicalRoot: targetRepoRoot.canonicalRoot,
        declaredRepoRoots: options.declaredRepoRoots,
      }),
    });
  }
  return resolvedTargets;
}

function createDeclaredRepoRootSet(declaredRepoRoots: string[] | undefined): Set<string> | undefined {
  if (!declaredRepoRoots) {
    return undefined;
  }
  const roots = declaredRepoRoots.map((root) => realpathSync(root));
  return new Set(roots);
}

function resolveTargetRepoRoot(options: {
  primaryRepoRoot: string;
  target: PrimaryFocusTarget;
  declaredRootSet: Set<string> | undefined;
  canonicalRoot?: string;
}): { repoRoot: string; canonicalRoot: string } {
  const repoRoot = options.target.repoLocalPath
    ? realpathSync(options.target.repoLocalPath)
    : options.primaryRepoRoot;
  const canonicalRoot = options.target.repoLocalPath
    ? repoRoot
    : options.canonicalRoot ?? realpathSync(options.primaryRepoRoot);

  if (options.declaredRootSet && !options.declaredRootSet.has(canonicalRoot)) {
    throw new Error(
      `Primary Deep Focus target "${options.target.path}" repoLocalPath "${options.target.repoLocalPath ?? options.primaryRepoRoot}" is invalid: resolved repo root "${canonicalRoot}" is not declared in the context pack manifest.`,
    );
  }

  return { repoRoot, canonicalRoot };
}

function resolveScopedFocusTargets(options: {
  primaryRepoRoot: string;
  ownerTarget: { path: string; kind?: FocusTargetKind };
  target: PrimaryFocusTarget;
  estateType?: string;
  legacyPrimaryFocusRelativePath?: string;
  canonicalRoot?: string;
  declaredRepoRoots?: string[];
}): Pick<PrimaryFocusTarget, 'testTarget' | 'supportTargets'> {
  const sameScopeScopedTargets = [
    options.target.testTarget,
    ...(options.target.supportTargets ?? []),
  ].some((target) => target && targetsShareTopLevel(options.target, target));
  if (!options.ownerTarget.path && sameScopeScopedTargets) {
    throw new Error(`Primary Deep Focus target "${options.target.path}" cannot carry scoped test or support targets because it selects the repo root.`);
  }

  const testTarget = options.target.testTarget
    ? resolveScopedFocusTarget({
        ...options,
        scopedTarget: options.target.testTarget,
        label: `Scoped test target for primary "${options.target.path}"`,
        declaredRepoRoots: options.declaredRepoRoots,
      })
    : undefined;
  const supportTargets = (options.target.supportTargets ?? []).map((supportTarget, index) =>
    resolveScopedFocusTarget({
      ...options,
      scopedTarget: supportTarget,
      label: `Scoped support target[${index}] for primary "${options.target.path}"`,
      declaredRepoRoots: options.declaredRepoRoots,
    }),
  );

  return {
    ...(testTarget ? { testTarget } : {}),
    ...(supportTargets.length > 0 ? { supportTargets } : {}),
  };
}

function resolveScopedFocusTarget(options: {
  primaryRepoRoot: string;
  scopedTarget: FocusTarget;
  label: string;
  estateType?: string;
  legacyPrimaryFocusRelativePath?: string;
  canonicalRoot?: string;
  declaredRepoRoots?: string[];
}): FocusTarget {
  const targetRepoRoot = resolveFocusTargetRepoRoot({
    primaryRepoRoot: options.primaryRepoRoot,
    target: options.scopedTarget,
    declaredRepoRoots: options.declaredRepoRoots,
    canonicalRoot: options.canonicalRoot,
  });
  const resolved = resolveExistingFocusTarget(
    targetRepoRoot.repoRoot,
    options.scopedTarget,
    options.label,
    targetRepoRoot.canonicalRoot,
  );
  if (
    isMonolithEstateType(options.estateType)
    && options.legacyPrimaryFocusRelativePath
    && resolved.path
    && !doesTargetCover(options.legacyPrimaryFocusRelativePath, 'directory', resolved.path)
  ) {
    throw new Error(
      `${options.label} "${options.scopedTarget.path}" must stay within the selected monolith focus area "${options.legacyPrimaryFocusRelativePath}".`,
    );
  }
  return {
    path: resolved.path,
    kind: resolved.kind ?? options.scopedTarget.kind,
    ...(options.scopedTarget.repoLocalPath ? { repoLocalPath: options.scopedTarget.repoLocalPath } : {}),
    ...(options.scopedTarget.repoId ? { repoId: options.scopedTarget.repoId } : {}),
    ...(options.scopedTarget.focusId ? { focusId: options.scopedTarget.focusId } : {}),
  };
}

function resolvePrimaryDeepFocusTarget(options: {
  selection: AuthoritativeSelection;
  estateType?: string;
  primaryRepoRoot: string;
  legacyPrimaryFocusRelativePath?: string;
  canonicalRoot?: string;
}): { path: string; kind?: FocusTargetKind } {
  const explicitPath = options.selection.selectedFocusPath;
  const explicitKind = options.selection.selectedFocusTargetKind;
  if (explicitPath !== undefined) {
    const normalizedExplicitPath = normalizeDeepFocusRelativePath(
      explicitPath,
      'Primary Deep Focus target',
    );
    if (!normalizedExplicitPath) {
      if (explicitKind === 'file') {
        throw new Error('Deep Focus repo-root selection cannot use file target kind.');
      }
      validateResolvedTargetKind(
        options.primaryRepoRoot,
        '',
        'directory',
        'Primary Deep Focus target',
        options.canonicalRoot,
      );
      return {
        path: '',
        kind: undefined,
      };
    }
    if (!explicitKind) {
      throw new Error('Deep Focus selection is missing required selectedFocusTargetKind metadata.');
    }
    const resolved = resolveExistingFocusTarget(
      options.primaryRepoRoot,
      { path: normalizedExplicitPath, kind: explicitKind },
      'Primary Deep Focus target',
      options.canonicalRoot,
    );
    if (
      isMonolithEstateType(options.estateType)
      && options.legacyPrimaryFocusRelativePath
      && !doesTargetCover(options.legacyPrimaryFocusRelativePath, 'directory', resolved.path)
    ) {
      throw new Error(
        `Primary Deep Focus target "${explicitPath}" must stay within the selected monolith focus area "${options.legacyPrimaryFocusRelativePath}".`,
      );
    }
    return resolved;
  }

  if (options.legacyPrimaryFocusRelativePath) {
    return resolveExistingFocusTarget(
      options.primaryRepoRoot,
      { path: options.legacyPrimaryFocusRelativePath, kind: 'directory' },
      'Primary Deep Focus target',
      options.canonicalRoot,
    );
  }

  if (explicitKind === 'file') {
    throw new Error('Deep Focus repo-root selection cannot use file target kind.');
  }

  validateResolvedTargetKind(
    options.primaryRepoRoot,
    '',
    'directory',
    'Primary Deep Focus target',
    options.canonicalRoot,
  );
  return {
    path: '',
    kind: undefined,
  };
}

function isMonolithEstateType(estateType: string | undefined): boolean {
  return estateType === 'monolith' || estateType === 'monolith-platform';
}

function resolveValidatedTestTarget(
  primaryRepoRoot: string,
  primaryTarget: { path: string; kind?: FocusTargetKind },
  rawTestTarget?: FocusTarget | null,
  canonicalRoot?: string,
  declaredRepoRoots?: string[],
): { rawTarget: FocusTarget; resolvedPath: string } | undefined {
  if (!rawTestTarget) {
    return undefined;
  }

  const validation = validateTestTarget({
    primaryPath: primaryTarget.path,
    primaryKind: primaryTarget.kind ?? 'directory',
    testTarget: rawTestTarget,
  });
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const targetRepoRoot = resolveFocusTargetRepoRoot({
    primaryRepoRoot,
    target: rawTestTarget,
    declaredRepoRoots,
    canonicalRoot,
  });
  const resolved = resolveExistingFocusTarget(
    targetRepoRoot.repoRoot,
    rawTestTarget,
    'Deep Focus test target',
    targetRepoRoot.canonicalRoot,
  );
  return {
    rawTarget: {
      path: resolved.path,
      kind: resolved.kind ?? rawTestTarget.kind,
      ...(rawTestTarget.repoLocalPath ? { repoLocalPath: rawTestTarget.repoLocalPath } : {}),
      ...(rawTestTarget.repoId ? { repoId: rawTestTarget.repoId } : {}),
      ...(rawTestTarget.focusId ? { focusId: rawTestTarget.focusId } : {}),
    },
    resolvedPath: resolved.resolvedPath,
  };
}

function dedupeResolvedTestTarget(
  primaryTarget: FocusTarget,
  testTarget?: { rawTarget: FocusTarget; resolvedPath: string },
): {
  path: string;
  kind: FocusTargetKind;
  resolvedPath: string;
  repoLocalPath?: string;
  repoId?: string;
  focusId?: string;
} | undefined {
  if (!testTarget) {
    return undefined;
  }

  const primaryKind = primaryTarget.kind ?? 'directory';
  if (targetsShareTopLevel(primaryTarget, testTarget.rawTarget)
    && doesTargetCover(primaryTarget.path, primaryKind, testTarget.rawTarget.path)) {
    return undefined;
  }

  return {
    path: testTarget.rawTarget.path,
    kind: testTarget.rawTarget.kind,
    resolvedPath: testTarget.resolvedPath,
    ...(testTarget.rawTarget.repoLocalPath ? { repoLocalPath: testTarget.rawTarget.repoLocalPath } : {}),
    ...(testTarget.rawTarget.repoId ? { repoId: testTarget.rawTarget.repoId } : {}),
    ...(testTarget.rawTarget.focusId ? { focusId: testTarget.rawTarget.focusId } : {}),
  };
}

function resolveValidatedSupportTargets(
  primaryRepoRoot: string,
  primaryTarget: { path: string; kind?: FocusTargetKind },
  primaryTargets: PrimaryFocusTarget[],
  rawTestTarget: FocusTarget | undefined,
  rawSupportTargets: FocusTarget[],
  canonicalRoot?: string,
  declaredRepoRoots?: string[],
): NormalizedSupportTarget[] {
  const validatedTargets = rawSupportTargets.map((target) => {
    const supportRepoRoot = resolveFocusTargetRepoRoot({
      primaryRepoRoot,
      target,
      declaredRepoRoots,
      canonicalRoot,
    });
    const resolved = resolveExistingFocusTarget(
      supportRepoRoot.repoRoot,
      target,
      'Deep Focus support target',
      supportRepoRoot.canonicalRoot,
    );
    return {
      path: resolved.path,
      kind: resolved.kind ?? target.kind,
      ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
      ...(target.repoId ? { repoId: target.repoId } : {}),
      ...(target.focusId ? { focusId: target.focusId } : {}),
    };
  });

  return normalizeSupportTargets({
    primaryPath: primaryTarget.path,
    primaryKind: primaryTarget.kind ?? 'directory',
    primaryTargets,
    testTarget: rawTestTarget,
    rawTargets: validatedTargets,
  });
}

function resolveFocusTargetRepoRoot(options: {
  primaryRepoRoot: string;
  target: FocusTarget;
  declaredRepoRoots: string[] | undefined;
  canonicalRoot?: string;
}): { repoRoot: string; canonicalRoot: string } {
  if (!options.target.repoLocalPath) {
    return {
      repoRoot: options.primaryRepoRoot,
      canonicalRoot: options.canonicalRoot ?? realpathSync(options.primaryRepoRoot),
    };
  }
  const resolvedTargetRoot = realpathSync(options.target.repoLocalPath);
  const declaredRoots = options.declaredRepoRoots?.map((root) => realpathSync(root)) ?? [];
  if (declaredRoots.length > 0 && !declaredRoots.includes(resolvedTargetRoot)) {
    throw new Error(`Deep Focus target repoLocalPath "${options.target.repoLocalPath}" is not declared in the context pack.`);
  }
  return { repoRoot: resolvedTargetRoot, canonicalRoot: resolvedTargetRoot };
}

function targetsShareTopLevel(left: FocusTarget, right: FocusTarget): boolean {
  const leftIdentifiers = [left.repoLocalPath, left.repoId, left.focusId].filter(Boolean);
  const rightIdentifiers = [right.repoLocalPath, right.repoId, right.focusId].filter(Boolean);
  if (leftIdentifiers.length === 0 || rightIdentifiers.length === 0) {
    return true;
  }
  return leftIdentifiers.some((identifier) => rightIdentifiers.includes(identifier));
}

function resolveExistingFocusTarget(
  primaryRepoRoot: string,
  target: FocusTarget,
  label: string,
  canonicalRoot?: string,
): { path: string; kind?: FocusTargetKind; resolvedPath: string } {
  const normalizedPath = validateResolvedTargetKind(primaryRepoRoot, target.path, target.kind, label, canonicalRoot);
  return {
    path: normalizedPath,
    kind: target.kind,
    resolvedPath: normalizedPath ? path.resolve(primaryRepoRoot, normalizedPath) : primaryRepoRoot,
  };
}

function validateResolvedTargetKind(
  primaryRepoRoot: string,
  rawPath: string,
  kind: FocusTargetKind,
  label: string,
  canonicalRoot?: string,
): string {
  const normalizedPath = normalizeDeepFocusRelativePath(rawPath, label);
  const resolvedPath = normalizedPath ? path.resolve(primaryRepoRoot, normalizedPath) : primaryRepoRoot;
  ensureResolvedWithinRoot(primaryRepoRoot, rawPath, resolvedPath, label, canonicalRoot);

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(resolvedPath);
  } catch {
    throw new Error(formatInvalidFocusPathError(label, rawPath, 'does not exist on disk.'));
  }

  if (kind === 'directory' && !stats.isDirectory()) {
    throw new Error(`${label} "${rawPath}" must resolve to a directory.`);
  }
  if (kind === 'file' && !stats.isFile()) {
    throw new Error(`${label} "${rawPath}" must resolve to a file.`);
  }

  return normalizedPath;
}

function normalizeDeepFocusRelativePath(rawPath: string, label: string): string {
  if (typeof rawPath !== 'string') {
    throw new Error(`${label} path must be a string.`);
  }

  const trimmed = rawPath.trim();
  const normalizedPath = normalizeRelativePath(trimmed);

  if (normalizedPath.startsWith('/')) {
    throw new Error(formatInvalidFocusPathError(label, rawPath, 'path must be relative, not absolute.'));
  }
  if (hasTraversal(normalizedPath)) {
    throw new Error(formatInvalidFocusPathError(label, rawPath, 'path must not contain ".." traversal segments.'));
  }

  return normalizedPath;
}

function ensureResolvedWithinRoot(
  primaryRepoRoot: string,
  rawPath: string,
  resolvedPath: string,
  label: string,
  preComputedCanonicalRoot?: string,
): void {
  const canonicalRoot = preComputedCanonicalRoot ?? realpathSync(primaryRepoRoot);
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(resolvedPath);
  } catch {
    throw new Error(
      formatInvalidFocusPathError(
        label,
        rawPath,
        `resolved path "${resolvedPath}" does not exist on disk.`,
      ),
    );
  }

  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(
      formatInvalidFocusPathError(
        label,
        rawPath,
        `resolved path "${canonicalTarget}" must stay within the selected primary repo root "${canonicalRoot}".`,
      ),
    );
  }
}

function formatInvalidFocusPathError(label: string, rawPath: string, reason: string): string {
  return `${label} "${rawPath}" is invalid: ${reason}`;
}

function collectDeepFocusWarnings(
  primaryTargets: Array<{ path: string; kind?: FocusTargetKind }>,
  rawTestTarget?: FocusTarget,
): string[] {
  if (!rawTestTarget || rawTestTarget.kind !== 'directory') {
    return [];
  }

  const testPath = normalizeRelativePath(rawTestTarget.path);
  const warnings: string[] = [];
  for (const primaryTarget of primaryTargets) {
    const primaryPath = normalizeRelativePath(primaryTarget.path);
    if (!primaryPath || !isStrictAncestor(testPath, primaryPath)) {
      continue;
    }
    warnings.push(
      `Deep Focus test target "${rawTestTarget.path}" is an ancestor of the primary target "${primaryTarget.path}" and broadens the writable scope.`,
    );
  }
  return warnings;
}

function doesTargetCover(
  boundaryPath: string,
  boundaryKind: FocusTargetKind,
  candidatePath: string,
): boolean {
  if (boundaryKind === 'file') {
    return candidatePath === boundaryPath;
  }
  if (!boundaryPath) {
    return true;
  }
  return candidatePath === boundaryPath || candidatePath.startsWith(`${boundaryPath}/`);
}
