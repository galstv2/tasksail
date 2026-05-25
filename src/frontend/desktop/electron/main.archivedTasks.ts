/**
 * Archived task listing for the planner child-task parent selection dropdown.
 */
import { lstat as fsLstat, mkdir as fsMkdir, open as fsOpen, readdir as fsReadDir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import type {
  ArchivedTaskBranchChainAvailability,
  ArchivedTaskBranchHandoff,
  ArchivedTaskChildParentEligibility,
  ArchivedTaskEntry,
  ArchivedTaskParentContextArtifacts,
  ArchivedTaskParentContextFile,
  ContextPackListResponse,
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
} from '../src/shared/desktopContract';
import { validatePlannerFocusSnapshot } from '../src/shared/desktopContractValidators';
import { createLogger } from '../../../backend/platform/core/index.js';
import { readChildTaskChains, type ChildTaskChainsState } from '../../../backend/platform/queue/childTaskChains.js';
import { loadTaskRegistry, type TaskRegistry } from '../../../backend/platform/queue/taskRegistry.js';
import { REPO_ROOT } from './paths';
import { buildChildParentBlockedTips, hasChildParentBlockedTipCandidates } from './childParentBlockedTips';
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
const log = createLogger('desktop/main.archivedTasks');
const HANDOFF_CONTEXT_FILE_ORDER = [
  'intake.md',
  'implementation-spec.md',
  'final-summary.md',
  'issues.md',
  'parallel-ok.md',
] as const;
const REQUIRED_HANDOFF_CONTEXT_FILES = new Set<string>([
  'intake.md',
  'implementation-spec.md',
  'final-summary.md',
]);
const OPTIONAL_HANDOFF_CONTEXT_FILES = new Set<string>(['issues.md', 'parallel-ok.md']);

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

function archiveArtifactInfo(candidate: ArchiveCandidate): {
  archiveLayout: 'flat' | 'nested';
  archiveArtifactDir: string | null;
} {
  const archiveLayout = archiveLayoutForMarkdown(candidate.mdPath);
  return {
    archiveLayout,
    archiveArtifactDir: archiveLayout === 'nested' ? dirname(candidate.mdPath) : null,
  };
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
  parent_task_id?: string;
  child_depth?: unknown;
  parent_resolution?: string;
  followup_reason?: string;
  indexed_at?: string;
  created_at?: string;
  completed_work_summary?: string;
  task_summary?: string;
  key_decisions?: unknown;
  known_limitations?: unknown;
  constraints?: unknown;
  implementation_summary?: string;
  branch_handoffs?: unknown;
};

type PlannerFocusSnapshot = NonNullable<ArchivedTaskEntry['plannerFocusSnapshot']>;
type BranchHandoffReadResult = {
  handoffs?: ArchivedTaskBranchHandoff[];
  availability: ArchivedTaskBranchChainAvailability;
};
type ParentContextArtifactDiscovery = {
  parentContextArtifacts: ArchivedTaskParentContextArtifacts;
  handoffArtifactsManifestPath: string | null;
};

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseArchiveBasenameTimestamp(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})z/iu);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== iso.replace('Z', '.000Z')
    ? null
    : iso;
}

