import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type DesktopInvokeResult,
  type FollowUpDirectSubmissionDraft,
  type PlannerDirectSubmissionDraft,
} from '../src/shared/desktopContract';
import type { ContextPackDeepFocusTarget } from '../src/shared/desktopContractDeepFocus';
import { emitStreamEvent } from './main.stream';
import { createDropboxTask } from '../../../backend/platform/queue/createDropboxTask.js';
import { createFollowupTask } from '../../../backend/platform/queue/createFollowupTask.js';
import {
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
} from '../../../backend/platform/context-pack/focusedRepo.js';
import { readWorkspaceSyncStateSnapshot } from './main.contextPackCatalog';
import { derivePlannerDraftTitle } from './main.staging';
import { REPO_ROOT } from './paths';
import {
  parseMarkdownSections,
  parsePlannerEditableDraft,
  validatePlanningIntakeDraft,
  type PlannerEditableDraft,
} from './main.markdown';

export type DropboxScriptRunner = (options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  suggestedPath: string;
  planningNotes: string;
  kind: string;
}) => Promise<string | { filePath: string; title: string }>;

export type FollowUpScriptRunner = (options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  parentTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  suggestedPath: string;
  planningNotes: string;
}) => Promise<string | { filePath: string; title: string; rootTaskId: string }>;

type WorkspaceSyncState = Awaited<ReturnType<typeof readWorkspaceSyncStateSnapshot>>;

type ResolvedDirectSubmissionContext = {
  title: string;
  contextPackDir: string;
  contextPackId?: string;
  scopeMode?: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled?: boolean;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  selectedTestTarget?: ContextPackDeepFocusTarget | null;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  contextPackName: string;
};

type ArchivedParentMetadata = {
  parentQmdScope: string;
  parentQmdRecordId: string;
  rootTaskId: string;
};

type TaskArchiveDirEntry = {
  name: string;
  isDirectory: () => boolean;
};

type TaskArchiveReader = {
  readdir: (targetPath: string, options?: unknown) => Promise<unknown>;
  readFile: (targetPath: string, encoding: 'utf-8') => Promise<string>;
};

type PlannerSubmissionDraft = PlannerDirectSubmissionDraft & {
  title?: string;
};

type FollowUpSubmissionDraft = FollowUpDirectSubmissionDraft & {
  title?: string;
};

function extractTaskId(head: string): string {
  const match = head.match(/^- Task ID:\s*(.+?)$/m);
  return match?.[1]?.trim() ?? '';
}

const defaultTaskArchiveReader: TaskArchiveReader = {
  readdir: async (targetPath, options) => readdir(targetPath, options as never),
  readFile: async (targetPath, encoding) => readFile(targetPath, encoding),
};

async function resolveDirectSubmissionContext(
  syncState: WorkspaceSyncState,
): Promise<ResolvedDirectSubmissionContext> {
  const contextPackDir = syncState.activeContextPackDir?.trim() ?? '';
  if (!contextPackDir) {
    throw new Error('Direct queue submission requires an active context pack so the platform can derive the canonical task title.');
  }

  const focused = await resolveSelectedPrimaryRepoRoot(contextPackDir, REPO_ROOT)
    ?? await resolveFocusedRepoRoot(contextPackDir, REPO_ROOT);
  if (!focused) {
    throw new Error('Direct queue submission blocked: the platform could not resolve the active context-pack primary repo for canonical title derivation.');
  }

  const title = derivePlannerDraftTitle({
    primaryRepoId: focused.primaryRepoId,
    primaryRepoRoot: focused.primaryRepoRoot,
    primaryFocusRelativePath: focused.primaryFocusRelativePath,
    primaryFocusTargetKind: focused.primaryFocusTargetKind,
  }).trim();
  if (!title) {
    throw new Error('Direct queue submission blocked: canonical title derivation returned an empty value.');
  }

  return {
    title,
    contextPackDir,
    contextPackId: syncState.activeContextPackId ?? undefined,
    scopeMode: syncState.scopeMode ?? undefined,
    selectedRepoIds: syncState.selectedRepoIds.length > 0
      ? syncState.selectedRepoIds
      : focused.selectedRepoIds,
    selectedFocusIds: syncState.selectedFocusIds.length > 0
      ? syncState.selectedFocusIds
      : focused.selectedFocusIds,
    deepFocusEnabled: syncState.deepFocusEnabled,
    selectedFocusPath: syncState.deepFocusEnabled
      ? syncState.selectedFocusPath
      : null,
    selectedFocusTargetKind: syncState.deepFocusEnabled
      ? syncState.selectedFocusTargetKind
      : null,
    selectedTestTarget: syncState.deepFocusEnabled
      ? syncState.selectedTestTarget
      : null,
    selectedSupportTargets: syncState.deepFocusEnabled
      ? syncState.selectedSupportTargets
      : [],
    contextPackName: basename(contextPackDir),
  };
}

