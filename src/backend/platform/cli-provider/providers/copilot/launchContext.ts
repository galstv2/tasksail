import path from 'node:path';

import type { AgentLaunchContext } from '../../types.js';

/**
 * Copilot inlines the agent profile into the prompt body whenever the launch
 * CWD is not the repo root. The CLI's agent registry is anchored at the repo
 * root, so a non-repo-root CWD cannot see `--agent <id>` resolution.
 *
 * Shared between flagBuilder (which suppresses the `--agent` flag) and
 * promptComposer (which prepends the profile content) so both sides can never
 * disagree on whether inlining is required.
 */
export function isInlineAgentContext(launchContext: AgentLaunchContext): boolean {
  return path.resolve(launchContext.requestedCwd) !== path.resolve(launchContext.repoRoot);
}
