/**
 * Archived task listing for the planner child-task parent selection dropdown.
 */
import { mkdir as fsMkdir, open as fsOpen, readdir as fsReadDir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type {
  ArchivedTaskBranchHandoff,
  ArchivedTaskEntry,
  ContextPackListResponse,
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
} from '../src/shared/desktopContract';
import { validatePlannerFocusSnapshot } from '../src/shared/desktopContractValidators';
import { REPO_ROOT } from './paths';
import {
  resolveActiveContextPackTaskScope,
  type ActiveContextPackTaskScope,
} from './main.contextPackTaskVisibility';

type ContextPackLister = () => Promise<ContextPackListResponse>;
type ArchiveCandidate = {
  fallbackName: string;
  mdPath: string;
};

const HEAD_BYTES = 2048;

async function readFileHead(filePath: string): Promise<string> {
  const handle = await fsOpen(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function archiveLayoutForMarkdown(mdPath: string): 'flat' | 'nested' {
  return basename(mdPath) === 'archive.md' ? 'nested' : 'flat';
}

function archiveJsonPath(mdPath: string): string {
  return archiveLayoutForMarkdown(mdPath) === 'nested'
    ? join(dirname(mdPath), 'archive.json')
    : mdPath.replace(/\.md$/u, '.json');
}

function plannerFocusSnapshotPath(mdPath: string): string {
  return archiveLayoutForMarkdown(mdPath) === 'nested'
    ? join(dirname(mdPath), 'planner-focus-snapshot.json')
    : mdPath.replace(/\.md$/u, '.planner-focus-snapshot.json');
}

function extractTitle(head: string): string {
  const match = head.match(/^#\s+(.+?)$/m);
  return match?.[1]?.trim() ?? '';
}

function extractTaskId(head: string): string {
  const match = head.match(/^- Task ID:\s*(.+?)$/m);
  return match?.[1]?.trim() ?? '';
}

type JsonSidecar = {
  record_id?: string;
  task_id?: string;
  root_task_id?: string;
  followup_reason?: string;
  completed_work_summary?: string;
  task_summary?: string;
  key_decisions?: unknown;
  known_limitations?: unknown;
  constraints?: unknown;
  implementation_summary?: string;
  branch_handoffs?: unknown;
};

type PlannerFocusSnapshot = NonNullable<ArchivedTaskEntry['plannerFocusSnapshot']>;

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function trimStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeBranchHandoffs(value: unknown): ArchivedTaskBranchHandoff[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const handoffs: ArchivedTaskBranchHandoff[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.repo_root !== 'string' ||
      typeof raw.repo_label !== 'string' ||
      typeof raw.branch !== 'string' ||
      typeof raw.base_commit_sha !== 'string' ||
      typeof raw.head_commit_sha !== 'string' ||
      typeof raw.status !== 'string'
    ) {
      continue;
    }
    const commitsAhead = typeof raw.commits_ahead === 'number'
      ? raw.commits_ahead
      : Number(raw.commits_ahead);
    if (!Number.isFinite(commitsAhead)) {
      continue;
    }
    const autoMerge = normalizeAutoMerge(raw.auto_merge);
    handoffs.push({
      repoRoot: raw.repo_root,
      repoLabel: raw.repo_label,
      branch: raw.branch,
      baseCommitSha: raw.base_commit_sha,
      headCommitSha: raw.head_commit_sha,
      commitsAhead,
      status: raw.status,
      ...(autoMerge ? { autoMerge } : {}),
    });
  }
  return handoffs.length > 0 ? handoffs : undefined;
}

function normalizeAutoMerge(value: unknown): ArchivedTaskBranchHandoff['autoMerge'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.enabled !== 'boolean' ||
    typeof raw.status !== 'string' ||
    (typeof raw.target_branch !== 'string' && raw.target_branch !== null) ||
    typeof raw.detail !== 'string'
  ) {
    return undefined;
  }
  return {
    enabled: raw.enabled,
    status: raw.status,
    targetBranch: raw.target_branch,
    detail: raw.detail,
  };
}

async function readJsonSidecar(mdPath: string): Promise<JsonSidecar> {
  const jsonPath = archiveJsonPath(mdPath);
  try {
    const raw = await fsReadFile(jsonPath, 'utf-8');
    return JSON.parse(raw) as JsonSidecar;
  } catch {
    return {};
  }
}

async function readValidPlannerFocusSnapshot(mdPath: string): Promise<ArchivedTaskEntry['plannerFocusSnapshot'] | null> {
  const snapshotPath = plannerFocusSnapshotPath(mdPath);
  try {
    const raw = await fsReadFile(snapshotPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (validatePlannerFocusSnapshot(parsed, 'snapshot').length > 0) {
      return null;
    }
    return parsed as ArchivedTaskEntry['plannerFocusSnapshot'];
  } catch {
    return null;
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function choosePrimaryHandoff(
  handoffs: ArchivedTaskBranchHandoff[] | undefined,
): ArchivedTaskBranchHandoff | undefined {
  return handoffs?.find((handoff) => handoff.commitsAhead > 0) ?? handoffs?.[0];
}

function synthesizePlannerFocusSnapshot(options: {
  archivedContextPackDir: string;
  contextPackName: string;
  title: string;
  sidecar: JsonSidecar;
  branchHandoffs: ArchivedTaskBranchHandoff[] | undefined;
}): PlannerFocusSnapshot | null {
  const primaryHandoff = choosePrimaryHandoff(options.branchHandoffs);
  const primaryRepoRoot = firstNonEmpty(primaryHandoff?.repoRoot);
  if (!primaryHandoff || !primaryRepoRoot) {
    return null;
  }
  const primaryRepoId = firstNonEmpty(
    primaryHandoff?.repoLabel,
    basename(primaryRepoRoot),
    options.contextPackName,
  );
  const selectedRepoIds = options.branchHandoffs
    ?.map((handoff) => handoff.repoLabel.trim())
    .filter(Boolean);
  const contextPackId = firstNonEmpty(
    options.sidecar.record_id?.split(':')[1],
    options.contextPackName,
  );
  return {
    version: 1,
    contextPackDir: options.archivedContextPackDir,
    contextPackId,
    title: options.title,
    primaryRepoId,
    primaryRepoRoot,
    primaryFocusRelativePath: null,
    primaryFocusTargetKind: null,
    primaryFocusTargets: [],
    selectedTestTarget: null,
    supportTargets: [],
    deepFocusEnabled: false,
    contextPackBinding: {
      contextPackDir: options.archivedContextPackDir,
      contextPackId,
      scopeMode: 'focused',
      primaryRepoId,
      selectedRepoIds: selectedRepoIds && selectedRepoIds.length > 0 ? selectedRepoIds : [primaryRepoId],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
  };
}

async function writePlannerFocusSnapshotIfMissing(options: {
  mirrorMdPath: string;
  snapshot: PlannerFocusSnapshot;
}): Promise<void> {
  const serialized = `${JSON.stringify(options.snapshot, null, 2)}\n`;
  const mirrorSnapshotPath = plannerFocusSnapshotPath(options.mirrorMdPath);
  try {
    await fsMkdir(dirname(mirrorSnapshotPath), { recursive: true });
    await fsWriteFile(mirrorSnapshotPath, serialized, 'utf-8');
  } catch {
    // Listing must not fail just because a historical archive cannot be repaired.
  }
}

function buildParentTaskContent(
  title: string,
  sidecar: JsonSidecar,
): ArchivedTaskEntry['parentTaskContent'] {
  const content: ArchivedTaskEntry['parentTaskContent'] = {};
  const set = <K extends keyof NonNullable<ArchivedTaskEntry['parentTaskContent']>>(
    key: K,
    value: NonNullable<ArchivedTaskEntry['parentTaskContent']>[K] | undefined,
  ): void => {
    if (value !== undefined) {
      (content as Record<string, unknown>)[key] = value;
    }
  };
  set('taskTitle', trimString(title));
  set('taskSummary', trimString(sidecar.task_summary));
  set('completedWorkSummary', trimString(sidecar.completed_work_summary));
  set('keyDecisions', trimStringArray(sidecar.key_decisions));
  set('knownLimitations', trimStringArray(sidecar.known_limitations));
  set('constraints', trimStringArray(sidecar.constraints));
  set('implementationSummary', trimString(sidecar.implementation_summary));
  return content;
}

export async function listArchivedTasksAction(
  listContextPacks: ContextPackLister,
  options?: { scope?: ActiveContextPackTaskScope | null },
): Promise<DesktopInvokeResult> {
  try {
    const activeScope = options && Object.prototype.hasOwnProperty.call(options, 'scope')
      ? options.scope ?? null
      : await resolveActiveContextPackTaskScope(listContextPacks);
    if (!activeScope) {
      const response: PlannerListArchivedTasksResponse = {
        action: 'planner.listArchivedTasks',
        mode: 'no-context-pack',
        message: 'No active context pack.',
        tasks: [],
      };
      return { ok: true, response };
    }

    const { contextPackName } = activeScope;
    const archiveRoot = join(
      REPO_ROOT,
      'AgentWorkSpace',
      'qmd',
      'context-packs',
      contextPackName,
      'archive',
      'tasks',
    );

    let yearDirs: string[];
    try {
      const entries = await fsReadDir(archiveRoot, { withFileTypes: true });
      yearDirs = entries
        .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
        .map((e) => e.name);
    } catch {
      const response: PlannerListArchivedTasksResponse = {
        action: 'planner.listArchivedTasks',
        mode: 'empty',
        message: `No task archive found for context pack ${contextPackName}.`,
        tasks: [],
      };
      return { ok: true, response };
    }

    const tasks: ArchivedTaskEntry[] = [];

    for (const year of yearDirs) {
      const yearPath = join(archiveRoot, year);
      let candidates: ArchiveCandidate[];
      try {
        const entries = await fsReadDir(yearPath, { withFileTypes: true });
        candidates = entries.flatMap((entry) => {
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) {
              return [];
            }
            return [{
              fallbackName: entry.name,
              mdPath: join(yearPath, entry.name, 'archive.md'),
            }];
          }
          if (!entry.isFile() || !entry.name.endsWith('.md')) {
            return [];
          }
          return [{
            fallbackName: basename(entry.name, '.md'),
            mdPath: join(yearPath, entry.name),
          }];
        });
      } catch {
        continue;
      }

      for (const candidate of candidates) {
        try {
          const [head, sidecar, existingPlannerFocusSnapshot] = await Promise.all([
            readFileHead(candidate.mdPath),
            readJsonSidecar(candidate.mdPath),
            readValidPlannerFocusSnapshot(candidate.mdPath),
          ]);
          const taskId = sidecar.task_id || extractTaskId(head) || candidate.fallbackName;
          const title = extractTitle(head) || candidate.fallbackName;
          const summary = sidecar.completed_work_summary || sidecar.task_summary || '';
          const branchHandoffs = normalizeBranchHandoffs(sidecar.branch_handoffs);
          const plannerFocusSnapshot = existingPlannerFocusSnapshot ?? synthesizePlannerFocusSnapshot({
            archivedContextPackDir: join(REPO_ROOT, 'contextpacks', contextPackName),
            contextPackName,
            title,
            sidecar,
            branchHandoffs,
          });
          if (!existingPlannerFocusSnapshot && plannerFocusSnapshot) {
            await writePlannerFocusSnapshotIfMissing({
              mirrorMdPath: candidate.mdPath,
              snapshot: plannerFocusSnapshot,
            });
          }
          tasks.push({
            taskId,
            title,
            summary,
            rootTaskId: sidecar.root_task_id || taskId,
            qmdRecordId: sidecar.record_id || '',
            followupReason: sidecar.followup_reason || '',
            year,
            archivePath: candidate.mdPath,
            contextPackName,
            branchHandoffs,
            ...(plannerFocusSnapshot ? { plannerFocusSnapshot } : {}),
            parentTaskContent: buildParentTaskContent(title, sidecar),
          });
        } catch {
          continue;
        }
      }
    }

    if (tasks.length === 0) {
      const response: PlannerListArchivedTasksResponse = {
        action: 'planner.listArchivedTasks',
        mode: 'empty',
        message: `No archived completed tasks found for context pack ${contextPackName}.`,
        tasks: [],
      };
      return { ok: true, response };
    }

    const response: PlannerListArchivedTasksResponse = {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: `Found ${tasks.length} archived task(s) in ${contextPackName}.`,
      tasks,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.listArchivedTasks',
      error: error instanceof Error ? error.message : 'Failed to list archived tasks.',
    };
  }
}