async function resolveArchivedParentMetadata(
  context: ResolvedDirectSubmissionContext,
  parentTaskId: string,
  taskArchiveReader: TaskArchiveReader = defaultTaskArchiveReader,
): Promise<ArchivedParentMetadata> {
  const archiveRoot = join(
    REPO_ROOT,
    'AgentWorkSpace',
    'qmd',
    'context-packs',
    context.contextPackName,
    'archive',
    'tasks',
  );

  let yearEntries: TaskArchiveDirEntry[];
  try {
    yearEntries = await taskArchiveReader.readdir(
      archiveRoot,
      { withFileTypes: true },
    ) as TaskArchiveDirEntry[];
  } catch {
    throw new Error(
      `Follow-up submission blocked: no task archive is available for active context pack "${context.contextPackName}".`,
    );
  }

  const yearDirs = yearEntries
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const yearDir of yearDirs) {
    const yearPath = join(archiveRoot, yearDir);
    let files: string[];
    try {
      files = (await taskArchiveReader.readdir(yearPath) as string[]).filter((entry) => entry.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of files) {
      const markdownPath = join(yearPath, file);
      const jsonPath = markdownPath.replace(/\.md$/, '.json');

      let jsonSidecar: {
        record_id?: unknown;
        task_id?: unknown;
        root_task_id?: unknown;
      } = {};
      try {
        jsonSidecar = JSON.parse(await taskArchiveReader.readFile(jsonPath, 'utf-8')) as {
          record_id?: unknown;
          task_id?: unknown;
          root_task_id?: unknown;
        };
      } catch {
        jsonSidecar = {};
      }

      const sidecarTaskId = typeof jsonSidecar.task_id === 'string'
        ? jsonSidecar.task_id.trim()
        : '';
      let markdownTaskId = '';
      if (!sidecarTaskId) {
        try {
          markdownTaskId = extractTaskId(await taskArchiveReader.readFile(markdownPath, 'utf-8'));
        } catch {
          markdownTaskId = '';
        }
      }

      const effectiveTaskId = sidecarTaskId || markdownTaskId || file.replace(/\.md$/, '');
      if (effectiveTaskId !== parentTaskId) {
        continue;
      }

      return {
        parentQmdScope: `qmd/context-packs/${context.contextPackName}`,
        parentQmdRecordId: typeof jsonSidecar.record_id === 'string'
          ? jsonSidecar.record_id.trim()
          : '',
        rootTaskId: typeof jsonSidecar.root_task_id === 'string' && jsonSidecar.root_task_id.trim()
          ? jsonSidecar.root_task_id.trim()
          : parentTaskId,
      };
    }
  }

  throw new Error(
    `Follow-up submission blocked: parent task "${parentTaskId}" could not be resolved from the active context-pack archive.`,
  );
}

function normalizeDropboxSubmissionResult(
  result: string | { filePath: string; title: string },
): { filePath: string; title: string } {
  if (typeof result === 'string') {
    return { filePath: result, title: '' };
  }
  return result;
}

