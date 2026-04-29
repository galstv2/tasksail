import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, unlink, writeFile, rename } from 'node:fs/promises';
import {
  readTextFile,
  ensureDir,
  copyFileSafe,
  resolvePaths,
} from '../core/index.js';
import {
  templateSourceFor,
  HANDOFF_FILES,
  PUBLISH_MARKER,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsTemplatePath,
} from './paths.js';
import { stampHandoffTemplate } from './artifacts.js';

export interface InitializeTaskOptions {
  handoffsDir: string;
  templatesDir: string;
  handoffFiles?: readonly string[];
  metadata?: Record<string, string>;
  lineage?: Record<string, string>;
  sections?: Record<string, string>;
  implementationStepsDir?: string;
}

/**
 * Stage all handoff files from templates into the handoffs directory.
 * Uses a staging directory for atomic writes — if any write fails,
 * the handoffs directory is left untouched.
 */
export async function initializeTaskArtifacts(
  options: InitializeTaskOptions,
): Promise<void> {
  const {
    handoffsDir,
    templatesDir,
    handoffFiles = HANDOFF_FILES,
    metadata = {},
    lineage = {},
    sections = {},
    implementationStepsDir,
  } = options;

  const stagingDir = path.join(handoffsDir, `.staging.${Date.now()}`);
  await ensureDir(stagingDir);

  try {
    for (const filename of handoffFiles) {
      const templatePath = templateSourceFor(filename, templatesDir);
      const destPath = path.join(stagingDir, filename);

      await stampHandoffTemplate(
        templatePath,
        destPath,
        metadata,
        lineage,
        sections,
      );
    }

    // All writes succeeded — move staged files into handoffs/
    // Write a marker so crash-recovery can detect partial publish.
    const publishMarker = path.join(handoffsDir, PUBLISH_MARKER);
    await writeFile(publishMarker, stagingDir, 'utf-8');

    const stagedFiles = await readdir(stagingDir);
    const renamedFiles: string[] = [];
    try {
      for (const file of stagedFiles) {
        const src = path.join(stagingDir, file);
        const dest = path.join(handoffsDir, file);
        await rename(src, dest);
        renamedFiles.push(dest);
      }
    } catch (renameErr) {
      // Roll pmck: remove any files already moved into handoffsDir
      for (const dest of renamedFiles) {
        try { await unlink(dest); } catch { /* best-effort */ }
      }
      // Remove the marker — rollback restored a clean workspace
      try { await unlink(publishMarker); } catch { /* best-effort */ }
      throw renameErr;
    }

    // Publish complete — remove the marker
    try { await unlink(publishMarker); } catch { /* best-effort */ }

    // Copy slice templates into ImplementationSteps/ if specified
    if (implementationStepsDir) {
      await ensureDir(implementationStepsDir);
      const sliceTemplate = templateSourceFor(
        SLICE_TEMPLATE_FILENAME,
        templatesDir,
      );
      if (existsSync(sliceTemplate)) {
        await copyFileSafe(
          sliceTemplate,
          implementationStepsTemplatePath(implementationStepsDir),
        );
      }
    }
  } finally {
    // Clean up staging directory
    const { rm } = await import('node:fs/promises');
    await rm(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Delete handoff files from the handoffs directory, returning it to a clean state.
 */
export async function resetHandoffArtifacts(
  handoffsDir: string,
  handoffFiles: readonly string[] = HANDOFF_FILES,
  options?: { implementationStepsDir?: string },
): Promise<void> {
  for (const filename of new Set([...handoffFiles, 'workflow-path.md'])) {
    const filePath = path.join(handoffsDir, filename);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  // Remove runtime-generated files not in the template set
  const codeDiff = path.join(handoffsDir, 'code-changes.diff');
  if (existsSync(codeDiff)) {
    await unlink(codeDiff);
  }

  // Remove the staged intake markdown copy (written at activation by
  // operations.ts so agents can read intake without pendingitems/ access).
  const intake = path.join(handoffsDir, 'intake.md');
  if (existsSync(intake)) {
    await unlink(intake);
  }

  // Remove any stale publish marker from a crashed initialization
  const publishMarker = path.join(handoffsDir, PUBLISH_MARKER);
  if (existsSync(publishMarker)) {
    await unlink(publishMarker);
  }

  // Clear ImplementationSteps/ if specified
  if (options?.implementationStepsDir && existsSync(options.implementationStepsDir)) {
    const files = await readdir(options.implementationStepsDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        await unlink(path.join(options.implementationStepsDir, file));
      }
    }
  }
}

/**
 * Clear runtime receipts for a specific task when it successfully activates.
 *
 * Clears only the task-scoped subdirectories under
 * `.platform-state/runtime/tasks/<taskId>/`:
 *   - guardrails/
 *   - role-sessions/
 *
 * All other tasks' subtrees remain untouched. We intentionally do not clear
 * these during failure/reset of the current task, so operators can still
 * inspect the receipts from the failed run until the next task actually starts.
 */
export async function clearRuntimeReceipts(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const paths = resolvePaths({ repoRoot, taskId });
  const taskRuntimeDir = paths.taskRuntime;

  await Promise.all([
    clearJsonFilesInDir(path.join(taskRuntimeDir, 'guardrails')),
    clearJsonFilesInDir(path.join(taskRuntimeDir, 'role-sessions')),
  ]);

  await ensureDir(taskRuntimeDir);
  await writeFile(
    path.join(taskRuntimeDir, 'last-reset-ts'),
    Math.floor(Date.now() / 1000).toString(),
    'utf-8',
  );
}

/** Remove all .json files in a directory (best-effort, no-throw). */
async function clearJsonFilesInDir(dirPath: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return; // Directory doesn't exist — nothing to clear.
  }
  for (const file of files) {
    if (file.endsWith('.json')) {
      try { await unlink(path.join(dirPath, file)); } catch { /* best-effort */ }
    }
  }
}

/**
 * Return true if the given markdown content contains substantive lines
 * beyond headings, HTML comments, blank label lines, and boilerplate.
 * Shared by handoff-reset detection and authored-content checks.
 */
export function hasSubstantiveContent(content: string): boolean {
  // Strip multiline HTML comments before checking lines
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');

  const significantLines = stripped
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return false;
      if (trimmed.startsWith('#')) return false;
      if (trimmed === 'Use this file only when slice independence is real.') {
        return false;
      }
      // Match label lines (with or without values) like "- Task ID:" or "- Task ID: some-value"
      if (/^-\s+[\w\s()]+:/.test(trimmed)) return false;
      return true;
    });

  return significantLines.length > 0;
}

