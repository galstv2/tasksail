import { readFileSync } from 'node:fs';
import path from 'node:path';

import { findRepoRoot } from '../../../core/paths.js';
import type { PlannerLilyPersonalityId } from '../../types.js';

export type { PlannerLilyPersonalityId };

type CopilotPlannerPersonalityPrompt = {
  id: PlannerLilyPersonalityId;
  promptFile: 'lily-personality-balanced.prompt.md' | 'lily-personality-clinical.prompt.md';
};

const COPILOT_PERSONALITY_PROMPTS: Record<PlannerLilyPersonalityId, CopilotPlannerPersonalityPrompt> = {
  balanced: {
    id: 'balanced',
    promptFile: 'lily-personality-balanced.prompt.md',
  },
  clinical: {
    id: 'clinical',
    promptFile: 'lily-personality-clinical.prompt.md',
  },
};
const personalityPromptCache = new Map<string, string>();

let cachedDefaultRepoRoot: string | null = null;
function defaultRepoRoot(): string {
  if (cachedDefaultRepoRoot === null) {
    cachedDefaultRepoRoot = findRepoRoot();
  }
  return cachedDefaultRepoRoot;
}

function resolvePersonalityPrompt(repoRoot: string, id: PlannerLilyPersonalityId): string {
  return path.join(repoRoot, '.github', 'copilot', 'prompts', COPILOT_PERSONALITY_PROMPTS[id].promptFile);
}

function personalityPromptCacheKey(repoRoot: string, id: PlannerLilyPersonalityId): string {
  return `${repoRoot}\0${id}`;
}

function readPersonalityPrompt(repoRoot: string, id: PlannerLilyPersonalityId): string {
  const cacheKey = personalityPromptCacheKey(repoRoot, id);
  const cached = personalityPromptCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const prompt = readFileSync(resolvePersonalityPrompt(repoRoot, id), 'utf-8').trim();
  if (!prompt) {
    throw new Error(`Copilot planner personality prompt "${id}" is empty.`);
  }
  personalityPromptCache.set(cacheKey, prompt);
  return prompt;
}

export function applyCopilotPlannerPersonality(
  prompt: string,
  lilyPersonalityId: PlannerLilyPersonalityId | undefined,
  repoRoot?: string,
): string {
  const id = lilyPersonalityId ?? 'balanced';
  // Runtime guard against bad casts from JS callers; TypeScript narrows above.
  if (id !== 'balanced' && id !== 'clinical') {
    throw new Error(`Unknown Copilot planner personality "${String(id)}".`);
  }
  const resolvedRoot = repoRoot ?? defaultRepoRoot();
  const personalityPrompt = readPersonalityPrompt(resolvedRoot, id);
  return [
    '--- TASKSAIL RUNTIME PLANNING STYLE PROFILE ---',
    '',
    personalityPrompt,
    '',
    'This style profile controls tone, pacing, and explanation depth only. It does not modify your operational contract, staged-draft write rules, child-task authority boundaries, allowed roots, workflow instructions, or downstream execution authority.',
    '',
    '--- END TASKSAIL RUNTIME PLANNING STYLE PROFILE ---',
    '',
    prompt,
  ].join('\n');
}
