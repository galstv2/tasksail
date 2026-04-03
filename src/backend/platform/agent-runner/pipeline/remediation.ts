import { readTextFile, resolvePaths, writeTextFile, extractMarkdownSection, nowIsoCompact } from '../../core/index.js';
import path from 'node:path';
import { runRoleAgent } from '../roleAgent.js';
import { formatSliceSections } from './sequencer.js';
import {
  captureSliceValidation,
  buildTestCapturePrompt,
  resolveTestCaptureCwd,
} from './testCapture.js';

/**
 * Check whether issues.md contains blocking severity findings.
 * Returns true if a "blocking" severity is detected.
 */
export async function remediationHasBlockingFindings(
  handoffsDir: string,
): Promise<boolean> {
  const issuesFile = path.join(handoffsDir, 'issues.md');
  const content = await readTextFile(issuesFile);
  if (!content) {
    return false;
  }

  const outcomeText = extractMarkdownSection(content, 'Review Outcome');
  if (!outcomeText) {
    return false;
  }

  const normalizedOutcome = outcomeText
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  return normalizedOutcome === 'blocking';
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
): Promise<string> {
  const parts: string[] = [
    'You are running a remediation pass. QA found blocking issues with your previous implementation.',
    'Fix the issues identified below, then ensure all tests pass before exiting.',
    '',
  ];

  if (issuesContent?.trim()) {
    parts.push('## QA Findings to Address\n');
    parts.push(issuesContent.trim());
    parts.push('');
  }

  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir, '###');
  if (sliceFiles.length > 0) {
    parts.push('## Original Task Slices (for reference)\n');
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
}): Promise<void> {
  const maxCycles = options.maxCycles ?? 3;
  const effectiveContextPackDir = options.contextPackDir || process.env['ACTIVE_CONTEXT_PACK_DIR'] || undefined;
  const paths = resolvePaths(options.repoRoot);
  const issuesFile = path.join(paths.handoffs, 'issues.md');
  let blockingFindingsRemain = false;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const priorFindings = await readTextFile(issuesFile);

    const remediationPrompt = await buildRemediationDaltonPrompt(
      priorFindings,
      paths.implementationSteps,
    );

    try {
      await runRoleAgent({
        agentId: 'dalton',
        skipWorkflowValidation: true,
        contextPackDir: effectiveContextPackDir,
        promptOverride: remediationPrompt,
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
    const captureResults = captureCwd
      ? await captureSliceValidation(paths.implementationSteps, captureCwd)
      : [];
    if (!captureCwd) {
      console.warn('[remediation] target repo resolution failed; skipping orchestrator test capture.');
    }
    const ronPromptOverride = buildTestCapturePrompt(captureResults);

    try {
      await runRoleAgent({
        agentId: 'ron',
        skipWorkflowValidation: true,
        contextPackDir: effectiveContextPackDir,
        promptOverride: ronPromptOverride,
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
