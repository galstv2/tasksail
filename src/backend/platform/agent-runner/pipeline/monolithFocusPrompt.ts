interface MonolithFocusPromptOptions {
  launchContextLine?: string;
  scopeLine?: string;
}

/**
 * Build the shared monolith focus scope block for runtime prompt overrides.
 * Returns undefined when no focus path is active so existing distributed/no-focus
 * prompt behavior remains unchanged.
 */
export function buildMonolithFocusScopeBlock(
  primaryFocusRelativePath?: string,
  options: MonolithFocusPromptOptions = {},
): string | undefined {
  const normalizedPath = primaryFocusRelativePath?.trim();
  if (!normalizedPath) {
    return undefined;
  }

  const launchContextLine = options.launchContextLine
    ?? 'Your launch CWD is already this folder.';
  const scopeLine = options.scopeLine
    ?? 'Sibling folders may be read for context, but implementation changes must stay within the selected focus area.';

  return [
    '## Monolith Focus Scope',
    '',
    'You are working inside a monolith repository.',
    `Primary focus path: \`${normalizedPath}\``,
    launchContextLine,
    scopeLine,
  ].join('\n');
}

/**
 * Append the monolith focus scope block to a prompt parts array when a focus
 * path is active. No-op when no path is set.
 */
export function appendFocusBlock(
  parts: string[],
  primaryFocusRelativePath?: string,
  options?: MonolithFocusPromptOptions,
): void {
  const block = buildMonolithFocusScopeBlock(primaryFocusRelativePath, options);
  if (block) {
    parts.push(block, '');
  }
}
