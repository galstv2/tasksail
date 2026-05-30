import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  type DesktopInvokeResult,
  type FollowUpDirectSubmissionDraft,
  type PlannerDirectSubmissionDraft,
} from '../src/shared/desktopContract';
import type { ContextPackDeepFocusTarget, ContextPackPrimaryFocusTarget } from '../src/shared/desktopContractDeepFocus';
import type { PlannerStagingSidecar, PlannerTaskKind } from '../../../backend/platform/planner-history/types.js';
import { emitStreamEvent } from './main.stream';
import { createDropboxTask } from '../../../backend/platform/queue/createDropboxTask.js';
import { createFollowupTask } from '../../../backend/platform/queue/createFollowupTask.js';
import { publishPendingItem } from '../../../backend/platform/queue/publishPendingItem.js';
import {
  ACTIVATION_GATE_REASON,
  type ActivateNextPendingItemResult,
} from '../../../backend/platform/queue/operations.js';
import {
  readDeepFocusOverlay,
  resolveFocusedRepoRoot,
  resolveSelectedPrimaryRepoRoot,
} from '../../../backend/platform/context-pack/focusedRepo.js';
import { listAvailableContextPacks, readWorkspaceSyncStateSnapshot } from './main.contextPackCatalog';
import { derivePlannerDraftTitle, derivePlannerScopeMode, isMonolithEstate } from './main.staging';
import { REPO_ROOT } from './paths';
import { resolveChildTaskChainCreationContext } from './main.childTaskChain';
import {
  parseMarkdownSections,
  canonicalizeEditableDraftRequirements,
  parsePlannerEditableDraft,
  validatePlanningIntakeDraft,
  type PlannerEditableDraft,
} from './main.markdown';
import { deriveBypassPlannerTaskTitle } from './main.plannerTitle';

export type DropboxScriptRunner = (options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  criticalRequirements?: string;
  compatibilityRequirements?: string;
  requiredValidation?: string;
  acceptanceSignals: string;
  suggestedPath: string;
  planningNotes: string;
  kind: string;
}) => Promise<string | { filePath: string; title: string }>;

export type FollowUpScriptRunner = (options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  criticalRequirements?: string;
  compatibilityRequirements?: string;
  requiredValidation?: string;
  acceptanceSignals: string;
  parentTaskId: string;
  followupReason: string;
  carryForwardSummary: string;
  suggestedPath: string;
  planningNotes: string;
}) => Promise<string | { filePath: string; title: string; rootTaskId: string }>;

function emitPostPublishActivationEvent(
  activation: ActivateNextPendingItemResult,
  source: string,
): void {
  if (activation.activated) {
    emitStreamEvent({
      message: `Activated next pending item after publish.`,
      source,
      role: 'workflow',
      severity: 'info',
    });
    return;
  }
  if (activation.reason === ACTIVATION_GATE_REASON.CONCURRENCY_CAP_REACHED) {
    emitStreamEvent({
      message: `Published; another task already active (cap reached). Will activate when cap frees up.`,
      source,
      role: 'workflow',
      severity: 'info',
    });
  }
}

type WorkspaceSyncState = Awaited<ReturnType<typeof readWorkspaceSyncStateSnapshot>>;

