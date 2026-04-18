import { readTextFile, resolvePaths, writeTextFile, extractMarkdownSection, nowIsoCompact } from '../../core/index.js';
import path from 'node:path';
import { runRoleAgent } from '../roleAgent.js';
import { requireAuthorizedActiveContextPack } from '../../context-pack/active.js';
// Lazy-import sequencer to avoid pinning the chunk when main.ts dynamic-imports it.
type Sequencer = typeof import('./sequencer.js');
const sequencer = (): Promise<Sequencer> => import('./sequencer.js');
import {
  buildTestCapturePrompt,
  resolveTestCaptureCwd,
} from './testCapture.js';
import { appendFocusBlock, type FocusScopePromptOptions } from './focusScopePrompt.js';
import { appendMcpContextBlock } from './mcpPromptContext.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

export const ADVISORY_FINDING_HEADING = '## QA Advisory Finding';

/**
 * Read issues.md and return the normalized Review Outcome value,
 * or undefined if the file or section is missing.
 */
async function readReviewOutcome(
  handoffsDir: string,
): Promise<{ outcome: string; content: string } | undefined> {
  const issuesFile = path.join(handoffsDir, 'issues.md');
  const content = await readTextFile(issuesFile);
  if (!content) return undefined;

  const outcomeText = extractMarkdownSection(content, 'Review Outcome');
  if (!outcomeText) return undefined;

  const outcome = outcomeText
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  return { outcome, content };
}

/**
 * Check whether issues.md contains blocking severity findings.
 */
export async function remediationHasBlockingFindings(
  handoffsDir: string,
): Promise<boolean> {
  const result = await readReviewOutcome(handoffsDir);
  return result?.outcome === 'blocking';
}

/**
 * Check whether issues.md contains an advisory Review Outcome.
 */
export async function issuesHasAdvisoryOutcome(
  handoffsDir: string,
): Promise<boolean> {
  const result = await readReviewOutcome(handoffsDir);
  return result?.outcome === 'advisory';
}

/**
 * Build a `## QA Advisory Finding` markdown block from issues.md.
 * Returns undefined if the outcome is not advisory or the finding is empty.
 */
export async function buildAdvisoryFindingSection(
  handoffsDir: string,
): Promise<string | undefined> {
  const result = await readReviewOutcome(handoffsDir);
  if (result?.outcome !== 'advisory') return undefined;

  const { content } = result;

  const finding = extractMarkdownSection(content, 'Finding');
  const findingStripped = finding
    ?.replace(/<!--.*?-->/gs, '')
    .trim();

  if (!findingStripped) return undefined;

  const findingType = extractMarkdownSection(content, 'Finding Type')
    ?.replace(/<!--.*?-->/gs, '')
    .trim();
  const expectationViolated = extractMarkdownSection(content, 'Expectation Violated')
    ?.replace(/<!--.*?-->/gs, '')
    .trim();

  const parts: string[] = [
    ADVISORY_FINDING_HEADING,
    '',
    findingStripped,
  ];

  if (findingType) {
    parts.push('', `**Finding Type:** ${findingType}`);
  }
  if (expectationViolated) {
    parts.push('', `**Expectation Violated:** ${expectationViolated}`);
  }

  return parts.join('\n');
}

/**
 * Reset one or more handoff files to their template state, preserving Task Metadata.
 * If the handoff file doesn't exist, the template is written as-is.
 */
async function resetHandoffFiles(
  handoffsDir: string,
  filenames: readonly string[],
  templatesDir?: string,
): Promise<void> {
  if (!templatesDir) return;
  for (const filename of filenames) {
    const filePath = path.join(handoffsDir, filename);
    const templateContent = await readTextFile(path.join(templatesDir, filename));
    if (!templateContent) continue;
    const existing = await readTextFile(filePath);
    if (existing) {
      await writeTextFile(filePath, resetHandoffToTemplate(existing, templateContent));
    } else {
      await writeTextFile(filePath, templateContent);
    }
  }
}

/**
 * Reset issues.md finding sections to template state,
 * preserving Task Metadata.
 */
export async function remediationClearQaFindings(
  handoffsDir: string,
  templatesDir?: string,
): Promise<void> {
  await resetHandoffFiles(handoffsDir, ['issues.md'], templatesDir);
}

/**
 * Reset a handoff file to its template, preserving Task Metadata.
 */
