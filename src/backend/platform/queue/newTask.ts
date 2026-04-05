import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { slugify, findRepoRoot, ensureDir, copyFileSafe } from '../core/index.js';
import { existsSync } from 'node:fs';
import {
  resolveQueuePaths,
  HANDOFF_FILES,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsDirFor,
  templateSourceFor,
} from './paths.js';
import { initializeTaskArtifacts, resetHandoffArtifacts, handoffWorkspaceIsReady, hasSubstantiveContent } from './lifecycle.js';
import { syncRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';

/**
 * Check if a markdown file contains authored section content beyond
 * template boilerplate (headings, comments, metadata labels, and
 * stamped metadata values).
 *
 * Returns false if the file does not exist or cannot be read.
 */
async function hasAuthoredContent(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return hasSubstantiveContent(raw);
  } catch {
    // Intentional: missing file means no authored content
    return false;
  }
}

export interface InitializeTaskOptions {
  title?: string;
  taskId?: string;
  source?: string;
  rawRequest?: string;
  withStarterSlice?: boolean;
  reset?: boolean;
  force?: boolean;
  repoRoot?: string;
}

/**
 * Initialize or reset the handoff workspace for a new task.
 */
export async function initializeTask(
  options: InitializeTaskOptions = {},
): Promise<void> {
  const {
    title: rawTitle,
    taskId: rawTaskId,
    source = 'manual',
    rawRequest = '',
    withStarterSlice = false,
    reset = false,
    force = false,
    repoRoot: rawRepoRoot,
  } = options;

  const repoRoot = rawRepoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(repoRoot);

  await ensureDir(queuePaths.dropboxDir);
  await ensureDir(queuePaths.pendingDir);
  await ensureDir(queuePaths.handoffsDir);

  if (reset) {
    if (!force) {
      const ready = await handoffWorkspaceIsReady(
        queuePaths.handoffsDir,
        queuePaths.templatesDir,
      );
      if (!ready) {
        throw new Error(
          'handoffs/ contains task content. Rerun with --force to bypass.',
        );
      }
    }

    await resetHandoffArtifacts(queuePaths.handoffsDir, HANDOFF_FILES, {
      implementationStepsDir: implementationStepsDirFor(repoRoot),
    });
    return;
  }

  if (!force) {
    const ready = await handoffWorkspaceIsReady(
      queuePaths.handoffsDir,
      queuePaths.templatesDir,
    );
    if (!ready) {
      throw new Error(
        'handoffs/ is not in a reset state. Run reset after closeout, or rerun with --force.',
      );
    }
  }

  const taskTitle = rawTitle || 'New Task';
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const taskId = rawTaskId || `${slugify(taskTitle)}-${ts}`;
  const initializedAt = now.toISOString().replace(/\.\d+Z$/, 'Z');

  const metadata: Record<string, string> = {
    'Task ID': taskId,
    'Task Title': taskTitle,
    'Initialized At (UTC)': initializedAt,
    'Active Branch': 'unknown',
    'Intake Source': source,
  };

  const sections: Record<string, string> = {};
  if (rawRequest) {
    sections['Raw Request'] = rawRequest;
  }

  const implementationStepsDir = implementationStepsDirFor(repoRoot);

  await initializeTaskArtifacts({
    handoffsDir: queuePaths.handoffsDir,
    templatesDir: queuePaths.templatesDir,
    metadata,
    sections,
    implementationStepsDir,
  });
  await syncRetrospectiveRequiredMetadata({
    repoRoot,
    handoffsDir: queuePaths.handoffsDir,
    contextPackDir: process.env['ACTIVE_CONTEXT_PACK_DIR'],
  });

  if (withStarterSlice) {
    // Verify pre-slice artifacts exist before creating a starter slice.
    const implSpec = path.join(queuePaths.handoffsDir, 'implementation-spec.md');
    const hasImplSpec = await hasAuthoredContent(implSpec);

    if (!hasImplSpec) {
      process.stdout.write(
        'Starter slice blocked: pre-slice artifacts are missing or empty. '
        + 'Complete implementation-spec.md before '
        + 'creating a starter slice.\n',
      );
      throw new Error('Starter slice blocked by missing pre-slice artifacts.');
    }

    await ensureDir(implementationStepsDir);
    const pmseName = `slice-01-${slugify(taskTitle)}`;
    let candidate = path.join(implementationStepsDir, `${pmseName}.md`);
    let suffix = 1;
    while (existsSync(candidate)) {
      candidate = path.join(
        implementationStepsDir,
        `${pmseName}-${suffix}.md`,
      );
      suffix++;
    }

    const sliceTemplatePath = templateSourceFor(
      SLICE_TEMPLATE_FILENAME,
      queuePaths.templatesDir,
    );
    if (!existsSync(sliceTemplatePath)) {
      throw new Error(
        'Starter slice blocked: canonical slice-template.md is missing.',
      );
    }

    await copyFileSafe(sliceTemplatePath, candidate);
  }
}
