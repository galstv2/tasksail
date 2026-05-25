const REQUIREMENT_ID_PATTERN = /\b(?:CR|COMP|VAL)-\d{3}\b/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const FENCE_OPEN_RE = /^(```|~~~)/;

export type RequirementVerificationStatus =
  | 'verified'
  | 'advisory'
  | 'pending'
  | 'blocked'
  | 'unmet'
  | 'failed'
  | 'not met';

export function stripCommentsAndFences(text: string): string {
  const withoutComments = text.replace(HTML_COMMENT_RE, '');
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of withoutComments.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    const match = FENCE_OPEN_RE.exec(trimmed);
    if (match?.[1]) {
      fence = match[1];
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

export function sortedRequirementIds(text: string): string[] {
  return [...new Set(stripCommentsAndFences(text).match(REQUIREMENT_ID_PATTERN) ?? [])].sort();
}

export function parseRequirementVerificationStatus(
  lines: readonly string[],
  id: string,
): RequirementVerificationStatus | null {
  const sanitized = stripCommentsAndFences(lines.join('\n'));
  const idPattern = new RegExp(`\\b${id}\\b`, 'i');
  for (const line of sanitized.split(/\r?\n/)) {
    const idMatch = idPattern.exec(line);
    if (!idMatch) {
      continue;
    }
    const lowered = line
      .slice((idMatch.index ?? 0) + idMatch[0].length)
      .toLowerCase()
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const candidates: Array<{ status: RequirementVerificationStatus; pattern: RegExp }> = [
      { status: 'not met', pattern: /\bnot\s+(?:met|verified|satisfied)\b/ },
      { status: 'verified', pattern: /\bverified\b/ },
      { status: 'advisory', pattern: /\badvisory\b/ },
      { status: 'pending', pattern: /\bpending\b/ },
      { status: 'blocked', pattern: /\bblocked\b/ },
      { status: 'unmet', pattern: /\bunmet\b/ },
      { status: 'failed', pattern: /\bfailed\b/ },
    ];
    const firstStatus = candidates
      .map(({ status, pattern }) => {
        const match = pattern.exec(lowered);
        return match ? { status, index: match.index } : null;
      })
      .filter((candidate): candidate is { status: RequirementVerificationStatus; index: number } => candidate !== null)
      .sort((left, right) => left.index - right.index)[0];
    if (firstStatus) {
      if (
        firstStatus.status === 'verified'
        && /\bnot\s+$/.test(lowered.slice(0, firstStatus.index))
      ) {
        return 'not met';
      }
      return firstStatus.status;
    }
  }
  return null;
}
