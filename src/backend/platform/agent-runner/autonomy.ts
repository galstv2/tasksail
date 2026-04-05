import path from 'node:path';
import type { AgentProfile, CopilotArgs } from './types.js';
import type { AutonomyProfile } from '../core/index.js';
import { resolveActiveModel } from './metadata.js';

/**
 * Hardcoded deny-tool floor for repo-executor agents.
 * Always applied regardless of registry.json deny_rules.
 */
const REPO_EXECUTOR_DENY_FLOOR: readonly string[] = [
  'shell(git add)',
  'shell(git commit)',
  'shell(git push)',
  'shell(gh pr create)',
  'shell(rm:*)',
  'shell(sudo)',
  'shell(su)',
  'shell(doas)',
  'shell(chown:*)',
];

/** Blanket shell deny for artifact-author agents — no shell access at all. */
const ARTIFACT_AUTHOR_DENY_FLOOR: readonly string[] = ['shell'];

/** Profiles that get shell access and the repo-executor deny floor. */
function hasShellAccess(profile: AutonomyProfile): boolean {
  return profile === 'repo-executor' || profile === 'qa-executor';
}

function shouldAddContextPackDir(profile: AgentProfile): boolean {
  return profile.id !== 'lily';
}

/**
 * Resolve the autonomy profile into copilot CLI arguments.
 *
 * repo-executor (SWE + SDET):
 *   --allow-all-tools --no-ask-user, confined to context pack,
 *   --disallow-temp-dir when context-pack boundary is active.
 *
 * qa-executor (QA):
 *   --allow-all-tools --no-ask-user, same deny floor as repo-executor,
 *   handoff dir access but not ImplementationSteps.
 *
 * artifact-author (PM, Architect, SDM, Docs, Planning):
 *   --no-ask-user --allow-tool write --deny-tool shell,
 *   no --allow-all-tools.
 */
export function resolveAutonomyProfile(
  profile: AgentProfile,
  contextPackDir?: string,
  repoRoot?: string,
): CopilotArgs {
  const allowTools: string[] = [];
  const denyTools: string[] = [];
  const allowedDirs: string[] = [];
  const additionalFlags: string[] = [];

  if (hasShellAccess(profile.autonomyProfile)) {
    // repo-executor / qa-executor: all tools, no user prompts
    additionalFlags.push('--allow-all-tools', '--no-ask-user');
  } else {
    // artifact-author: restricted tool set, still autonomous (no user prompts)
    additionalFlags.push('--no-ask-user');
    allowTools.push('write');
    for (const rule of ARTIFACT_AUTHOR_DENY_FLOOR) {
      denyTools.push(rule);
    }
  }

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

  // qa-executor (Ron) needs handoff dir access for writing issues.md, final-summary.md, etc.
  // repo-executor (Dalton) receives all context via prompt and writes no platform artifacts.
  if (profile.autonomyProfile === 'qa-executor' && repoRoot) {
    allowedDirs.push(path.join(repoRoot, 'AgentWorkSpace', 'handoffs'));
  }

  // Context-pack boundary enforcement: disallow temp dir to prevent
  // agents from escaping the context-pack-scoped filesystem.
  if (contextPackDir) {
    additionalFlags.push('--disallow-temp-dir');
  }

  // Hardcoded deny-tool floor for repo-executor and qa-executor — cannot be removed by registry edits.
  if (hasShellAccess(profile.autonomyProfile)) {
    for (const rule of REPO_EXECUTOR_DENY_FLOOR) {
      denyTools.push(rule);
    }
  }

  // Merge registry-defined deny rules (additive, deduplicated).
  if (profile.denyRules) {
    for (const rule of profile.denyRules) {
      if (!denyTools.includes(rule)) {
        denyTools.push(rule);
      }
    }
  }

  const model = resolveActiveModel(profile.id, profile);

  return {
    model,
    allowTools,
    denyTools,
    allowedDirs,
    additionalFlags,
  };
}

/**
 * Build the full copilot CLI command-line argument array.
 */
export function buildCopilotArgs(
  profile: AgentProfile,
  autonomyArgs: CopilotArgs,
  options?: { skipAgentFlag?: boolean },
): string[] {
  const args: string[] = options?.skipAgentFlag ? [] : ['--agent', profile.registryId];

  if (autonomyArgs.model) {
    args.push('--model', autonomyArgs.model);
  }

  for (const flag of autonomyArgs.additionalFlags) {
    args.push(flag);
  }

  for (const tool of autonomyArgs.allowTools) {
    args.push('--allow-tool', tool);
  }

  for (const tool of autonomyArgs.denyTools) {
    args.push('--deny-tool', tool);
  }

  for (const dir of autonomyArgs.allowedDirs) {
    args.push('--add-dir', dir);
  }
  return args;
}

/**
 * Format copilot CLI arguments as a single readable command string for logging.
 */
export function formatCopilotCommand(args: string[]): string {
  return ['copilot', ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
}