async function archivedAtForCandidate(candidate: ArchiveCandidate, sidecar: JsonSidecar): Promise<string | null> {
  const indexedAt = trimString(sidecar.indexed_at);
  if (indexedAt) return indexedAt;
  const createdAt = trimString(sidecar.created_at);
  if (createdAt) return createdAt;

  const layout = archiveLayoutForMarkdown(candidate.mdPath);
  const basenameToParse = layout === 'nested'
    ? basename(dirname(candidate.mdPath))
    : basename(candidate.mdPath, '.md');
  const parsed = parseArchiveBasenameTimestamp(basenameToParse);
  if (parsed) return parsed;

  try {
    const stat = await fsLstat(candidate.mdPath);
    if (!stat.isSymbolicLink() && stat.isFile()) {
      return stat.mtime.toISOString();
    }
  } catch {
    return null;
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function trimStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeBranchHandoffs(value: unknown): BranchHandoffReadResult {
  if (value === undefined || value === null) {
    return {
      availability: {
        status: 'missing-branch-handoffs',
        message: 'Archive sidecar does not include branch_handoffs.',
      },
    };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return invalidBranchHandoffs('Archive sidecar branch_handoffs is not a non-empty array.');
  }
  const handoffs: ArchivedTaskBranchHandoff[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return invalidBranchHandoffs('Archive sidecar branch_handoffs contains a non-object entry.');
    }
    const raw = item as Record<string, unknown>;
    if (
      !isNonEmptyString(raw.repo_root) ||
      !isNonEmptyString(raw.repo_label) ||
      !isNonEmptyString(raw.branch) ||
      !isNonEmptyString(raw.base_commit_sha) ||
      !isNonEmptyString(raw.head_commit_sha) ||
      !isNonEmptyString(raw.status)
    ) {
      return invalidBranchHandoffs('Archive sidecar branch_handoffs contains an entry missing required fields.');
    }
    const commitsAhead = typeof raw.commits_ahead === 'number'
      ? raw.commits_ahead
      : isNonEmptyString(raw.commits_ahead)
        ? Number(raw.commits_ahead.trim())
        : Number.NaN;
    if (!Number.isFinite(commitsAhead)) {
      return invalidBranchHandoffs('Archive sidecar branch_handoffs contains invalid commits_ahead.');
    }
    const autoMerge = normalizeAutoMerge(raw.auto_merge);
    if (raw.auto_merge !== undefined && !autoMerge) {
      return invalidBranchHandoffs('Archive sidecar branch_handoffs contains invalid auto_merge data.');
    }
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
  return {
    handoffs,
    availability: {
      status: 'ready',
      message: 'Archive sidecar contains valid branch_handoffs.',
    },
  };
}

function invalidBranchHandoffs(message: string): BranchHandoffReadResult {
  return {
    availability: {
      status: 'invalid-branch-handoffs',
      message,
    },
  };
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

async function discoverParentContextArtifacts(
  archiveArtifactDir: string | null,
): Promise<ParentContextArtifactDiscovery> {
  if (!archiveArtifactDir) {
    return {
      parentContextArtifacts: {
        status: 'legacy-flat-archive',
        archiveArtifactDir: null,
        handoffsDir: null,
        implementationStepsDir: null,
        handoffs: [],
        implementationSteps: [],
        missing: [],
      },
      handoffArtifactsManifestPath: null,
    };
  }

  const [handoffsDir, implementationStepsDir, handoffArtifactsManifestPath] = await Promise.all([
    existingDirectory(join(archiveArtifactDir, 'handoffs')),
    existingDirectory(join(archiveArtifactDir, 'ImplementationSteps')),
    existingRegularFile(join(archiveArtifactDir, 'handoff-artifacts-manifest.json')),
  ]);
  const [handoffs, implementationSteps] = await Promise.all([
    handoffsDir ? readHandoffContextFiles(archiveArtifactDir, handoffsDir) : Promise.resolve([]),
    implementationStepsDir
      ? readImplementationStepFiles(archiveArtifactDir, implementationStepsDir)
      : Promise.resolve([]),
  ]);
  const missing = [
    ...(handoffsDir ? [] : ['handoffs']),
    ...(implementationStepsDir ? [] : ['ImplementationSteps']),
    ...(handoffArtifactsManifestPath ? [] : ['handoff-artifacts-manifest.json']),
  ];

  return {
    parentContextArtifacts: {
      status: handoffs.length > 0 || implementationSteps.length > 0 ? 'available' : 'missing-artifacts',
      archiveArtifactDir,
      handoffsDir,
      implementationStepsDir,
      handoffs,
      implementationSteps,
      missing,
    },
    handoffArtifactsManifestPath,
  };
}

async function existingDirectory(dirPath: string): Promise<string | null> {
  try {
    return (await fsLstat(dirPath)).isDirectory() ? dirPath : null;
  } catch {
    return null;
  }
}

async function existingRegularFile(filePath: string): Promise<string | null> {
  try {
    return (await fsLstat(filePath)).isFile() ? filePath : null;
  } catch {
    return null;
  }
}

async function readHandoffContextFiles(
  archiveArtifactDir: string,
  handoffsDir: string,
): Promise<ArchivedTaskParentContextFile[]> {
  const entries = await safeReadDir(handoffsDir);
  const byName = new Map(entries.filter((entry) => entry.isFile()).map((entry) => [entry.name, entry]));
  const files: ArchivedTaskParentContextFile[] = [];
  for (const fileName of HANDOFF_CONTEXT_FILE_ORDER) {
    if (!byName.has(fileName)) continue;
    if (OPTIONAL_HANDOFF_CONTEXT_FILES.has(fileName) && !(await isSubstantiveHandoff(join(handoffsDir, fileName)))) {
      continue;
    }
    if (!REQUIRED_HANDOFF_CONTEXT_FILES.has(fileName) && !OPTIONAL_HANDOFF_CONTEXT_FILES.has(fileName)) {
      continue;
    }
    const contextFile = await buildParentContextFile('handoff', archiveArtifactDir, join(handoffsDir, fileName));
    if (contextFile) files.push(contextFile);
  }
  return files;
}

async function readImplementationStepFiles(
  archiveArtifactDir: string,
  implementationStepsDir: string,
): Promise<ArchivedTaskParentContextFile[]> {
  const entries = await safeReadDir(implementationStepsDir);
  const files: ArchivedTaskParentContextFile[] = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))) {
    const contextFile = await buildParentContextFile(
      'implementation-step',
      archiveArtifactDir,
      join(implementationStepsDir, entry.name),
    );
    if (contextFile) files.push(contextFile);
  }
  return files;
}

