import type {
  FocusTargetKind,
  NormalizedSupportTarget,
  PrimaryFocusTarget,
  ReadonlyContextRoot,
  WritableRoot,
} from '../../context-pack/deepFocusNormalization.js';

export interface FocusScopePromptOptions {
  primaryFocusRelativePath?: string;
  primaryFocusTargetKind?: FocusTargetKind;
  primaryFocusTargets?: PrimaryFocusTarget[];
  testTarget?: { path: string; kind: FocusTargetKind };
  supportTargets?: NormalizedSupportTarget[];
  writableRoots?: WritableRoot[];
  readonlyContextRoots?: ReadonlyContextRoot[];
  estateType?: string;
  launchContextLine?: string;
  scopeLine?: string;
}

/**
 * Build the shared focus scope block for runtime prompt overrides.
 * Returns undefined when no focus path or writable/read-only root metadata is
 * active so existing no-focus prompt behavior remains unchanged.
 */
export function buildFocusScopeBlock(
  options: FocusScopePromptOptions = {},
): string | undefined {
  const normalizedPath = options.primaryFocusRelativePath?.trim() ?? '';
  const hasFocusedBoundary = normalizedPath
    || (options.primaryFocusTargets?.length ?? 0) > 0
    || (options.writableRoots?.length ?? 0) > 0
    || (options.readonlyContextRoots?.length ?? 0) > 0;
  if (!hasFocusedBoundary) {
    return undefined;
  }

  const focusKind = options.primaryFocusTargetKind ?? 'directory';
  const primaryTargets = options.primaryFocusTargets?.length
    ? options.primaryFocusTargets
    : [{ path: normalizedPath, kind: focusKind, role: 'anchor' as const }];
  const writableRoots = options.writableRoots ?? derivePromptWritableRoots(normalizedPath, focusKind, options.testTarget);
  const distributedEstate = options.estateType?.startsWith('distributed') ?? false;
  const launchContextLine = options.launchContextLine
    ?? 'Your launch CWD is already this folder.';
  const scopeLine = options.scopeLine
    ?? 'Primary focus is where to start. Writable roots define where implementation changes may be made.';
  const parts = [
    distributedEstate ? '## Deep Focus Scope' : '## Monolith Focus Scope',
    '',
    distributedEstate
      ? 'Focused implementation scope is active for this distributed repository selection.'
      : 'You are working inside a monolith repository.',
    `${focusKind === 'file' ? 'Primary focus file' : 'Primary focus path'}: \`${formatTargetPath(normalizedPath, focusKind)}\``,
    launchContextLine,
    scopeLine,
    'Write only inside the writable implementation roots. Support/read-only roots are reference context and must not be edited.',
  ];

  parts.push('', 'Primary targets:');
  for (const target of primaryTargets) {
    const role = target.role === 'anchor' ? 'anchor' : 'primary';
    parts.push(`- \`${formatTargetPath(target.path, target.kind)}\` (${role})`);
  }

  parts.push('', 'Per-primary focus scope:');
  for (const target of primaryTargets) {
    parts.push(...formatPrimaryScopeBlock(target));
  }

  if (options.testTarget || (options.supportTargets?.length ?? 0) > 0) {
    parts.push(
      '',
      'Global test/support scope (applies to all primaries):',
    );
    if (options.testTarget) {
      parts.push(`- Test target: \`${formatTargetPath(options.testTarget.path, options.testTarget.kind)}\``);
    }
    if ((options.supportTargets?.length ?? 0) > 0) {
      parts.push('- Support targets:');
      for (const supportTarget of options.supportTargets ?? []) {
        parts.push(`  - ${formatSupportTarget(supportTarget, normalizedPath, focusKind, options.testTarget)}`);
      }
    }
  }

  if (writableRoots.length > 0) {
    parts.push('', 'Writable implementation roots:');
    for (const root of writableRoots) {
      parts.push(`- \`${formatTargetPath(root.path, root.kind)}\` (${formatRootReason(root.reason)})`);
    }
  } else {
    parts.push('', 'Writable implementation roots:', '- (none)');
  }

  parts.push('', 'Read-only context roots:');
  if ((options.readonlyContextRoots?.length ?? 0) > 0) {
    for (const root of options.readonlyContextRoots ?? []) {
      const displayPath = root.reason === 'support-repo' && root.repoLocalPath
        ? root.repoLocalPath
        : root.path;
      parts.push(`- \`${formatTargetPath(displayPath, root.kind)}\` (${formatRootReason(root.reason)})`);
    }
  } else if ((options.supportTargets?.length ?? 0) > 0) {
    for (const target of options.supportTargets ?? []) {
      parts.push(`- ${formatSupportTarget(target, normalizedPath, focusKind, options.testTarget)}`);
    }
  } else {
    parts.push('- (none)');
  }

  return parts.join('\n');
}