/**
 * Check if a handoff file matches its template (reset/blank state).
 * A file is in reset state if it does not exist, or if its non-structural
 * content is empty (only headings, comments, and empty label lines).
 */
export async function handoffFileIsResetState(
  filePath: string,
  _templatePath?: string,
): Promise<boolean> {
  if (!existsSync(filePath)) {
    return true;
  }

  const content = await readTextFile(filePath);
  if (content === undefined) {
    return true;
  }

  return !hasSubstantiveContent(content);
}

/**
 * Check if all handoff artifacts are in reset (blank template) state.
 */
export async function handoffWorkspaceIsReady(
  handoffsDir: string,
  templatesDir: string,
  handoffFiles: readonly string[] = HANDOFF_FILES,
): Promise<boolean> {
  for (const filename of handoffFiles) {
    const filePath = path.join(handoffsDir, filename);
    const templatePath = templateSourceFor(filename, templatesDir);
    if (!(await handoffFileIsResetState(filePath, templatePath))) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a publish operation was interrupted mid-flight.
 * Returns true if the .publish-in-progress marker exists in handoffsDir.
 */
export function handoffPublishInProgress(handoffsDir: string): boolean {
  return existsSync(path.join(handoffsDir, PUBLISH_MARKER));
}

/**
 * Check if final-summary.md has meaningful (non-template) content.
 */
export async function finalSummaryHasContent(
  handoffsDir: string,
): Promise<boolean> {
  const filePath = path.join(handoffsDir, 'final-summary.md');
  // If the file is in reset state, it has no content
  const isReset = await handoffFileIsResetState(filePath);
  return !isReset;
}