function normalizeFollowUpSubmissionResult(
  result: string | { filePath: string; title: string; rootTaskId: string },
  fallbackRootTaskId: string,
): { filePath: string; title: string; rootTaskId: string } {
  if (typeof result === 'string') {
    return { filePath: result, title: '', rootTaskId: fallbackRootTaskId };
  }
  return result;
}

export async function runDropboxTaskScript(options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  suggestedPath: string;
  planningNotes: string;
  kind: string;
}): Promise<{ filePath: string; title: string }> {
  // Capture the operator's active context pack focus state at submission time.
  const syncState = await readWorkspaceSyncStateSnapshot();
  const context = await resolveDirectSubmissionContext(syncState);
  const filePath = await createDropboxTask({
    title: context.title,
    summary: options.summary,
    desiredOutcome: options.desiredOutcome,
    constraints: options.constraints,
    acceptanceSignals: options.acceptanceSignals,
    suggestedPath: options.suggestedPath,
    planningNotes: options.planningNotes,
    kind: options.kind,
    contextPackDir: context.contextPackDir,
    contextPackId: context.contextPackId,
    scopeMode: context.scopeMode,
    selectedRepoIds: context.selectedRepoIds,
    selectedFocusIds: context.selectedFocusIds,
    deepFocusEnabled: context.deepFocusEnabled,
    selectedFocusPath: context.selectedFocusPath,
    selectedFocusTargetKind: context.selectedFocusTargetKind,
    selectedTestTarget: context.selectedTestTarget,
    selectedSupportTargets: context.selectedSupportTargets,
  });
  emitStreamEvent({ message: `Created dropbox task: ${filePath}`, source: 'createDropboxTask', role: 'queue' });
  return { filePath, title: context.title };
}

export async function runFollowUpTaskScript(options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  acceptanceSignals: string;
  parentTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  suggestedPath: string;
  planningNotes: string;
},
taskArchiveReader: TaskArchiveReader = defaultTaskArchiveReader,
): Promise<{ filePath: string; title: string; rootTaskId: string }> {
  const syncState = await readWorkspaceSyncStateSnapshot();
  const context = await resolveDirectSubmissionContext(syncState);
  const parentMetadata = await resolveArchivedParentMetadata(
    context,
    options.parentTaskId,
    taskArchiveReader,
  );
  const filePath = await createFollowupTask({
    title: context.title,
    summary: options.summary,
    desiredOutcome: options.desiredOutcome,
    constraints: options.constraints,
    acceptanceSignals: options.acceptanceSignals,
    parentTaskId: options.parentTaskId,
    parentQmdScope: parentMetadata.parentQmdScope,
    parentQmdRecordId: parentMetadata.parentQmdRecordId,
    rootTaskId: parentMetadata.rootTaskId,
    followupReason: options.followupReason,
    carryForwardSummary: options.carryForwardSummary,
    suggestedPath: options.suggestedPath,
    planningNotes: options.planningNotes,
    contextPackDir: context.contextPackDir,
    contextPackId: context.contextPackId,
    scopeMode: context.scopeMode,
    selectedRepoIds: context.selectedRepoIds,
    selectedFocusIds: context.selectedFocusIds,
    deepFocusEnabled: context.deepFocusEnabled,
    selectedFocusPath: context.selectedFocusPath,
    selectedFocusTargetKind: context.selectedFocusTargetKind,
    selectedTestTarget: context.selectedTestTarget,
    selectedSupportTargets: context.selectedSupportTargets,
  });
  emitStreamEvent({ message: `Created child-task follow-up: ${filePath}`, source: 'createFollowupTask', role: 'queue' });
  return { filePath, title: context.title, rootTaskId: parentMetadata.rootTaskId };
}

export function validatePlannerDraftForSubmission(
  draft: PlannerSubmissionDraft,
): string[] {
  const errors: string[] = [];

  if (draft.taskKind === 'child-task') {
    return [
      'Child-task drafts must use the follow-up intake path (followup.begin), not planner.submitDraft.',
    ];
  }

  if (!draft.summary.trim()) {
    errors.push('Request summary is required before submitting to dropbox.');
  }

  if (!draft.desiredOutcome.trim()) {
    errors.push('Desired outcome is required before submitting to dropbox.');
  }

  return errors;
}

