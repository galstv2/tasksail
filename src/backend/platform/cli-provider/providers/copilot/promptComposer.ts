import { readFileSync } from 'node:fs';
import path from 'node:path';

import type {
  AgentConfigPaths,
  PromptMaterializationOptions,
  PromptMaterializationResult,
  ProviderPromptKind,
} from '../../types.js';
import { isInlineAgentContext } from './launchContext.js';

const PROMPT_FILES: Record<ProviderPromptKind, string> = {
  'plan-task': 'plan-task.prompt.md',
  'start-task': 'start-task.prompt.md',
  'execute-task': 'execute-task.prompt.md',
  'execute-task-retry': 'execute-task-retry.prompt.md',
  'continue-task': 'continue-task.prompt.md',
  'close-task': 'close-task.prompt.md',
};

export function resolveCopilotPromptPath(kind: ProviderPromptKind, paths: AgentConfigPaths): string {
  return path.join(paths.prompts, PROMPT_FILES[kind]);
}

function readRepoText(repoRoot: string, relativePath: string | undefined | null): string | undefined {
  if (!relativePath) {
    return undefined;
  }

  try {
    return readFileSync(path.join(repoRoot, relativePath), 'utf-8').trim();
  } catch {
    return undefined;
  }
}

export function materializeCopilotPrompt(
  options: PromptMaterializationOptions,
  paths: AgentConfigPaths,
): PromptMaterializationResult {
  const inlineAgentContext = isInlineAgentContext(options.launchContext);

  if (!inlineAgentContext) {
    return {
      effectivePrompt: options.prompt,
      inlineAgentContext,
    };
  }

  const globalInstructions = options.includeGlobalInstructions
    ? readRepoText(options.launchContext.repoRoot, paths.globalInstructions)
    : undefined;
  const agentProfile = readRepoText(options.launchContext.repoRoot, options.profile.agentProfilePath);
  const instructions = readRepoText(options.launchContext.repoRoot, options.profile.instructionPath);

  return {
    effectivePrompt: [globalInstructions, agentProfile, instructions, options.prompt]
      .filter((part): part is string => Boolean(part))
      .join('\n\n---\n\n'),
    inlineAgentContext,
  };
}
