import type {
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
} from '../../shared/desktopContract';

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function normalizeRelativePath(path: string | null | undefined): string {
  return path ?? '';
}

export function basename(path: string): string {
  if (!path) return 'Repo root';
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function isSameTarget(
  left: ContextPackDeepFocusTarget | null | undefined,
  right: ContextPackDeepFocusTarget | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.path === right.path && left.kind === right.kind;
}

export function pathContains(parentPath: string, childPath: string): boolean {
  if (!parentPath) {
    return childPath.length > 0;
  }
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

export function targetsOverlap(
  left: ContextPackDeepFocusTarget,
  right: ContextPackDeepFocusTarget,
): boolean {
  return (
    left.path === right.path
    || pathContains(left.path, right.path)
    || pathContains(right.path, left.path)
  );
}

export function countKinds(targets: ContextPackDeepFocusTarget[]): {
  directoryCount: number;
  fileCount: number;
} {
  return targets.reduce(
    (counts, target) => {
      if (target.kind === 'directory') {
        counts.directoryCount += 1;
      } else {
        counts.fileCount += 1;
      }
      return counts;
    },
    { directoryCount: 0, fileCount: 0 },
  );
}

export function isMonolithEstateType(estateType: string | null | undefined): boolean {
  return estateType === 'monolith' || estateType === 'monolith-platform';
}

export function supportsDeepFocus(estateType: string | null | undefined): boolean {
  return estateType === 'distributed-platform' || isMonolithEstateType(estateType);
}

export function joinRelativePath(basePath: string, childPath: string): string {
  if (!basePath) return childPath;
  if (!childPath) return basePath;
  return `${basePath}/${childPath}`;
}

export function removePathPrefix(path: string, prefix: string): string {
  if (!prefix) return path;
  if (path === prefix) return '';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

export function getPrimaryDisplayPath(
  target: { label: string; rootPath: string } | null,
  selectedPath: string,
): string {
  if (selectedPath) return selectedPath;
  if (!target) return '';
  return target.rootPath || target.label;
}

export function getPrimaryDisplayLabel(
  target: { label: string; rootPath: string } | null,
  selectedPath: string,
): string {
  if (!target) return 'None selected';
  if (!selectedPath || selectedPath === target.rootPath) {
    return target.label;
  }
  return basename(selectedPath);
}

/**
 * Build a display-label lookup for support targets by cross-referencing
 * empty-path targets against the non-primary top-level repos/areas.
 *
 * Returns a Map keyed by target index. Callers fall back to `basename()`
 * for entries not in the map (i.e. targets with non-empty paths).
 */
export function buildSupportDisplayLabels(
  supportTargets: readonly ContextPackDeepFocusTarget[],
  topLevelTargets: ReadonlyArray<{ id: string; label: string; rootPath: string }>,
  primaryTopLevelId: string | null,
): Map<number, string> {
  const labels = new Map<number, string>();
  const nonPrimaryRoots = topLevelTargets.filter(
    (t) => t.id !== primaryTopLevelId && t.rootPath === '',
  );
  let rootIndex = 0;
  for (let i = 0; i < supportTargets.length; i++) {
    if (!supportTargets[i].path && rootIndex < nonPrimaryRoots.length) {
      labels.set(i, nonPrimaryRoots[rootIndex].label);
      rootIndex++;
    }
  }
  return labels;
}

export function inferDraftPrimaryTarget(
  path: string | null,
  kind: ContextPackFocusTargetKind | null,
): ContextPackDeepFocusTarget | null {
  if (path === null) {
    return null;
  }
  return {
    path: normalizeRelativePath(path),
    kind: kind ?? 'directory',
  };
}
