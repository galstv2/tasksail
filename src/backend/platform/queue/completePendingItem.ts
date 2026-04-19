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

  // Read the active task ID before policy validation so it can be threaded into
  // the policy check and archive calls. Falls through to undefined when the
  // .active-item marker is absent — completeActiveItem will surface the error.
  let activeTaskId: string | undefined;
  try {
    const activeName = (await readFile(
      path.join(queuePaths.pendingDir, '.active-item'), 'utf-8',
    )).trim();
    activeTaskId = activeName.replace(/\.md$/, '');
  } catch {
    // Will be caught by completeActiveItem below
  }

  if (!options.skipValidation) {
    await assertPolicyPasses({
      mode: 'queue-advance',
      repoRoot,
      taskId: activeTaskId ?? '',
      errorMessage: 'Completion blocked by queue-advance policy validation.',
    });
  }

  let resolvedArchiveMdPath: string | undefined;
  let archivedContextPackDir: string | undefined;
  if (!options.skipArchive) {
    const contextPackDir = options.contextPackDir
      ?? await requireAuthorizedActiveContextPack({ repoRoot });
    archivedContextPackDir = contextPackDir;

    const advisorySection = await buildAdvisoryFindingSection(queuePaths.handoffsDir);
    if (advisorySection) {
      const finalSummaryPath = path.join(queuePaths.handoffsDir, 'final-summary.md');
      const currentContent = await readTextFile(finalSummaryPath);
      if (currentContent && !currentContent.includes(ADVISORY_FINDING_HEADING)) {
        await writeTextFile(finalSummaryPath, currentContent.trimEnd() + '\n\n' + advisorySection + '\n');
      }
    }

    const archiveResult = await fileTaskArchive({ contextPackDir, taskId: activeTaskId ?? '', repoRoot });
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
    if (typeof archiveResult.data?.record_md_path === 'string') {
      resolvedArchiveMdPath = archiveResult.data.record_md_path;
    }
  }

  const release = await acquireDirLockOrThrow(
    queuePaths.queueLockDir,
    'Completion',
  );

  try {
    // syncRetrospectiveRequiredMetadata runs INSIDE the queue lock window so
    // that concurrent completions sharing the same contextPackId are serialized
    // at the queue-lock level (precedence 3) before the per-pack counter file
    // lock (precedence 4) is acquired inside syncRetrospectiveRequiredMetadata.
    if (!options.skipArchive && archivedContextPackDir !== undefined) {
      await syncRetrospectiveRequiredMetadata({
        repoRoot,
        handoffsDir: queuePaths.handoffsDir,
        contextPackDir: archivedContextPackDir,
      });
    }

    if (activeTaskId) {
      // Resolve the context pack dir from the per-task sidecar (§3.2).
      // Falls through to undefined (no-op in commitTaskSnapshot) when the sidecar
      // is absent or corrupt — best-effort, not fatal.
      await commitTaskSnapshot(
        repoRoot, activeTaskId, 'completed',
      );
      // Transition active → completed in the task registry
      try {
        await transitionTask(repoRoot, activeTaskId, 'active', 'completed', {
          completedAt: new Date().toISOString(),
          archivePath: resolvedArchiveMdPath ?? null,
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
