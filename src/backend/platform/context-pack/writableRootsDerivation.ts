import {
  isDescendantOrEqual,
  normalizeParentRelativePath,
  normalizeRelativePath,
  type FocusTargetKind,
  type NormalizedSupportTarget,
  type PrimaryFocusTarget,
  type ReadonlyContextRoot,
  type WritableRoot,
} from './deepFocusNormalization.js';

/**
 * Derive Dalton's writable/read-only confinement roots from a validated focus
 * selection. Pure: assumes inputs are already normalized and resolved against
 * the primary repo. Subsumes overlapping directory roots and merges
 * `sourceTargets` so persisted state stays minimal.
 */
export function deriveWritableRootsFromFocusedSelection(options: {
  primaryFocusRelativePath?: string;
  primaryFocusTargetKind?: FocusTargetKind;
  primaryFocusTargets?: PrimaryFocusTarget[];
  testTarget?: { path: string; kind: FocusTargetKind };
  supportTargets?: NormalizedSupportTarget[];
}): {
  writableRoots: WritableRoot[];
  readonlyContextRoots: ReadonlyContextRoot[];
} {
  const writableRoots: WritableRoot[] = [];
  const readonlyContextRoots: ReadonlyContextRoot[] = [];
  const writableSeen = new Set<string>();
  const readonlySeen = new Set<string>();

  const addWritableRoot = (root: WritableRoot): void => {
    const normalizedRoot: WritableRoot = {
      ...root,
      path: normalizeRelativePath(root.path),
    };
    if (root.sourceTargets) {
      normalizedRoot.sourceTargets = root.sourceTargets.map((target) => ({
        ...target,
        path: normalizeRelativePath(target.path),
      }));
    }

    if (normalizedRoot.kind === 'directory') {
      const subsumingRoot = writableRoots.find((candidate) =>
        candidate.kind === 'directory'
        && candidate.repoLocalPath === normalizedRoot.repoLocalPath
        && candidate.reason === normalizedRoot.reason
        && isDescendantOrEqual(normalizedRoot.path, candidate.path)
      );
      if (subsumingRoot) {
        subsumingRoot.sourceTargets = mergeSourceTargets(
          subsumingRoot.sourceTargets,
          normalizedRoot.sourceTargets,
        );
        return;
      }
      for (let index = writableRoots.length - 1; index >= 0; index -= 1) {
        const candidate = writableRoots[index]!;
        if (
          candidate.kind === 'directory'
          && candidate.repoLocalPath === normalizedRoot.repoLocalPath
          && candidate.reason === normalizedRoot.reason
          && isDescendantOrEqual(candidate.path, normalizedRoot.path)
        ) {
          normalizedRoot.sourceTargets = mergeSourceTargets(
            normalizedRoot.sourceTargets,
            candidate.sourceTargets,
          );
          writableSeen.delete(rootKey(candidate));
          writableRoots.splice(index, 1);
        }
      }
    }

    const key = rootKey(normalizedRoot);
    const duplicateRoot = writableRoots.find((root) =>
      rootKey(root) === key
    );
    if (duplicateRoot || writableSeen.has(key)) {
      if (duplicateRoot) {
        duplicateRoot.sourceTargets = mergeSourceTargets(
          duplicateRoot.sourceTargets,
          normalizedRoot.sourceTargets,
        );
      }
      return;
    }
    writableSeen.add(key);
    writableRoots.push(normalizedRoot);
  };

  const addReadonlyContextRoot = (root: ReadonlyContextRoot): void => {
    const normalizedRoot: ReadonlyContextRoot = {
      ...root,
      path: normalizeRelativePath(root.path),
    };
    if (root.sourceTargets) {
      normalizedRoot.sourceTargets = root.sourceTargets.map((target) => ({
        ...target,
        path: normalizeRelativePath(target.path),
      }));
    }
    const key = rootKey(normalizedRoot);
    const duplicateRoot = readonlyContextRoots.find((root) =>
      rootKey(root) === key
    );
    if (duplicateRoot || readonlySeen.has(key)) {
      if (duplicateRoot) {
        duplicateRoot.sourceTargets = mergeSourceTargets(
          duplicateRoot.sourceTargets,
          normalizedRoot.sourceTargets,
        );
      }
      return;
    }
    readonlySeen.add(key);
    readonlyContextRoots.push(normalizedRoot);
  };

  const primaryTargets = options.primaryFocusTargets?.length
    ? options.primaryFocusTargets
    : [{
        path: normalizeRelativePath(options.primaryFocusRelativePath ?? ''),
        kind: options.primaryFocusTargetKind ?? 'directory',
        role: 'anchor' as const,
      }];
  const includeSourceTargets = (options.primaryFocusTargets?.length ?? 0) > 0;
  const anchorRepoLocalPath = primaryTargets.find((target) => target.role === 'anchor')?.repoLocalPath
    ?? primaryTargets[0]?.repoLocalPath;
  for (const target of primaryTargets) {
    const primaryPath = normalizeRelativePath(target.path);
    if (!primaryPath || target.kind === 'directory') {
      addWritableRoot({
        ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
        path: primaryPath,
        kind: 'directory',
        reason: 'selected-primary',
        ...(includeSourceTargets ? { sourceTargets: [{ ...target, path: primaryPath }] } : {}),
      });
    } else {
      addWritableRoot({
        ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
        path: normalizeParentRelativePath(primaryPath),
        kind: 'directory',
        reason: 'primary-focus-parent',
        ...(includeSourceTargets ? { sourceTargets: [{ ...target, path: primaryPath }] } : {}),
      });
    }
    if (target.testTarget) {
      addWritableRoot({
        ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
        path: target.testTarget.path,
        kind: target.testTarget.kind,
        reason: 'scoped-test-target',
        sourceTargets: [{ ...target, path: primaryPath }],
      });
    }
    for (const supportTarget of target.supportTargets ?? []) {
      addReadonlyContextRoot({
        ...(target.repoLocalPath ? { repoLocalPath: target.repoLocalPath } : {}),
        path: supportTarget.path,
        kind: supportTarget.kind,
        reason: 'scoped-support-target',
        sourceTargets: [{ ...target, path: primaryPath }],
      });
    }
  }

  if (options.testTarget) {
    addWritableRoot({
      ...(anchorRepoLocalPath ? { repoLocalPath: anchorRepoLocalPath } : {}),
      path: options.testTarget.path,
      kind: options.testTarget.kind,
      reason: 'test-target',
    });
  }

  for (const supportTarget of options.supportTargets ?? []) {
    addReadonlyContextRoot({
      ...(anchorRepoLocalPath ? { repoLocalPath: anchorRepoLocalPath } : {}),
      path: supportTarget.path,
      kind: supportTarget.kind,
      reason: 'support-target',
    });
  }

  return { writableRoots, readonlyContextRoots };
}

