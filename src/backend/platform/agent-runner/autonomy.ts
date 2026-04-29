import path from 'node:path';
import type { AgentProfile } from './types.js';
import { resolveActiveModel } from './metadata.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type {
  AutonomyIntent,
  BuildArgsOptions,
  BuildArgsResult,
} from '../cli-provider/index.js';

function shouldAddContextPackDir(profile: AgentProfile): boolean {
  return profile.id !== 'lily';
}

/**
 * Resolve the platform autonomy profile into provider-neutral launch intent.
 */
export function resolveAutonomyProfile(
  profile: AgentProfile,
  contextPackDir?: string,
  repoRoot?: string,
): AutonomyIntent {
  const allowedDirs: string[] = [];

  // Resolve all allowed dirs to absolute paths — CWD may differ from repoRoot
  // for repo-executor agents, so relative paths must be anchored to repoRoot.
  const resolveDir = (dir: string): string =>
    path.isAbsolute(dir) ? dir : path.resolve(repoRoot ?? '.', dir);

  if (profile.allowedDirs) {
    for (const dir of profile.allowedDirs) {
      allowedDirs.push(resolveDir(dir));
    }
  }

  if (contextPackDir && shouldAddContextPackDir(profile)) {
    allowedDirs.push(resolveDir(contextPackDir));
  }

  // Per-task --add-dir scoping (handoffs, ImplementationSteps) is applied in
  // roleAgent.ts after this resolver runs, so that the taskId-narrowing logic
  // lives next to the rest of the launch-time filesystem boundary handling.
  // Keep this resolver pure: profile-level dirs + context pack only.

  // Context-pack boundary enforcement: disallow temp dir to prevent
  // agents from escaping the context-pack-scoped filesystem.
  const model = resolveActiveModel(profile.id, profile);

  return {
    model,
    allowedDirs,
    autonomyProfile: profile.autonomyProfile,
    disallowTempDir: Boolean(contextPackDir),
  };
}

/**
 * Build the provider-resolved agent CLI argument array and launch metadata.
 */
export function buildAgentArgs(
  repoRoot: string,
  profile: AgentProfile,
  intent: AutonomyIntent,
  options: BuildArgsOptions,
): BuildArgsResult {
  return getActiveProvider(repoRoot).buildArgs(profile, intent, options);
}

/**
 * Format agent CLI arguments as a single readable command string for logging.
 */
export function formatAgentCommand(repoRoot: string, args: string[]): string {
  return getActiveProvider(repoRoot).formatCommand(args);
}
