import type {
  AutonomyIntent,
  BuildArgsOptions,
  BuildArgsResult,
  ProviderAgentProfile,
} from '../../types.js';
import { normalizeReasoningEffort } from '../../reasoningEffort.js';
import { ARTIFACT_AUTHOR_DENY_FLOOR, REPO_EXECUTOR_DENY_FLOOR, hasShellAccess } from './denyRules.js';
import { isInlineAgentContext } from './launchContext.js';

function addUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

export function buildCopilotArgs(
  profile: ProviderAgentProfile,
  intent: AutonomyIntent,
  options: BuildArgsOptions,
): BuildArgsResult {
  const allowTools: string[] = [];
  const denyTools: string[] = [];
  const additionalFlags: string[] = [];

  if (hasShellAccess(intent.autonomyProfile)) {
    additionalFlags.push('--allow-all-tools', '--no-ask-user');
    addUnique(denyTools, REPO_EXECUTOR_DENY_FLOOR);
  } else {
    additionalFlags.push('--no-ask-user');
    allowTools.push('write');
    addUnique(denyTools, ARTIFACT_AUTHOR_DENY_FLOOR);
  }

  if (intent.disallowTempDir) {
    additionalFlags.push('--disallow-temp-dir');
  }

  if (profile.denyRules) {
    addUnique(denyTools, profile.denyRules);
  }

  const inlineAgentContext = isInlineAgentContext(options.launchContext);
  const args: string[] = inlineAgentContext ? [] : ['--agent', profile.registryId];

  if (intent.model) {
    args.push('--model', intent.model);
  }
  const reasoningEffort = normalizeReasoningEffort(intent.reasoningEffort);
  if (reasoningEffort) {
    args.push('--effort', reasoningEffort);
  }

  for (const flag of additionalFlags) {
    args.push(flag);
  }

  for (const tool of allowTools) {
    args.push('--allow-tool', tool);
  }

  for (const tool of denyTools) {
    args.push('--deny-tool', tool);
  }

  for (const dir of intent.allowedDirs) {
    args.push('--add-dir', dir);
  }

  return {
    args,
    launchCwd: options.launchContext.requestedCwd,
    inlineAgentContext,
    resolvedToolPolicy: {
      allowAllTools: additionalFlags.includes('--allow-all-tools'),
      noAskUser: additionalFlags.includes('--no-ask-user'),
      allowTools,
      denyTools,
    },
  };
}

export function formatCopilotCommand(args: string[]): string {
  return ['copilot', ...args].map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ');
}

export function mcpConfigArgs(configFilePath: string): string[] {
  return ['--additional-mcp-config', `@${configFilePath}`];
}