function rootKey(root: WritableRoot | ReadonlyContextRoot): string {
  return [
    root.repoLocalPath ?? '',
    root.path,
    root.kind,
    root.reason,
  ].join('\0');
}

export function getEffectiveScopeForPrimary(
  primary: PrimaryFocusTarget,
  globals?: {
    testTarget?: { path: string; kind: FocusTargetKind } | null;
    supportTargets?: Array<{ path: string; kind: FocusTargetKind }>;
  },
): {
  testTarget?: { path: string; kind: FocusTargetKind };
  supportTargets: Array<{ path: string; kind: FocusTargetKind }>;
} {
  // `null` is the explicit opt-out sentinel (no test target for this primary;
  // do not inherit the global one). `undefined` means inherit. `??` collapses
  // both, so use a strict undefined check to preserve the opt-out.
  const testTarget = primary.testTarget !== undefined
    ? (primary.testTarget ?? undefined)
    : (globals?.testTarget ?? undefined);
  const supportTargets: Array<{ path: string; kind: FocusTargetKind }> = [];
  const seen = new Set<string>();
  for (const target of [...(primary.supportTargets ?? []), ...(globals?.supportTargets ?? [])]) {
    const normalizedTarget = { ...target, path: normalizeRelativePath(target.path) };
    const key = `${normalizedTarget.path}\0${normalizedTarget.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    supportTargets.push(normalizedTarget);
  }
  return {
    ...(testTarget ? { testTarget: { ...testTarget, path: normalizeRelativePath(testTarget.path) } } : {}),
    supportTargets,
  };
}

function mergeSourceTargets(
  left: PrimaryFocusTarget[] | undefined,
  right: PrimaryFocusTarget[] | undefined,
): PrimaryFocusTarget[] | undefined {
  const merged: PrimaryFocusTarget[] = [];
  const seen = new Set<string>();
  for (const target of [...(left ?? []), ...(right ?? [])]) {
    const normalizedTarget = { ...target, path: normalizeRelativePath(target.path) };
    const key = [
      normalizedTarget.repoLocalPath ?? '',
      normalizedTarget.repoId ?? '',
      normalizedTarget.focusId ?? '',
      normalizedTarget.path,
      normalizedTarget.kind,
    ].join('\0');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalizedTarget);
  }
  return merged.length > 0 ? merged : undefined;
}