export function validateFollowUpDraftForSubmission(
  draft: FollowUpSubmissionDraft,
): string[] {
  const errors: string[] = [];

  if (draft.taskKind !== 'child-task') {
    errors.push('Follow-up drafts must use the child-task task kind.');
  }

  if (!draft.summary.trim()) {
    errors.push('Requested adjustment is required before creating a follow-up child task.');
  }

  if (!draft.parentTaskId.trim()) {
    errors.push('Parent task ID is required for follow-up creation.');
  }

  if (!draft.followupReason.trim()) {
    errors.push('Follow-up reason is required for follow-up creation.');
  }

  if (!draft.carryForwardSummary.trim()) {
    errors.push('Carry-forward summary is required when follow-up lineage must stay local and explicit.');
  }

  return errors;
}

const PLATFORM_OWNED_SECTIONS = ['Task Lineage', 'Context Pack Binding', 'Source'] as const;

function validateUploadedSpecContent(
  content: string,
  sections: Map<string, string>,
): string | null {
  if (sections.size === 0) {
    return 'Uploaded file contains no markdown sections. The file must start from "## Request Summary" and follow the planning-intake template.';
  }

  const forbiddenSections = PLATFORM_OWNED_SECTIONS.filter((s) => sections.has(s));
  if (forbiddenSections.length > 0) {
    return `Uploaded spec must not include platform-owned sections: ${forbiddenSections.join(', ')}. These are auto-generated from the active context pack. Remove them and re-upload.`;
  }

  if (/^#\s+\S/m.test(content)) {
    return 'Uploaded spec must not include a top-level title (# heading). The title is auto-generated from the active context pack focus. Remove it and re-upload.';
  }

  return validatePlanningIntakeDraft(content, 'standard', sections);
}

export async function submitUploadedSpecHelper(
  content: string,
): Promise<DesktopInvokeResult> {
  const sections = parseMarkdownSections(content);
  const validationError = validateUploadedSpecContent(content, sections);
  if (validationError) {
    return {
      ok: false,
      action: 'planner.uploadSpec',
      error: validationError,
    };
  }

  let editableDraft: PlannerEditableDraft;
  try {
    editableDraft = parsePlannerEditableDraft(content, sections);
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'planner.uploadSpec',
      error: err instanceof Error ? err.message : 'Failed to parse uploaded spec sections.',
    };
  }

  let context: ResolvedDirectSubmissionContext;
  try {
    const syncState = await readWorkspaceSyncStateSnapshot();
    context = await resolveDirectSubmissionContext(syncState);
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'planner.uploadSpec',
      error: err instanceof Error ? err.message : 'Failed to resolve active context pack for spec upload.',
    };
  }

  try {
    const filePath = await createDropboxTask({
      title: context.title,
      summary: editableDraft.summary,
      desiredOutcome: editableDraft.desiredOutcome,
      constraints: editableDraft.constraints,
      acceptanceSignals: editableDraft.acceptanceSignals,
      suggestedPath: editableDraft.suggestedPath,
      planningNotes: editableDraft.planningNotes,
      kind: 'standard',
      contextPackDir: context.contextPackDir,
      contextPackId: context.contextPackId,
      scopeMode: context.scopeMode,
      selectedRepoIds: context.selectedRepoIds,
      selectedFocusIds: context.selectedFocusIds,
      deepFocusEnabled: context.deepFocusEnabled,
      selectedFocusPath: context.selectedFocusPath,
      selectedFocusTargetKind: context.selectedFocusTargetKind,
      selectedTestTarget: context.selectedTestTarget,
      selectedSupportTargets: context.selectedSupportTargets,
    });
    emitStreamEvent({
      message: `Uploaded spec submitted to dropbox: ${filePath}`,
      source: 'planner.uploadSpec',
      role: 'queue',
    });
    return {
      ok: true,
      response: {
        action: 'planner.uploadSpec',
        mode: 'submitted',
        accepted: true,
        message: 'Uploaded spec validated and submitted to the dropbox queue.',
        draftTitle: context.title,
        submittedPath: filePath,
        observationMode: true,
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'planner.uploadSpec',
      error: err instanceof Error ? err.message : 'Failed to write uploaded spec to dropbox.',
    };
  }
}

