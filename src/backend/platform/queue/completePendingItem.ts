import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { findRepoRoot, readTextFile, writeTextFile } from '../core/index.js';
import { resolveQueuePaths } from './paths.js';
import { completeActiveItem, acquireDirLockOrThrow } from './operations.js';
import { assertPolicyPasses } from './policyValidation.js';
import { fileTaskArchive } from './archive.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/index.js';
import { syncRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';
import { buildAdvisoryFindingSection, ADVISORY_FINDING_HEADING } from '../agent-runner/pipeline/remediation.js';
import { commitTaskSnapshot } from './errorItems.js';
import { transitionTask } from './taskRegistry.js';

export interface CompletePendingItemOptions {
  skipValidation?: boolean;
  skipArchive?: boolean;
  repoRoot?: string;
  contextPackDir?: string;
}

/**
 * Complete the active pending item and advance the queue.
 * Runs queue-advance policy validation before allowing completion.
 * Archives the task to QMD unless skipArchive is set.
 * Wraps operations.completeActiveItem with automatic path resolution.
 */
export async function completePendingItem(
  options: CompletePendingItemOptions = {},
): Promise<void> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);

  if (!options.skipValidation) {
    await assertPolicyPasses(
      'queue-advance',
      repoRoot,
      'Completion blocked by queue-advance policy validation.',
    );
  }

  if (!options.skipArchive) {
    const contextPackDir = options.contextPackDir
      ?? await requireAuthorizedActiveContextPack({ repoRoot });
    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir: queuePaths.handoffsDir,
      contextPackDir,
    });

    const advisorySection = await buildAdvisoryFindingSection(queuePaths.handoffsDir);
    if (advisorySection) {
      const finalSummaryPath = path.join(queuePaths.handoffsDir, 'final-summary.md');
      const currentContent = await readTextFile(finalSummaryPath);
      if (currentContent && !currentContent.includes(ADVISORY_FINDING_HEADING)) {
        await writeTextFile(finalSummaryPath, currentContent.trimEnd() + '\n\n' + advisorySection + '\n');
      }
    }

    const archiveResult = await fileTaskArchive({ contextPackDir, repoRoot });
    if (!archiveResult.passed) {
      const details = [archiveResult.stdout, archiveResult.stderr]
        .filter(Boolean)
        .join('\n')
        .trim();
      const suffix = details ? `\n${details}` : '';
      throw new Error(
        `Completion blocked: task archival failed (exit ${archiveResult.exitCode}).${suffix}`,
      );
    }
  }

  const release = await acquireDirLockOrThrow(
    queuePaths.queueLockDir,
    'Completion',
  );

  try {
    let activeTaskId: string | undefined;
    try {
      const activeName = (await readFile(
        path.join(queuePaths.pendingDir, '.active-item'), 'utf-8',
      )).trim();
      activeTaskId = activeName.replace(/\.md$/, '');
    } catch {
      // Will be caught by completeActiveItem below
    }

    if (activeTaskId) {
      await commitTaskSnapshot(
        repoRoot, activeTaskId, 'completed',
        process.env['ACTIVE_CONTEXT_PACK_DIR'],
      );
      // Transition active → completed in the task registry
      try {
        await transitionTask(repoRoot, activeTaskId, 'active', 'completed', {
          completedAt: new Date().toISOString(),
        });
      } catch { /* best-effort */ }
    }

    await completeActiveItem({
      pendingDir: queuePaths.pendingDir,
      handoffsDir: queuePaths.handoffsDir,
      templatesDir: queuePaths.templatesDir,
      skipValidation: options.skipValidation,
      implementationStepsDir: path.join(
        repoRoot,
        'AgentWorkSpace',
        'ImplementationSteps',
      ),
    });
  } finally {
    await release();
  }
}