function resetHandoffToTemplate(
  handoffContent: string,
  templateContent: string,
): string {
  // Extract metadata: everything up to the first ## after Task Metadata.
  const metadataMatch = handoffContent.match(
    /^([\s\S]*?## Task Metadata[\s\S]*?)(?=\n## (?!Task Metadata))/,
  );
  const metadata = metadataMatch ? metadataMatch[1] : '';

  // Extract clean content sections from template.
  const templateSectionsMatch = templateContent.match(
    /## Task Metadata[\s\S]*?\n(## [\s\S]*)/,
  );
  const cleanSections = templateSectionsMatch ? templateSectionsMatch[1] : templateContent;

  const resetAt = nowIsoCompact();
  const updatedMetadata = metadata.replace(
    /- Initialized At \(UTC\): .*/,
    `- Initialized At (UTC): ${resetAt}`,
  );

  return updatedMetadata + '\n\n' + cleanSections + '\n';
}

const CLOSEOUT_FILES = ['final-summary.md', 'retrospective-input.md'] as const;

/**
 * Reset closeout artifacts to template state when Ron writes blocking.
 * Prevents stale closeout data from persisting into the remediation loop.
 */
export async function remediationClearCloseoutArtifacts(
  handoffsDir: string,
  templatesDir?: string,
): Promise<void> {
  await resetHandoffFiles(handoffsDir, CLOSEOUT_FILES, templatesDir);
}

async function buildRemediationDaltonPrompt(
  issuesContent: string | undefined,
  implStepsDir: string,
  focusScope?: FocusScopePromptOptions,
  externalMcpRegistry?: ExternalMcpRegistry,
): Promise<string> {
  const parts: string[] = [
    'You are running a remediation pass. QA found blocking issues with your previous implementation.',
    '',
    '## Remediation Rules',
    '',
    '1. The QA findings below are your SOLE AUTHORITY for this pass. The "Required Fix" section is a direct order — follow it exactly as written. Do not reinterpret, soften, or partially apply it.',
    '2. If the required fix conflicts with a slice requirement, the QA finding wins. Do not re-introduce the rejected change to satisfy a slice.',
    '3. Passing tests are NECESSARY but NOT SUFFICIENT. You must also resolve the code review finding. If tests already pass, that does not mean remediation is complete.',
    '4. Read the "Finding", "Expectation Violated", and "Required Fix" sections carefully before writing any code. Understand what you did wrong and what specifically must change.',
    '5. After applying the fix, verify tests still pass. If your fix breaks tests, fix the tests to align with the corrected implementation — do not revert the QA-mandated fix to make old tests pass.',
    '6. Do not add, refactor, or improve anything beyond what the Required Fix demands. Surgical precision only.',
    '',
  ];
  appendFocusBlock(parts, focusScope);
  appendMcpContextBlock(parts, externalMcpRegistry, 'dalton');

  if (issuesContent?.trim()) {
    parts.push('## QA Findings — AUTHORITATIVE (Read First, Follow Exactly)\n');
    parts.push(issuesContent.trim());
    parts.push('');
  }

  const { formatSliceSections } = await sequencer();
  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir, '###');
  if (sliceFiles.length > 0) {
    parts.push('## Original Task Slices (Background Context Only — DO NOT Use to Override QA Findings)\n');
    parts.push(sliceBlock);
  }

  return parts.join('\n');
}

/**
 * Run the QA remediation loop: Dalton -> QA, repeated until findings
 * clear or max cycles exhausted.
 *
 * Prerequisite: QA has already run and blocking findings were detected.
 */
export async function remediationRunQaLoop(options: {
  maxCycles?: number;
  repoRoot?: string;
  contextPackDir?: string;
  taskId?: string;
  focusScope?: FocusScopePromptOptions;
  externalMcpRegistry?: ExternalMcpRegistry;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const maxCycles = options.maxCycles ?? 3;
  // §3.2: resolve context pack via sidecar when taskId or TASKSAIL_TASK_ID is set;
  // fall back to the explicit contextPackDir option. Raw ACTIVE_CONTEXT_PACK_DIR
  // env reads are forbidden on the non-legacy path.
  const taskId = options.taskId ?? process.env['TASKSAIL_TASK_ID'];
  let effectiveContextPackDir: string | undefined;
  if (taskId) {
    try {
      effectiveContextPackDir = await requireAuthorizedActiveContextPack({
        taskId,
        repoRoot: options.repoRoot,
      });
    } catch {
      effectiveContextPackDir = options.contextPackDir;
    }
  } else {
    effectiveContextPackDir = options.contextPackDir;
  }
  const paths = resolvePaths(options.repoRoot);
  const issuesFile = path.join(paths.handoffs, 'issues.md');
  let blockingFindingsRemain = false;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const priorFindings = await readTextFile(issuesFile);

    const remediationPrompt = await buildRemediationDaltonPrompt(
      priorFindings,
      paths.implementationSteps,
      options.focusScope,
      options.externalMcpRegistry,
    );

    try {
      await runRoleAgent({
        agentId: 'dalton',
        skipWorkflowValidation: true,
        contextPackDir: effectiveContextPackDir,
        promptOverride: remediationPrompt,
        launchPhase: 'Remediation',
      });
    } catch (cause) {
      throw new Error(
        `QA remediation cycle ${cycle + 1} failed during Dalton remediation.`,
        { cause: cause instanceof Error ? cause : undefined },
      );
    }

    await remediationClearQaFindings(paths.handoffs, paths.templates);

    const captureCwd = await resolveTestCaptureCwd({
      repoRoot: paths.repoRoot,
      contextPackDir: effectiveContextPackDir,
    });
    const { runTestCaptureWithPhaseTracking } = await sequencer();
    const capture = await runTestCaptureWithPhaseTracking({
      repoRoot: paths.repoRoot,
      implementationStepsDir: paths.implementationSteps,
      captureCwd,
      abortSignal: options.abortSignal,
    });
    if (capture.skipped) {
      console.warn('[remediation] target repo resolution failed; skipping orchestrator test capture.');
    }
    const ronPromptOverride = buildTestCapturePrompt(
      capture.results,
      options.focusScope,
      options.externalMcpRegistry,
    );

    try {
      await runRoleAgent({
        agentId: 'ron',
        skipWorkflowValidation: true,
        contextPackDir: effectiveContextPackDir,
        promptOverride: ronPromptOverride,
        launchPhase: 'Revalidation',
      });
    } catch (cause) {
      if (priorFindings) {
        await writeTextFile(issuesFile, priorFindings);
      }
      throw new Error(
        `QA remediation cycle ${cycle + 1} failed during QA revalidation.`,
        { cause: cause instanceof Error ? cause : undefined },
      );
    }

    blockingFindingsRemain = await remediationHasBlockingFindings(paths.handoffs);
    if (!blockingFindingsRemain) {
      return;
    }
  }

  if (blockingFindingsRemain) {
    throw new Error(
      `QA remediation exhausted ${maxCycles} cycle(s) and blocking findings remain.`,
    );
  }
}
