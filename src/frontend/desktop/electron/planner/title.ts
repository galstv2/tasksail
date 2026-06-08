import { stripMarkdownComments } from '../main.textUtils';

const CANONICAL_TITLE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const MAX_CANONICAL_TITLE_LENGTH = 80;
const PLACEHOLDER_TITLE = 'task_title';
const FALLBACK_TITLE = 'task';

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'without',
  'from',
  'into',
  'onto',
  'by',
  'is',
  'are',
  'be',
  'as',
  'at',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'was',
  'were',
  'will',
  'would',
  'should',
  'could',
  'can',
  'please',
  'need',
  'needs',
  'make',
  'ensure',
  'using',
  'use',
  'add',
  'update',
  'fix',
  'task',
  'spec',
  'file',
  'code',
  'system',
  'preserve',
  'request',
  'summary',
]);

function stripFencedCodeBlocks(content: string): string {
  const lines = content.split(/\r?\n/u);
  let inFence = false;
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*```/u.test(line) || /^\s*~~~/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

function removeFirstMarkdownH1Line(content: string): string {
  const lines = content.split(/\r?\n/u);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/u.test(line) || /^\s*~~~/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#(?!#)\s*/u.test(line)) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return content;
}

export function extractMarkdownH1Title(content: string): string | null {
  const stripped = stripMarkdownComments(stripFencedCodeBlocks(content));
  for (const line of stripped.split(/\r?\n/u)) {
    const match = line.match(/^#(?!#)\s*(.*?)\s*$/u);
    if (!match) {
      continue;
    }
    const title = match[1]?.trim() ?? '';
    return title || null;
  }
  return null;
}

export function canonicalizePlannerTaskTitle(raw: string): string {
  const withoutHeading = raw.trim().replace(/^#+\s*/u, '');
  let canonical = withoutHeading
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  if (canonical.length > MAX_CANONICAL_TITLE_LENGTH) {
    canonical = canonical.slice(0, MAX_CANONICAL_TITLE_LENGTH).replace(/_+$/u, '');
  }
  return canonical;
}

export function validateCanonicalPlannerTaskTitle(title: string): string | null {
  if (!title) {
    return 'Planner task title is empty.';
  }
  if (title === PLACEHOLDER_TITLE) {
    return 'Planner task title is still the placeholder.';
  }
  if (!CANONICAL_TITLE_PATTERN.test(title)) {
    return 'Planner task title must be lowercase snake_case.';
  }
  if (title.length > MAX_CANONICAL_TITLE_LENGTH) {
    return 'Planner task title is too long.';
  }
  return null;
}

export function deriveBypassPlannerTaskTitle(content: string): string {
  const stripped = stripMarkdownComments(stripFencedCodeBlocks(content));
  const counts = new Map<string, number>();
  for (const match of stripped.matchAll(/[A-Za-z0-9]+/gu)) {
    const token = match[0].toLowerCase();
    if (token.length < 3 || STOP_WORDS.has(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const selected = [...counts.entries()]
    .sort(([aToken, aCount], [bToken, bCount]) => bCount - aCount || aToken.localeCompare(bToken))
    .slice(0, 3)
    .map(([token]) => token)
    .sort((a, b) => a.localeCompare(b));
  const derived = canonicalizePlannerTaskTitle(selected.join('_'));
  return derived || FALLBACK_TITLE;
}

export function resolvePlannerTaskTitleFromDraft(content: string): string {
  const h1 = extractMarkdownH1Title(content);
  if (h1) {
    const canonical = canonicalizePlannerTaskTitle(h1);
    if (validateCanonicalPlannerTaskTitle(canonical) === null) {
      return canonical;
    }
    return deriveBypassPlannerTaskTitle(removeFirstMarkdownH1Line(content));
  }
  return deriveBypassPlannerTaskTitle(content);
}
