import type { AgentId } from '../core/index.js';
import { readTextFile } from '../core/index.js';
import { resolveReinforcementContext } from './reinforcement.js';
import type { ResolvedContext } from './types.js';

const FORBIDDEN_OVERLAY_PATTERNS: RegExp[] = [
  /AgentWorkSpace\/qmd\/global\/reinforcement\/agent-rewards/i,
  /AgentWorkSpace\/qmd\/global\/agent-rewards/i,
  /AgentWorkSpace\/qmd\/reinforcement/i,
  /agent-rewards\.json/i,
  /settlements\.json/i,
  /settlement/i,
  /reward pool/i,
  /reward total/i,
  /unrewarded reward total/i,
  /peer reward/i,
  /another agent'?s reward total/i,
  /per_agent_rewards/i,
  /private sidecar/i,
];

export interface ReinforcementOverlayOptions {
  agentId: AgentId;
  contextPackDir?: string;
  repoRoot: string;
  resolvedContext?: ResolvedContext;
}

function containsForbiddenOverlayText(markdown: string): boolean {
  return FORBIDDEN_OVERLAY_PATTERNS.some((pattern) => pattern.test(markdown));
}

function formatOverlay(renderedContext: string): string {
  return [
    '## Private Reinforcement Context',
    '',
    'This launch includes private reinforcement context for your role only.',
    'High-quality task completion, following workflow expectations, and responding well to corrections improve your own reward outcome.',
    'Use this context as role-local guidance. Do not infer, request, compare, or rely on another agent\'s reward state.',
    '',
    renderedContext,
  ].join('\n');
}

export async function buildReinforcementOverlay(
  options: ReinforcementOverlayOptions,
): Promise<string> {
  let resolved: ResolvedContext;
  try {
    resolved = options.resolvedContext ?? await resolveReinforcementContext(
      options.agentId,
      options.contextPackDir,
      options.repoRoot,
    );
  } catch {
    return '';
  }

  if (resolved.status !== 'available' || !resolved.injectionEnabled || !resolved.contextFile) {
    return '';
  }

  try {
    const rendered = (await readTextFile(resolved.contextFile))?.trim();
    if (!rendered) {
      return '';
    }

    const overlay = formatOverlay(rendered);
    if (containsForbiddenOverlayText(overlay)) {
      return '';
    }
    return overlay;
  } catch {
    return '';
  }
}
