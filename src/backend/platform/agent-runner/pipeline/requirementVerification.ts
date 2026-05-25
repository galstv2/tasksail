import path from 'node:path';
import { readTextFile, writeTextFile } from '../../core/io.js';
import { parseSections } from '../../workflow-policy/artifacts.js';
import {
  parseRequirementVerificationStatus,
  sortedRequirementIds,
  stripCommentsAndFences,
} from '../../workflow-policy/requirementVerification.js';

const CLOSEOUT_OWNER_AGENT_ID_SECTION = 'Closeout Owner Agent ID';
const REQUIREMENT_VERIFICATION_SECTION = 'Requirement Verification';

function generatedRequirementIdsFromSpec(text: string | undefined): string[] | null {
  if (!text?.trim()) {
    return null;
  }
  const sections = parseSections(text);
  const intakeRequirements = sections['Intake Requirements'];
  if (!intakeRequirements) {
    return null;
  }
  return sortedRequirementIds(intakeRequirements.join('\n'));
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

function idsFromBody(body: string): string[] {
  return sortedRequirementIds(body);
}

function renderChecklist(ids: readonly string[]): string {
  if (ids.length === 0) {
    return 'None';
  }
  return ids.flatMap((id) => [
    `<!-- You need to populate the ${id} line below by changing pending to verified or advisory and adding concise evidence. If ${id} is unmet, write a blocking issues.md finding and stop closeout instead. -->`,
    `- ${id}: pending`,
  ]).join('\n');
}

function ensureCloseoutOwnerAgentId(finalSummary: string): string {
  const existingBody = sectionBody(finalSummary, CLOSEOUT_OWNER_AGENT_ID_SECTION);
  if (stripCommentsAndFences(existingBody ?? '').trim() === 'qa') {
    return finalSummary;
  }
  return replaceSectionBody(finalSummary, CLOSEOUT_OWNER_AGENT_ID_SECTION, 'qa');
}

function shouldPreserveRequirementVerification(body: string, generatedIds: readonly string[]): boolean {
  const existingIds = idsFromBody(body);
  if (existingIds.length !== generatedIds.length || existingIds.some((id, index) => id !== generatedIds[index])) {
    return false;
  }
  return generatedIds.every((id) => {
    const status = parseRequirementVerificationStatus(body.split(/\r?\n/), id);
    return status === 'verified' || status === 'advisory';
  });
}

export async function prepopulateRequirementVerification(options: {
  handoffsDir: string;
  repoRoot: string;
}): Promise<void> {
  // Ron owns QA findings and closeout content. The platform owns invariant
  // final-summary metadata and generated requirement checklist seeding.
  const specText = await readTextFile(path.join(options.handoffsDir, 'implementation-spec.md'));
  const generatedIds = generatedRequirementIdsFromSpec(specText);

  const finalSummaryPath = path.join(options.handoffsDir, 'final-summary.md');
  let finalSummary = await readTextFile(finalSummaryPath);
  if (finalSummary === undefined) {
    finalSummary = await readTextFile(path.join(options.repoRoot, 'AgentWorkSpace', 'templates', 'final-summary.md')) ?? '# Final Summary\n\n## Requirement Verification\n';
  }

  let nextFinalSummary = ensureCloseoutOwnerAgentId(finalSummary);
  if (generatedIds === null) {
    if (nextFinalSummary !== finalSummary) {
      await writeTextFile(finalSummaryPath, nextFinalSummary);
    }
    return;
  }

  const existingBody = sectionBody(nextFinalSummary, REQUIREMENT_VERIFICATION_SECTION);
  const nonCommentBody = stripCommentsAndFences(existingBody ?? '').trim();
  if (generatedIds.length === 0) {
    if (existingBody === null || nonCommentBody.length === 0) {
      nextFinalSummary = replaceSectionBody(nextFinalSummary, REQUIREMENT_VERIFICATION_SECTION, 'None');
    }
    if (nextFinalSummary !== finalSummary) {
      await writeTextFile(finalSummaryPath, nextFinalSummary);
    }
    return;
  }

  if (existingBody !== null && shouldPreserveRequirementVerification(existingBody, generatedIds)) {
    if (nextFinalSummary !== finalSummary) {
      await writeTextFile(finalSummaryPath, nextFinalSummary);
    }
    return;
  }

  nextFinalSummary = replaceSectionBody(nextFinalSummary, REQUIREMENT_VERIFICATION_SECTION, renderChecklist(generatedIds));
  if (nextFinalSummary !== finalSummary) {
    await writeTextFile(finalSummaryPath, nextFinalSummary);
  }
}
