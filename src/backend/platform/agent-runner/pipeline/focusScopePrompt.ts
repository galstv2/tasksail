import type { FocusTargetKind, NormalizedSupportTarget } from '../../context-pack/deepFocusNormalization.js';

export interface FocusScopePromptOptions {
  primaryFocusRelativePath?: string;
  primaryFocusTargetKind?: FocusTargetKind;
  testTarget?: { path: string; kind: FocusTargetKind };
  supportTargets?: NormalizedSupportTarget[];
  estateType?: string;
  launchContextLine?: string;
  scopeLine?: string;
}

/**
 * Build the shared focus scope block for runtime prompt overrides.
 * Returns undefined when no focus path is active so existing no-focus prompt
 * behavior remains unchanged.
 */
export function buildFocusScopeBlock(
  options: FocusScopePromptOptions = {},
): string | undefined {
  const normalizedPath = options.primaryFocusRelativePath?.trim();
  if (!normalizedPath) {
    return undefined;
  }

  const focusKind = options.primaryFocusTargetKind ?? 'directory';
  const distributedEstate = options.estateType?.startsWith('distributed') ?? false;
  const launchContextLine = options.launchContextLine
    ?? 'Your launch CWD is already this folder.';
  const scopeLine = options.scopeLine
    ?? 'Sibling folders may be read for context, but implementation changes must stay within the selected focus area.';
  const parts = [
    distributedEstate ? '## Deep Focus Scope' : '## Monolith Focus Scope',
    '',
    distributedEstate
      ? 'Deep Focus is active for this distributed repository selection.'
      : 'You are working inside a monolith repository.',
    `${focusKind === 'file' ? 'Primary focus file' : 'Primary focus path'}: \`${formatTargetPath(normalizedPath, focusKind)}\``,
    launchContextLine,
    scopeLine,
  ];

  if (options.testTarget) {
    parts.push(
      `Test target: \`${formatTargetPath(options.testTarget.path, options.testTarget.kind)}\` — you may create and modify test files here.`,
    );
  }

  if ((options.supportTargets?.length ?? 0) > 0) {
    parts.push('', '### Support context');
    for (const target of options.supportTargets ?? []) {
      parts.push(`- ${formatSupportTarget(target, normalizedPath, focusKind, options.testTarget)}`);
    }
  }

  return parts.join('\n');
}

/**
 * Append the shared focus scope block to a prompt parts array when a focus path
 * is active. No-op when no path is set.
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

function formatTargetPath(targetPath: string, kind: FocusTargetKind): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    return '.';
  }
  return kind === 'directory' && !trimmed.endsWith('/')
    ? `${trimmed}/`
    : trimmed;
}
