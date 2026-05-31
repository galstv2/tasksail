import { createLogger, emitTaskProgressEvent, newSpanId, readTextFile, resolvePaths, writeTextFile, extractMarkdownSection, nowIsoCompact } from '../../core/index.js';
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
import { getActiveProvider } from '../../cli-provider/index.js';
import { readTaskJsonSafe } from '../../queue/taskJson.js';
import type { SliceArtifactFormat } from '../../platform-config/types.js';

const log = createLogger('platform/agent-runner/pipeline/remediation');

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

  const normalized = outcomeText
    .replace(/<!--.*?-->/gs, '')
    .toLowerCase()
    .trim();
  const outcome = /^(pass|advisory|blocking)\b/.exec(normalized)?.[1] ?? normalized.replace(/\s+/g, '');

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
  repoRoot: string,
  issuesContent: string | undefined,
  implStepsDir: string,
  focusScope?: FocusScopePromptOptions,
  externalMcpRegistry?: ExternalMcpRegistry,
  format: SliceArtifactFormat = 'markdown',
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
    const handoffsEnvVar = getActiveProvider(repoRoot).promptPathEnvVars().handoffsDir;
    parts.push(`## QA Findings from $${handoffsEnvVar}/issues.md — AUTHORITATIVE (Read First, Follow Exactly)\n`);
    parts.push(
      'Prioritize this section above all original task slices. Resolve every blocking finding here before using the slices as background context.',
    );
    parts.push('');
    parts.push(issuesContent.trim());
    parts.push('');
  }

  const { formatSliceSections } = await sequencer();
  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir, '###', format);
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
  taskId: string;
  focusScope?: FocusScopePromptOptions;
  externalMcpRegistry?: ExternalMcpRegistry;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const maxCycles = options.maxCycles ?? 3;
  let effectiveContextPackDir: string | undefined;
  try {
    effectiveContextPackDir = await requireAuthorizedActiveContextPack({
      taskId: options.taskId,
      repoRoot: options.repoRoot,
    });
  } catch {
    effectiveContextPackDir = options.contextPackDir;
  }
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  // Resolve the frozen slice format from the task sidecar for all downstream callers.
  const frozenSliceFormat: SliceArtifactFormat =
    readTaskJsonSafe(options.taskId, paths.repoRoot)?.sliceArtifactFormat ?? 'markdown';
  const issuesFile = path.join(paths.handoffs, 'issues.md');
  let blockingFindingsRemain = false;
  await emitTaskProgressEvent({ logger: log.child({ taskId: options.taskId }), repoRoot: paths.repoRoot, taskId: options.taskId, event: { type: 'qa_remediation.started' } });

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.taskId }), repoRoot: paths.repoRoot, taskId: options.taskId, event: { type: 'qa_remediation.cycle_started', input: { cycle: cycle + 1 } } });
    const priorFindings = await readTextFile(issuesFile);

    const remediationPrompt = await buildRemediationDaltonPrompt(
      paths.repoRoot,
      priorFindings,
      paths.implementationSteps,
      options.focusScope,
      options.externalMcpRegistry,
      frozenSliceFormat,
    );

    try {
      await runRoleAgent({
        agentId: 'dalton',
        repoRoot: paths.repoRoot,
        taskId: options.taskId,
        spanId: newSpanId(),
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
      taskId: options.taskId,
      contextPackDir: effectiveContextPackDir,
    });
    const { runTestCaptureWithPhaseTracking } = await sequencer();
    const capture = await runTestCaptureWithPhaseTracking({
      repoRoot: paths.repoRoot,
      taskRuntime: paths.taskRuntime,
      implementationStepsDir: paths.implementationSteps,
      captureCwd,
      abortSignal: options.abortSignal,
      pipelineTaskId: options.taskId,
      sliceFormat: frozenSliceFormat,
    });
    if (capture.skipped) {
      log.warn('orchestrator_test_capture.skipped', { reason: 'target-repo-resolution-failed' });
    }
    const ronPromptOverride = buildTestCapturePrompt(
      capture.results,
      options.focusScope,
      options.externalMcpRegistry,
      undefined,
      frozenSliceFormat,
    );

    try {
      await runRoleAgent({
        agentId: 'ron',
        repoRoot: paths.repoRoot,
        taskId: options.taskId,
        spanId: newSpanId(),
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
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.taskId }), repoRoot: paths.repoRoot, taskId: options.taskId, event: { type: 'qa_remediation.cycle_completed', input: { cycle: cycle + 1 } } });
    if (!blockingFindingsRemain) {
      await emitTaskProgressEvent({ logger: log.child({ taskId: options.taskId }), repoRoot: paths.repoRoot, taskId: options.taskId, event: { type: 'qa_remediation.completed' } });
      return;
    }
  }

  if (blockingFindingsRemain) {
    await emitTaskProgressEvent({ logger: log.child({ taskId: options.taskId }), repoRoot: paths.repoRoot, taskId: options.taskId, event: { type: 'qa_remediation.exhausted', input: { cycle: maxCycles } } });
    throw new Error(
      `QA remediation exhausted ${maxCycles} cycle(s) and blocking findings remain.`,
    );
  }
}
