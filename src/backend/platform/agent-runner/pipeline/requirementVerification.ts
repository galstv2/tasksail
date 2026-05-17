import path from 'node:path';
import { readTextFile, writeTextFile } from '../../core/io.js';
import { parseSections } from '../../workflow-policy/artifacts.js';

const REQUIREMENT_ID_PATTERN = /\b(?:CR|COMP|VAL)-\d{3}\b/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const FENCE_OPEN_RE = /^(```|~~~)/;

function stripCommentsAndFences(text: string): string {
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

function generatedRequirementIdsFromSpec(text: string | undefined): string[] | null {
  if (!text?.trim()) {
    return null;
  }
  const sections = parseSections(text);
  const intakeRequirements = sections['Intake Requirements'];
  if (!intakeRequirements) {
    return null;
  }
  return [...new Set(stripCommentsAndFences(intakeRequirements.join('\n')).match(REQUIREMENT_ID_PATTERN) ?? [])].sort();
}

function sectionBody(text: string, sectionName: string): string | null {
  const match = new RegExp(`^##\\s+${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').exec(text);
  if (!match || match.index === undefined) {
    return null;
  }
  const bodyStart = match.index + match[0].length;
  const next = /^##\s+.*$/m.exec(text.slice(bodyStart));
  const bodyEnd = next?.index === undefined ? text.length : bodyStart + next.index;
  return text.slice(bodyStart, bodyEnd);
}

function replaceSectionBody(text: string, sectionName: string, body: string): string {
  const heading = `## ${sectionName}`;
  const match = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').exec(text);
  if (!match || match.index === undefined) {
    const suffix = text.endsWith('\n') ? '' : '\n';
    return `${text}${suffix}\n${heading}\n${body.trimEnd()}\n`;
  }
  const bodyStart = match.index + match[0].length;
  const next = /^##\s+.*$/m.exec(text.slice(bodyStart));
  const bodyEnd = next?.index === undefined ? text.length : bodyStart + next.index;
  return `${text.slice(0, bodyStart)}\n${body.trimEnd()}\n\n${text.slice(bodyEnd).replace(/^\n+/, '')}`;
}

function parseStatusForId(body: string, id: string): string | null {
  const pattern = new RegExp(`\\b${id}:\\s*(.*)$`);
  const match = stripCommentsAndFences(body)
    .split(/\r?\n/)
    .map((candidate) => pattern.exec(candidate))
    .find((candidate) => candidate !== null);
  if (!match) {
    return null;
  }
  const afterId = (match[1] ?? '').trim();
  if (afterId.includes(' - ')) {
    return afterId.split(' - ')[0]!.trim().toLowerCase();
  }
  const lowered = afterId.toLowerCase();
  if (lowered.startsWith('not met')) {
    return 'not met';
  }
  return lowered.split(/\s+/)[0] ?? null;
}

function idsFromBody(body: string): string[] {
  return [...new Set(stripCommentsAndFences(body).match(REQUIREMENT_ID_PATTERN) ?? [])].sort();
}

function renderChecklist(ids: readonly string[]): string {
  if (ids.length === 0) {
    return 'None';
  }
  return [
    '<!-- Platform-generated from implementation-spec.md ## Intake Requirements. Do not delete IDs. Ron: replace pending with verified or advisory and add evidence. -->',
    ...ids.map((id) => `- ${id}: pending - Ron must verify before pass/advisory closeout.`),
  ].join('\n');
}

function shouldPreserveRequirementVerification(body: string, generatedIds: readonly string[]): boolean {
  const existingIds = idsFromBody(body);
  if (existingIds.length !== generatedIds.length || existingIds.some((id, index) => id !== generatedIds[index])) {
    return false;
  }
  return generatedIds.every((id) => {
    const status = parseStatusForId(body, id);
    return status === 'verified' || status === 'advisory';
  });
}

export async function prepopulateRequirementVerification(options: {
  handoffsDir: string;
  repoRoot: string;
}): Promise<void> {
  const specText = await readTextFile(path.join(options.handoffsDir, 'implementation-spec.md'));
  const generatedIds = generatedRequirementIdsFromSpec(specText);
  if (generatedIds === null) {
    return;
  }

  const finalSummaryPath = path.join(options.handoffsDir, 'final-summary.md');
  let finalSummary = await readTextFile(finalSummaryPath);
  if (finalSummary === undefined) {
    finalSummary = await readTextFile(path.join(options.repoRoot, 'AgentWorkSpace', 'templates', 'final-summary.md')) ?? '# Final Summary\n\n## Requirement Verification\n';
  }

  const existingBody = sectionBody(finalSummary, 'Requirement Verification');
  const nonCommentBody = stripCommentsAndFences(existingBody ?? '').trim();
  if (generatedIds.length === 0) {
    if (existingBody === null || nonCommentBody.length === 0) {
      await writeTextFile(finalSummaryPath, replaceSectionBody(finalSummary, 'Requirement Verification', 'None'));
    }
    return;
  }

  if (existingBody !== null && shouldPreserveRequirementVerification(existingBody, generatedIds)) {
    return;
  }

  await writeTextFile(
    finalSummaryPath,
    replaceSectionBody(finalSummary, 'Requirement Verification', renderChecklist(generatedIds)),
  );
}