export async function submitDraftViaDropboxHelper(
  draft: PlannerSubmissionDraft,
  runner: DropboxScriptRunner = runDropboxTaskScript,
): Promise<DesktopInvokeResult> {
  const validationErrors = validatePlannerDraftForSubmission(draft);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      action: 'planner.submitDraft',
      error: 'Planner draft validation failed before dropbox submission.',
      details: validationErrors,
    };
  }

  try {
    const submission = normalizeDropboxSubmissionResult(await runner({
      summary: draft.summary,
      desiredOutcome: draft.desiredOutcome,
      constraints: draft.constraints,
      acceptanceSignals: draft.acceptanceSignals,
      suggestedPath: draft.suggestedPath,
      planningNotes: draft.planningNotes,
      kind: draft.taskKind,
    }));

    return {
      ok: true,
      response: {
        action: 'planner.submitDraft',
        mode: 'submitted',
        accepted: true,
        message:
          'Planner draft submitted via platform queue module. Queue automation can now claim the task from AgentWorkSpace/dropbox/.',
        draftTitle: submission.title,
        suggestedPath: draft.suggestedPath,
        submittedPath: submission.filePath,
        observationMode: true,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.submitDraft',
      error:
        error instanceof Error
          ? error.message
          : 'Dropbox submission failed unexpectedly in the Electron main process.',
    };
  }
}

export async function submitFollowUpViaHelper(
  draft: FollowUpSubmissionDraft,
  runner: FollowUpScriptRunner = runFollowUpTaskScript,
): Promise<DesktopInvokeResult> {
  const validationErrors = validateFollowUpDraftForSubmission(draft);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      action: 'followup.begin',
      error: 'Follow-up draft validation failed before child-task submission.',
      details: validationErrors,
    };
  }

  try {
    const submission = normalizeFollowUpSubmissionResult(await runner({
      summary: draft.summary,
      desiredOutcome: draft.desiredOutcome,
      constraints: draft.constraints,
      acceptanceSignals: draft.acceptanceSignals,
      parentTaskId: draft.parentTaskId,
      followupReason: draft.followupReason,
      carryForwardSummary: draft.carryForwardSummary,
      suggestedPath: draft.suggestedPath,
      planningNotes: draft.planningNotes,
    }), draft.rootTaskId || draft.parentTaskId);

    return {
      ok: true,
      response: {
        action: 'followup.begin',
        mode: 'submitted',
        accepted: true,
        message:
          'Follow-up child task created via platform queue module. The closed parent task remains unchanged while queue automation can claim the new child-task intake from AgentWorkSpace/dropbox/.',
        suggestedTaskKind: 'child-task',
        sourceTaskId: draft.parentTaskId,
        parentTaskId: draft.parentTaskId,
        rootTaskId: submission.rootTaskId,
        submittedPath: submission.filePath,
        reopenedTask: false,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'followup.begin',
      error:
        error instanceof Error
          ? error.message
          : 'Follow-up submission failed unexpectedly in the Electron main process.',
    };
  }
}

export async function readBypassTemplate(): Promise<string> {
  const templatePath = join(REPO_ROOT, 'AgentWorkSpace', 'templates', 'planning-intake.md');
  const raw = await readFile(templatePath, 'utf-8');
  const startIdx = raw.indexOf('## Request Summary');
  if (startIdx === -1) return raw;
  const endIdx = raw.indexOf('\n## Source');
  return endIdx === -1
    ? raw.slice(startIdx).trimEnd() + '\n'
    : raw.slice(startIdx, endIdx).trimEnd() + '\n';
}