/**
 * Append the shared focus scope block to a prompt parts array when focus or
 * writable-root metadata is active.
 */
export function appendFocusBlock(
  parts: string[],
  options?: FocusScopePromptOptions,
): void {
  const block = buildFocusScopeBlock(options);
  if (block) {
    parts.push(block, '');
  }
}

function formatSupportTarget(
  target: NormalizedSupportTarget,
  primaryFocusRelativePath: string,
  primaryFocusTargetKind: FocusTargetKind,
  testTarget?: { path: string; kind: FocusTargetKind },
): string {
  const formattedTarget = `\`${formatTargetPath(target.path, target.kind)}\``;
  switch (target.effectiveScope) {
    case 'exact-file':
      return `${formattedTarget} (exact file)`;
    case 'directory-minus-primary':
      return `${formattedTarget} excluding \`${formatTargetPath(primaryFocusRelativePath, primaryFocusTargetKind)}\``;
    case 'directory-minus-test':
      return `${formattedTarget} excluding \`${formatTargetPath(testTarget?.path ?? '', testTarget?.kind ?? 'directory')}\``;
    case 'directory-minus-primary-and-test':
      return `${formattedTarget} excluding \`${formatTargetPath(primaryFocusRelativePath, primaryFocusTargetKind)}\` and \`${formatTargetPath(testTarget?.path ?? '', testTarget?.kind ?? 'directory')}\``;
    case 'full-directory':
      return `${formattedTarget} (full directory)`;
  }
}

function formatPrimaryScopeBlock(target: PrimaryFocusTarget): string[] {
  const role = target.role === 'anchor' ? 'anchor' : 'primary';
  const lines = [
    `- ${role === 'anchor' ? 'Anchor' : 'Primary'} target: \`${formatTargetPath(target.path, target.kind)}\` (${target.kind})`,
  ];
  if (target.testTarget) {
    lines.push(`  - Scoped test target: \`${formatTargetPath(target.testTarget.path, target.testTarget.kind)}\``);
  }
  if (target.supportTargets?.length) {
    lines.push('  - Scoped support targets:');
    for (const supportTarget of target.supportTargets) {
      lines.push(`    - \`${formatTargetPath(supportTarget.path, supportTarget.kind)}\` (${supportTarget.kind})`);
    }
  }
  return lines;
}

function formatTargetPath(targetPath: string, kind: FocusTargetKind): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    return '.';
  }
  return kind === 'directory' && !trimmed.endsWith('/')
    ? `${trimmed}/`
    : trimmed;
}

function formatRootReason(reason: WritableRoot['reason'] | ReadonlyContextRoot['reason']): string {
  return reason.replace(/-/g, ' ');
}

function derivePromptWritableRoots(
  primaryPath: string,
  primaryKind: FocusTargetKind,
  testTarget?: { path: string; kind: FocusTargetKind },
): WritableRoot[] {
  const roots: WritableRoot[] = [];
  if (primaryKind === 'file') {
    roots.push({
      path: parentRelativePath(primaryPath),
      kind: 'directory',
      reason: 'primary-focus-parent',
    });
  } else {
    roots.push({
      path: primaryPath,
      kind: 'directory',
      reason: 'selected-primary',
    });
  }
  if (testTarget) {
    roots.push({
      path: testTarget.path,
      kind: testTarget.kind,
      reason: 'test-target',
    });
  }
  return roots;
}

function parentRelativePath(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}