async function safeReadDir(dirPath: string): Promise<Dirent[]> {
  try {
    return await fsReadDir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function buildParentContextFile(
  kind: ArchivedTaskParentContextFile['kind'],
  archiveArtifactDir: string,
  filePath: string,
): Promise<ArchivedTaskParentContextFile | null> {
  const meta = await fsLstat(filePath);
  if (!meta.isFile()) return null;
  return {
    kind,
    fileName: basename(filePath),
    path: filePath,
    relativePath: relative(archiveArtifactDir, filePath).split('\\').join('/'),
    sizeBytes: meta.size,
  };
}

async function isSubstantiveHandoff(filePath: string): Promise<boolean> {
  const withoutComments = (await fsReadFile(filePath, 'utf-8')).replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line !== '' && !/^#{1,6}\s/.test(line));
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

async function readChildChainStateForListing(): Promise<{
  state: ChildTaskChainsState | null;
  status?: NonNullable<PlannerListArchivedTasksResponse['childChainStateStatus']>;
}> {
  try {
    return { state: await readChildTaskChains(REPO_ROOT) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('archived-tasks.child-chain-state.invalid', { error: message });
    return {
      state: null,
      status: { status: 'invalid', message },
    };
  }
}

async function readTaskRegistryForBlockedTips(
  activeScope: ActiveContextPackTaskScope,
  childChainState: ChildTaskChainsState | null,
): Promise<TaskRegistry | null> {
  if (!childChainState || !hasChildParentBlockedTipCandidates(childChainState, activeScope)) {
    return null;
  }
  try {
    return await loadTaskRegistry(REPO_ROOT);
  } catch (error) {
    log.warn('archived-tasks.child-parent-blocked-tips.registry-unavailable', {
      contextPackId: activeScope.contextPackId,
      contextPackDir: activeScope.contextPackDir,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function attachChildParentBlockedTips(
  response: PlannerListArchivedTasksResponse,
  activeScope: ActiveContextPackTaskScope,
  childChainState: ChildTaskChainsState | null,
  taskRegistry: TaskRegistry | null,
): PlannerListArchivedTasksResponse {
  if (!childChainState) return response;
  const childParentBlockedTips = buildChildParentBlockedTips({
    state: childChainState,
    archiveTasks: response.tasks,
    taskRegistry,
    scope: activeScope,
  });
  if (childParentBlockedTips.length === 0) return response;
  log.debug('archived-tasks.child-parent-blocked-tips.emitted', {
    count: childParentBlockedTips.length,
    contextPackId: activeScope.contextPackId,
    contextPackDir: activeScope.contextPackDir,
    tips: childParentBlockedTips.map((tip) => ({
      rootTaskId: tip.rootTaskId,
      currentTipTaskId: tip.currentTipTaskId,
      chainState: tip.chainState,
      boardState: tip.boardState,
    })),
  });
  return { ...response, childParentBlockedTips };
}

function childChainForTask(
  state: ChildTaskChainsState | null,
  taskId: string,
): ArchivedTaskEntry['childChain'] {
  const task = state?.tasks[taskId];
  if (!task) return undefined;
  const chain = state?.chains[task.rootTaskId];
  if (!chain) return undefined;
  return {
    rootTaskId: task.rootTaskId,
    parentTaskId: task.parentTaskId,
    previousTaskId: task.previousTaskId,
    depth: task.depth,
    state: task.state,
    currentTipTaskId: chain.currentTipTaskId,
    isCurrentTip: chain.currentTipTaskId === taskId,
    archivePath: task.archivePath,
    archiveArtifactDir: task.archiveArtifactDir,
    parentArchivePath: task.parentArchivePath,
    parentArchiveArtifactDir: task.parentArchiveArtifactDir,
  };
}

function childParentEligibilityForTask(args: {
  state: ChildTaskChainsState | null;
  stateStatus?: NonNullable<PlannerListArchivedTasksResponse['childChainStateStatus']>;
  taskId: string;
  rootTaskId: string;
  parentTaskId?: string;
}): ArchivedTaskChildParentEligibility {
  const resolvedRootTaskId = args.rootTaskId.trim() || args.taskId;
  if (args.stateStatus?.status === 'invalid') {
    return {
      eligible: false,
      reason: 'child-chain-state-invalid',
      message: 'Child-task chain state must be repaired before choosing a parent task.',
      rootTaskId: resolvedRootTaskId,
      currentTipTaskId: null,
      currentTipState: null,
    };
  }

  const task = args.state?.tasks[args.taskId];
  if (task) {
    const chain = args.state?.chains[task.rootTaskId];
    const currentTipTaskId = chain?.currentTipTaskId ?? null;
    const currentTipState = currentTipTaskId ? args.state?.tasks[currentTipTaskId]?.state ?? null : null;
    if (!chain) {
      return {
        eligible: false,
        reason: 'not-current-chain-tip',
        message: 'This archived task is not the current child-chain tip.',
        rootTaskId: task.rootTaskId,
        currentTipTaskId,
        currentTipState,
      };
    }
    if (chain.currentTipTaskId === args.taskId) {
      if (task.state === 'completed') {
        return {
          eligible: true,
          reason: 'current-chain-tip',
          message: 'This archived task is the completed current child-chain tip.',
          rootTaskId: task.rootTaskId,
          currentTipTaskId: chain.currentTipTaskId,
          currentTipState: task.state,
        };
      }
      return {
        eligible: false,
        reason: 'chain-tip-state-not-completed',
        message: 'The current child-chain tip is not completed yet.',
        rootTaskId: task.rootTaskId,
        currentTipTaskId: chain.currentTipTaskId,
        currentTipState: task.state,
      };
    }
    if (currentTipState && currentTipState !== 'completed') {
      return {
        eligible: false,
        reason: 'reserved-by-unarchived-tip',
        message: 'A non-completed child already reserves the next child-chain tip.',
        rootTaskId: task.rootTaskId,
        currentTipTaskId: chain.currentTipTaskId,
        currentTipState,
      };
    }
    return {
      eligible: false,
      reason: 'not-current-chain-tip',
      message: 'Only the current child-chain tip can be used as the next parent.',
      rootTaskId: task.rootTaskId,
      currentTipTaskId: chain.currentTipTaskId,
      currentTipState,
    };
  }

  const parentTaskId = args.parentTaskId?.trim();
  const isStandaloneRoot = !parentTaskId && (!args.rootTaskId.trim() || args.rootTaskId === args.taskId);
  if (isStandaloneRoot) {
    return {
      eligible: true,
      reason: 'standalone-root',
      message: 'This standalone root task can start a child-task chain.',
      rootTaskId: args.taskId,
      currentTipTaskId: null,
      currentTipState: null,
    };
  }
  return {
    eligible: false,
    reason: 'legacy-child-without-chain-state',
    message: 'Legacy archived child tasks without child-chain state cannot start a new chain.',
    rootTaskId: resolvedRootTaskId,
    currentTipTaskId: null,
    currentTipState: null,
  };
}

function childDepthFromSidecar(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
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
    const childChainStateRead = await readChildChainStateForListing();
    const taskRegistryForBlockedTips = await readTaskRegistryForBlockedTips(activeScope, childChainStateRead.state);
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
        ...(childChainStateRead.status ? { childChainStateStatus: childChainStateRead.status } : {}),
      };
      return {
        ok: true,
        response: attachChildParentBlockedTips(response, activeScope, childChainStateRead.state, taskRegistryForBlockedTips),
      };
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
          const archivedAt = await archivedAtForCandidate(candidate, sidecar);
          const branchHandoffRead = normalizeBranchHandoffs(sidecar.branch_handoffs);
          const branchHandoffs = branchHandoffRead.handoffs;
          const artifactInfo = archiveArtifactInfo(candidate);
          const {
            parentContextArtifacts,
            handoffArtifactsManifestPath,
          } = await discoverParentContextArtifacts(artifactInfo.archiveArtifactDir);
          const childDepth = childDepthFromSidecar(sidecar.child_depth);
          const childChain = childChainForTask(childChainStateRead.state, taskId);
          const rootTaskId = sidecar.root_task_id || taskId;
          const parentTaskId = trimString(sidecar.parent_task_id);
          const childParentEligibility = childParentEligibilityForTask({
            state: childChainStateRead.state,
            stateStatus: childChainStateRead.status,
            taskId,
            rootTaskId,
            ...(parentTaskId ? { parentTaskId } : {}),
          });
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
            rootTaskId,
            qmdRecordId: sidecar.record_id || '',
            followupReason: sidecar.followup_reason || '',
            year,
            archivePath: candidate.mdPath,
            archivedAt,
            contextPackName,
            ...artifactInfo,
            handoffsDir: parentContextArtifacts.handoffsDir,
            implementationStepsDir: parentContextArtifacts.implementationStepsDir,
            handoffArtifactsManifestPath,
            parentContextArtifacts,
            branchChainAvailability: branchHandoffRead.availability,
            ...(branchHandoffs ? { branchHandoffs } : {}),
            ...(parentTaskId ? { parentTaskId } : {}),
            ...(childDepth !== undefined ? { childDepth } : {}),
            ...(trimString(sidecar.parent_resolution) ? { parentResolution: trimString(sidecar.parent_resolution) } : {}),
            ...(childChain ? { childChain } : {}),
            childParentEligibility,
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
        ...(childChainStateRead.status ? { childChainStateStatus: childChainStateRead.status } : {}),
      };
      return {
        ok: true,
        response: attachChildParentBlockedTips(response, activeScope, childChainStateRead.state, taskRegistryForBlockedTips),
      };
    }

    const hiddenByReason = tasks.reduce<Record<string, number>>((counts, task) => {
      const eligibility = task.childParentEligibility;
      if (eligibility?.eligible === false) {
        counts[eligibility.reason] = (counts[eligibility.reason] ?? 0) + 1;
      }
      return counts;
    }, {});
    if (Object.keys(hiddenByReason).length > 0) {
      log.debug('archived-tasks.child-parent-eligibility.filtered', { countsByReason: hiddenByReason });
    }

    const response: PlannerListArchivedTasksResponse = {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: `Found ${tasks.length} archived task(s) in ${contextPackName}.`,
      tasks,
      ...(childChainStateRead.status ? { childChainStateStatus: childChainStateRead.status } : {}),
    };
    return {
      ok: true,
      response: attachChildParentBlockedTips(response, activeScope, childChainStateRead.state, taskRegistryForBlockedTips),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.listArchivedTasks',
      error: error instanceof Error ? error.message : 'Failed to list archived tasks.',
    };
  }
}