type ResolvedDirectSubmissionContext = {
  title: string;
  contextPackDir: string;
  contextPackId?: string;
  scopeMode?: string;
  primaryRepoId?: string;
  primaryFocusId?: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled?: boolean;
  deepFocusPrimaryRepoId?: string;
  deepFocusPrimaryFocusId?: string;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
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
  isFile?: () => boolean;
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

function archivedTaskJsonPath(markdownPath: string): string {
  return basename(markdownPath) === 'archive.md'
    ? join(dirname(markdownPath), 'archive.json')
    : markdownPath.replace(/\.md$/u, '.json');
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
    primaryFocusTargets: focused.primaryFocusTargets,
  }).trim();
  if (!title) {
    throw new Error('Direct queue submission blocked: canonical title derivation returned an empty value.');
  }

  const overlay = await readDeepFocusOverlay(contextPackDir, REPO_ROOT);
  const deepFocusEnabled = overlay?.deepFocusEnabled === true
    ? true
    : syncState.deepFocusEnabled;
  const overlaySupportTargets = overlay?.selectedSupportTargets;
  const overlayFocusTargets = overlay?.selectedFocusTargets;
  const monolithEstate = isMonolithEstate(focused.estateType);
  const selectedRepoIds = monolithEstate
    ? []
    : syncState.selectedRepoIds.length > 0
      ? syncState.selectedRepoIds
      : focused.selectedRepoIds;
  const selectedFocusIds = syncState.selectedFocusIds.length > 0
    ? syncState.selectedFocusIds
    : focused.selectedFocusIds;
  return {
    title,
    contextPackDir,
    contextPackId: syncState.activeContextPackId ?? undefined,
    scopeMode: derivePlannerScopeMode({
      selectedRepoIds,
      selectedFocusIds,
    }, contextPackDir),
    primaryRepoId: monolithEstate
      ? undefined
      : focused.primaryRepoId || undefined,
    primaryFocusId: focused.primaryFocusId || undefined,
    selectedRepoIds,
    selectedFocusIds,
    deepFocusEnabled,
    deepFocusPrimaryRepoId: deepFocusEnabled && !monolithEstate
      ? focused.primaryRepoId || undefined
      : undefined,
    deepFocusPrimaryFocusId: deepFocusEnabled && monolithEstate
      ? focused.primaryFocusId || undefined
      : undefined,
    selectedFocusPath: deepFocusEnabled
      ? overlay?.selectedFocusPath ?? syncState.selectedFocusPath
      : null,
    selectedFocusTargetKind: deepFocusEnabled
      ? overlay?.selectedFocusTargetKind ?? syncState.selectedFocusTargetKind
      : null,
    selectedFocusTargets: deepFocusEnabled
      ? overlayFocusTargets ?? syncState.selectedFocusTargets
      : [],
    selectedTestTarget: deepFocusEnabled
      ? overlay?.selectedTestTarget !== undefined
        ? overlay.selectedTestTarget
        : syncState.selectedTestTarget
      : null,
    selectedSupportTargets: deepFocusEnabled
      ? overlaySupportTargets ?? syncState.selectedSupportTargets
      : [],
    contextPackName: basename(contextPackDir),
  };
}

function directContextPackBinding(context: ResolvedDirectSubmissionContext) {
  return {
    contextPackDir: context.contextPackDir,
    contextPackId: context.contextPackId ?? '',
    scopeMode: context.scopeMode ?? '',
    primaryRepoId: context.primaryRepoId,
    primaryFocusId: context.primaryFocusId,
    deepFocusPrimaryRepoId: context.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: context.deepFocusPrimaryFocusId,
    selectedRepoIds: context.selectedRepoIds,
    selectedFocusIds: context.selectedFocusIds,
    deepFocusEnabled: context.deepFocusEnabled === true,
    selectedFocusPath: context.selectedFocusPath ?? null,
    selectedFocusTargetKind: context.selectedFocusTargetKind ?? null,
    selectedFocusTargets: context.selectedFocusTargets ?? [],
    selectedTestTarget: context.selectedTestTarget ?? null,
    selectedSupportTargets: context.selectedSupportTargets.map((target) => ({
      ...target,
      effectiveScope: 'full-directory' as const,
    })),
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
    let entries: TaskArchiveDirEntry[];
    try {
      entries = await taskArchiveReader.readdir(
        yearPath,
        { withFileTypes: true },
      ) as TaskArchiveDirEntry[];
    } catch {
      continue;
    }

    const candidates = entries.flatMap((entry) => {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          return [];
        }
        return [{
          fallbackTaskId: entry.name,
          markdownPath: join(yearPath, entry.name, 'archive.md'),
        }];
      }
      if (!entry.isFile?.() || !entry.name.endsWith('.md')) {
        return [];
      }
      return [{
        fallbackTaskId: entry.name.replace(/\.md$/u, ''),
        markdownPath: join(yearPath, entry.name),
      }];
    });

    for (const candidate of candidates) {
      const jsonPath = archivedTaskJsonPath(candidate.markdownPath);

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
          markdownTaskId = extractTaskId(await taskArchiveReader.readFile(candidate.markdownPath, 'utf-8'));
        } catch {
          markdownTaskId = '';
        }
      }

      const effectiveTaskId = sidecarTaskId || markdownTaskId || candidate.fallbackTaskId;
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
  criticalRequirements?: string;
  compatibilityRequirements?: string;
  requiredValidation?: string;
  acceptanceSignals: string;
  suggestedPath: string;
  planningNotes: string;
  kind: string;
}): Promise<{ filePath: string; title: string }> {
  // Capture the operator's active context pack focus state at submission time.
  const syncState = await readWorkspaceSyncStateSnapshot();
  const context = await resolveDirectSubmissionContext(syncState);
  const { destinationPath: filePath, activation } = await publishPendingItem({
    publish: () =>
      createDropboxTask({
        title: context.title,
        summary: options.summary,
        desiredOutcome: options.desiredOutcome,
        constraints: options.constraints,
        criticalRequirements: options.criticalRequirements ?? 'None',
        compatibilityRequirements: options.compatibilityRequirements ?? 'None',
        requiredValidation: options.requiredValidation ?? 'None',
        acceptanceSignals: options.acceptanceSignals,
        suggestedPath: options.suggestedPath,
        planningNotes: options.planningNotes,
        kind: options.kind,
        contextPackDir: context.contextPackDir,
        contextPackId: context.contextPackId,
        scopeMode: context.scopeMode,
        primaryRepoId: context.primaryRepoId,
        primaryFocusId: context.primaryFocusId,
        selectedRepoIds: context.selectedRepoIds,
        selectedFocusIds: context.selectedFocusIds,
        deepFocusEnabled: context.deepFocusEnabled,
        selectedFocusPath: context.selectedFocusPath,
        selectedFocusTargetKind: context.selectedFocusTargetKind,
        selectedFocusTargets: context.selectedFocusTargets,
        selectedTestTarget: context.selectedTestTarget,
        selectedSupportTargets: context.selectedSupportTargets,
      }),
    repoRoot: REPO_ROOT,
    contextPackDir: context.contextPackDir,
    lockOperationName: 'runDropboxTaskScript',
  });
  emitStreamEvent({ message: `Created dropbox task: ${filePath}`, source: 'createDropboxTask', role: 'queue' });
  emitPostPublishActivationEvent(activation, 'runDropboxTaskScript');
  return { filePath, title: context.title };
}

export async function runFollowUpTaskScript(options: {
  summary: string;
  desiredOutcome: string;
  constraints: string;
  criticalRequirements?: string;
  compatibilityRequirements?: string;
  requiredValidation?: string;
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
  const childExecutionScope = directContextPackBinding(context);
  const chainContext = await resolveChildTaskChainCreationContext({
    repoRoot: REPO_ROOT,
    listContextPacks: listAvailableContextPacks,
    parentTaskId: options.parentTaskId,
    requestedRootTaskId: parentMetadata.rootTaskId,
    childExecutionScope,
  });
  const { destinationPath: filePath, activation } = await publishPendingItem({
    publish: () =>
      createFollowupTask({
        title: context.title,
        summary: options.summary,
        desiredOutcome: options.desiredOutcome,
        constraints: options.constraints,
        criticalRequirements: options.criticalRequirements ?? 'None',
        compatibilityRequirements: options.compatibilityRequirements ?? 'None',
        requiredValidation: options.requiredValidation ?? 'None',
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
        primaryRepoId: context.primaryRepoId,
        primaryFocusId: context.primaryFocusId,
        selectedRepoIds: context.selectedRepoIds,
        selectedFocusIds: context.selectedFocusIds,
        deepFocusEnabled: context.deepFocusEnabled,
        selectedFocusPath: context.selectedFocusPath,
        selectedFocusTargetKind: context.selectedFocusTargetKind,
        selectedFocusTargets: context.selectedFocusTargets,
        selectedTestTarget: context.selectedTestTarget,
        selectedSupportTargets: context.selectedSupportTargets,
        deepFocusPrimaryRepoId: context.deepFocusPrimaryRepoId,
        deepFocusPrimaryFocusId: context.deepFocusPrimaryFocusId,
        branchChain: chainContext.branchChain,
        parentContextSnapshot: chainContext.parentContextSnapshot,
        childExecutionScope: chainContext.childExecutionScope,
        parentArchivePath: chainContext.parentArchivePath,
        parentArchiveArtifactDir: chainContext.parentArchiveArtifactDir,
        previousTaskId: chainContext.previousTaskId,
      }),
    repoRoot: REPO_ROOT,
    contextPackDir: context.contextPackDir,
    lockOperationName: 'runFollowUpTaskScript',
  });
  emitStreamEvent({ message: `Created child-task follow-up: ${filePath}`, source: 'createFollowupTask', role: 'queue' });
  emitPostPublishActivationEvent(activation, 'runFollowUpTaskScript');
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
  taskKind: PlannerTaskKind,
  allowEmptyCarryForward = false,
): string | null {
  if (sections.size === 0) {
    return 'Uploaded file contains no markdown sections. The file must start from "## Request Summary" and follow the planning-intake template.';
  }

  const forbiddenSections = PLATFORM_OWNED_SECTIONS.filter((s) => sections.has(s));
  if (forbiddenSections.length > 0) {
    return `Uploaded spec must not include platform-owned sections: ${forbiddenSections.join(', ')}. These are auto-generated from the active context pack. Remove them and re-upload.`;
  }

  if (/^#\s+\S/m.test(content)) {
    return 'Uploaded spec must not include a top-level title (# heading). Bypass Lily task titles are generated from uploaded content. Remove it and re-upload.';
  }

  return validatePlanningIntakeDraft(content, taskKind, sections, { allowEmptyCarryForward });
}

function buildSidecarDropboxOptions(
  sidecar: PlannerStagingSidecar,
  editableDraft: PlannerEditableDraft,
  title: string,
) {
  const canonicalDraft = canonicalizeEditableDraftRequirements(editableDraft);
  return {
    title,
    summary: canonicalDraft.summary,
    desiredOutcome: canonicalDraft.desiredOutcome,
    constraints: canonicalDraft.constraints,
    criticalRequirements: canonicalDraft.criticalRequirements,
    compatibilityRequirements: canonicalDraft.compatibilityRequirements,
    requiredValidation: canonicalDraft.requiredValidation,
    acceptanceSignals: canonicalDraft.acceptanceSignals,
    suggestedPath: canonicalDraft.suggestedPath,
    planningNotes: canonicalDraft.planningNotes,
    contextPackDir: sidecar.contextPackBinding.contextPackDir,
    contextPackId: sidecar.contextPackBinding.contextPackId,
    scopeMode: sidecar.contextPackBinding.scopeMode,
    primaryRepoId: sidecar.contextPackBinding.primaryRepoId,
    primaryFocusId: sidecar.contextPackBinding.primaryFocusId,
    selectedRepoIds: sidecar.contextPackBinding.selectedRepoIds,
    selectedFocusIds: sidecar.contextPackBinding.selectedFocusIds,
    repositoryTypes: sidecar.contextPackBinding.repositoryTypes,
    deepFocusEnabled: sidecar.contextPackBinding.deepFocusEnabled,
    deepFocusPrimaryRepoId: sidecar.contextPackBinding.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: sidecar.contextPackBinding.deepFocusPrimaryFocusId,
    selectedFocusPath: sidecar.contextPackBinding.selectedFocusPath,
    selectedFocusTargetKind: sidecar.contextPackBinding.selectedFocusTargetKind,
    selectedFocusTargets: sidecar.contextPackBinding.selectedFocusTargets,
    selectedTestTarget: sidecar.contextPackBinding.selectedTestTarget,
    selectedSupportTargets: sidecar.contextPackBinding.selectedSupportTargets,
    repoRoot: REPO_ROOT,
  };
}

async function submitUploadedSpecFromSidecar(
  sidecar: PlannerStagingSidecar,
  editableDraft: PlannerEditableDraft,
  title: string,
): Promise<{ filePath: string; title: string }> {
  const baseOptions = buildSidecarDropboxOptions(sidecar, editableDraft, title);
  if (sidecar.lineage.taskKind === 'child-task') {
    const chainContext = await resolveChildTaskChainCreationContext({
      repoRoot: REPO_ROOT,
      listContextPacks: listAvailableContextPacks,
      parentTaskId: sidecar.lineage.parentTaskId,
      requestedRootTaskId: sidecar.lineage.rootTaskId,
      childExecutionScope: sidecar.contextPackBinding,
    });
    return {
      filePath: await createFollowupTask({
        ...baseOptions,
        parentTaskId: sidecar.lineage.parentTaskId,
        parentQmdRecordId: sidecar.lineage.parentQmdRecordId,
        parentQmdScope: sidecar.lineage.parentQmdScope,
        rootTaskId: sidecar.lineage.rootTaskId,
        followupReason: sidecar.lineage.followUpReason,
        carryForwardSummary:
          editableDraft.carryForwardSummary.trim()
          || chainContext.parentSummary.trim()
          || `Carry-forward from parent task ${sidecar.lineage.parentTaskId}.`,
        deepFocusPrimaryRepoId: sidecar.contextPackBinding.deepFocusPrimaryRepoId,
        deepFocusPrimaryFocusId: sidecar.contextPackBinding.deepFocusPrimaryFocusId,
        branchChain: chainContext.branchChain,
        parentContextSnapshot: chainContext.parentContextSnapshot,
        childExecutionScope: chainContext.childExecutionScope,
        parentArchivePath: chainContext.parentArchivePath,
        parentArchiveArtifactDir: chainContext.parentArchiveArtifactDir,
        previousTaskId: chainContext.previousTaskId,
      }),
      title,
    };
  }

  return {
    filePath: await createDropboxTask({
      ...baseOptions,
      kind: sidecar.lineage.taskKind,
    }),
    title,
  };
}

export async function submitUploadedSpecHelper(
  content: string,
  options: { plannerSidecar?: PlannerStagingSidecar | null } = {},
): Promise<DesktopInvokeResult> {
  const sections = parseMarkdownSections(content);
  const plannerSidecar = options.plannerSidecar ?? null;
  const taskKind = plannerSidecar?.lineage.taskKind ?? 'standard';
  // Bypass child-task uploads synthesize the carry-forward summary from the
  // parent archive after parsing, so an unauthored section is allowed here.
  const allowEmptyCarryForward = plannerSidecar != null && taskKind === 'child-task';
  const validationError = validateUploadedSpecContent(content, sections, taskKind, allowEmptyCarryForward);
  if (validationError) {
    return {
      ok: false,
      action: 'planner.uploadSpec',
      error: validationError,
    };
  }
  const derivedTitle = deriveBypassPlannerTaskTitle(content);

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

  try {
    const submission = plannerSidecar
      ? await submitUploadedSpecFromSidecar(plannerSidecar, editableDraft, derivedTitle)
      : await submitUploadedSpecFromActiveWorkspace(editableDraft, derivedTitle);
    emitStreamEvent({
      message: `Uploaded spec submitted to dropbox: ${submission.filePath}`,
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
        draftTitle: submission.title,
        submittedPath: submission.filePath,
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

async function submitUploadedSpecFromActiveWorkspace(
  editableDraft: PlannerEditableDraft,
  title: string,
): Promise<{ filePath: string; title: string }> {
  let context: ResolvedDirectSubmissionContext;
  try {
    const syncState = await readWorkspaceSyncStateSnapshot();
    context = await resolveDirectSubmissionContext(syncState);
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to resolve active context pack for spec upload.');
  }

  const canonicalDraft = canonicalizeEditableDraftRequirements(editableDraft);
  const filePath = await createDropboxTask({
    title,
    summary: canonicalDraft.summary,
    desiredOutcome: canonicalDraft.desiredOutcome,
    constraints: canonicalDraft.constraints,
    criticalRequirements: canonicalDraft.criticalRequirements,
    compatibilityRequirements: canonicalDraft.compatibilityRequirements,
    requiredValidation: canonicalDraft.requiredValidation,
    acceptanceSignals: canonicalDraft.acceptanceSignals,
    suggestedPath: canonicalDraft.suggestedPath,
    planningNotes: canonicalDraft.planningNotes,
    kind: 'standard',
    repoRoot: REPO_ROOT,
    contextPackDir: context.contextPackDir,
    contextPackId: context.contextPackId,
    scopeMode: context.scopeMode,
    primaryRepoId: context.primaryRepoId,
    primaryFocusId: context.primaryFocusId,
    selectedRepoIds: context.selectedRepoIds,
    selectedFocusIds: context.selectedFocusIds,
    deepFocusEnabled: context.deepFocusEnabled,
    selectedFocusPath: context.selectedFocusPath,
    selectedFocusTargetKind: context.selectedFocusTargetKind,
    selectedFocusTargets: context.selectedFocusTargets,
    selectedTestTarget: context.selectedTestTarget,
    selectedSupportTargets: context.selectedSupportTargets,
  });
  return { filePath, title };
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
    const canonicalDraft = canonicalizeEditableDraftRequirements(draft);
    const submission = normalizeDropboxSubmissionResult(await runner({
      summary: canonicalDraft.summary,
      desiredOutcome: canonicalDraft.desiredOutcome,
      constraints: canonicalDraft.constraints,
      criticalRequirements: canonicalDraft.criticalRequirements,
      compatibilityRequirements: canonicalDraft.compatibilityRequirements,
      requiredValidation: canonicalDraft.requiredValidation,
      acceptanceSignals: canonicalDraft.acceptanceSignals,
      suggestedPath: canonicalDraft.suggestedPath,
      planningNotes: canonicalDraft.planningNotes,
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
    const canonicalDraft = canonicalizeEditableDraftRequirements(draft);
    const submission = normalizeFollowUpSubmissionResult(await runner({
      summary: canonicalDraft.summary,
      desiredOutcome: canonicalDraft.desiredOutcome,
      constraints: canonicalDraft.constraints,
      criticalRequirements: canonicalDraft.criticalRequirements,
      compatibilityRequirements: canonicalDraft.compatibilityRequirements,
      requiredValidation: canonicalDraft.requiredValidation,
      acceptanceSignals: canonicalDraft.acceptanceSignals,
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
