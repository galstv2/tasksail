import path from 'node:path';
import { readTextFile, safeJsonParse, writeTextFileAtomic } from '../core/index.js';
import { isNonEmptyString, parseBranchChainBinding, type TaskBranchChainBinding } from './markdown.js';
import { isRepositoryTypesRecord, type ContextPackRepositoryTypes } from './repositoryTypes.js';
export const CHILD_TASK_CHAINS_SCHEMA_VERSION = 1;
export type ChildTaskChainTaskState = 'planned' | 'pending' | 'active' | 'completed' | 'failed';
export interface ChildTaskContextSnapshot {
  contextPackDir: string | null;
  contextPackId: string | null;
  scopeMode: string | null;
  primaryRepoId: string | null;
  primaryFocusId: string | null;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  repositoryTypes?: ContextPackRepositoryTypes;
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: 'directory' | 'file' | null;
  selectedFocusTargets: unknown[];
  selectedTestTarget: unknown | null;
  selectedSupportTargets: unknown[];
}
export interface ChildTaskChainRecord {
  rootTaskId: string;
  currentTipTaskId: string;
  contextPackId: string | null;
  contextPackDir: string | null;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface ChildTaskCompletedBranchHandoff {
  repoRoot: string;
  repoLabel: string;
  chainSourceBranch: string;
  baseCommitSha: string;
  headCommitSha: string;
  commitsAhead: number;
  status: 'ready-for-operator-review' | 'auto-merged-to-target';
  targetBranch: string | null;
}
export interface ChildTaskChainTaskRecord {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  previousTaskId: string | null;
  depth: number;
  state: ChildTaskChainTaskState;
  archivePath: string | null;
  archiveArtifactDir: string | null;
  parentArchivePath: string | null;
  parentArchiveArtifactDir: string | null;
  parentContextSnapshot: ChildTaskContextSnapshot | null;
  childExecutionScope: ChildTaskContextSnapshot | null;
  branchChain: TaskBranchChainBinding | null;
  completedBranchHandoffs: ChildTaskCompletedBranchHandoff[] | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ChildTaskChainsState {
  schemaVersion: 1;
  updatedAt: string;
  chains: Record<string, ChildTaskChainRecord>;
  tasks: Record<string, ChildTaskChainTaskRecord>;
}
const STATE_VALUES = new Set<ChildTaskChainTaskState>(['planned', 'pending', 'active', 'completed', 'failed']);
export function resolveChildTaskChainsPath(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'child-task-chains.json');
}
export function emptyChildTaskChainsState(now = new Date().toISOString()): ChildTaskChainsState {
  return {
    schemaVersion: CHILD_TASK_CHAINS_SCHEMA_VERSION,
    updatedAt: now,
    chains: {},
    tasks: {},
  };
}
export async function readChildTaskChains(repoRoot: string): Promise<ChildTaskChainsState> {
  const statePath = resolveChildTaskChainsPath(repoRoot);
  const raw = await readTextFile(statePath);
  if (raw === undefined) {
    return emptyChildTaskChainsState();
  }
  const parsed = safeJsonParse<unknown>(raw, statePath);
  if (
    parsed
    && typeof parsed === 'object'
    && 'schemaVersion' in parsed
    && (parsed as { schemaVersion?: unknown }).schemaVersion !== CHILD_TASK_CHAINS_SCHEMA_VERSION
  ) {
    throw new Error('child-task-chains-stale-schema: unsupported schemaVersion');
  }
  return normalizeChildTaskChainsState(parsed);
}
export async function writeChildTaskChains(repoRoot: string, state: ChildTaskChainsState): Promise<void> {
  const normalized = normalizeChildTaskChainsState({
    ...state,
    schemaVersion: CHILD_TASK_CHAINS_SCHEMA_VERSION,
  });
  await writeTextFileAtomic(
    resolveChildTaskChainsPath(repoRoot),
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
}
export function isCurrentChainTip(state: ChildTaskChainsState, taskId: string): boolean {
  return Object.values(state.chains).some((chain) => chain.currentTipTaskId === taskId);
}
export function findChainForTask(state: ChildTaskChainsState, taskId: string): ChildTaskChainRecord | null {
  const rootTaskId = state.tasks[taskId]?.rootTaskId;
  return rootTaskId ? state.chains[rootTaskId] ?? null : null;
}
export async function advanceChildTaskChainTip(repoRoot: string, rootTaskId: string, taskId: string): Promise<ChildTaskChainsState> {
  const state = await readChildTaskChains(repoRoot);
  const chain = state.chains[rootTaskId];
  const task = state.tasks[taskId];
  if (!chain || !task || task.rootTaskId !== rootTaskId) {
    throw new Error('child-task-chains-invalid-schema: cannot advance missing or mismatched chain task');
  }
  const now = new Date().toISOString();
  const updated: ChildTaskChainsState = {
    ...state,
    updatedAt: now,
    chains: {
      ...state.chains,
      [rootTaskId]: {
        ...chain,
        currentTipTaskId: taskId,
        updatedAt: now,
      },
    },
  };
  await writeChildTaskChains(repoRoot, updated);
  return updated;
}
function normalizeChildTaskChainsState(value: unknown): ChildTaskChainsState {
  if (!value || typeof value !== 'object') invalidSchema();
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== CHILD_TASK_CHAINS_SCHEMA_VERSION
    || !isIsoString(candidate.updatedAt)
    || !isPlainRecord(candidate.chains)
    || !isPlainRecord(candidate.tasks)
  ) {
    invalidSchema();
  }
  const chains = normalizeChains(candidate.chains);
  const tasks = normalizeTasks(candidate.tasks);
  validateIndexes(chains, tasks);
  return {
    schemaVersion: CHILD_TASK_CHAINS_SCHEMA_VERSION,
    updatedAt: candidate.updatedAt,
    chains,
    tasks,
  };
}
function normalizeChains(value: Record<string, unknown>): Record<string, ChildTaskChainRecord> {
  const chains: Record<string, ChildTaskChainRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object') invalidSchema();
    const chain = raw as Record<string, unknown>;
    if (
      key !== chain.rootTaskId
      || !isNonEmptyString(chain.rootTaskId)
      || !isNonEmptyString(chain.currentTipTaskId)
      || !isNullableString(chain.contextPackId)
      || !isNullableString(chain.contextPackDir)
      || !isStringArray(chain.taskIds)
      || !isIsoString(chain.createdAt)
      || !isIsoString(chain.updatedAt)
    ) {
      invalidSchema();
    }
    chains[key] = {
      rootTaskId: chain.rootTaskId,
      currentTipTaskId: chain.currentTipTaskId,
      contextPackId: chain.contextPackId,
      contextPackDir: chain.contextPackDir,
      taskIds: chain.taskIds,
      createdAt: chain.createdAt,
      updatedAt: chain.updatedAt,
    };
  }
  return chains;
}
function normalizeTasks(value: Record<string, unknown>): Record<string, ChildTaskChainTaskRecord> {
  const tasks: Record<string, ChildTaskChainTaskRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object') invalidSchema();
    const task = raw as Record<string, unknown>;
    const branchChain = task.branchChain === null ? null : parseBranchChainBinding(task.branchChain);
    const parentContextSnapshot = normalizeContextSnapshot(task.parentContextSnapshot);
    const childExecutionScope = normalizeContextSnapshot(task.childExecutionScope);
    const completedBranchHandoffs = normalizeCompletedBranchHandoffs(task.completedBranchHandoffs);
    if (
      key !== task.taskId
      || !isNonEmptyString(task.taskId)
      || !isNonEmptyString(task.rootTaskId)
      || !isNullableString(task.parentTaskId)
      || !isNullableString(task.previousTaskId)
      || !Number.isInteger(task.depth)
      || (task.depth as number) < 0
      || !STATE_VALUES.has(task.state as ChildTaskChainTaskState)
      || !isNullableString(task.archivePath)
      || !isNullableString(task.archiveArtifactDir)
      || !isNullableString(task.parentArchivePath)
      || !isNullableString(task.parentArchiveArtifactDir)
      || parentContextSnapshot === undefined
      || childExecutionScope === undefined
      || (task.branchChain !== null && branchChain === null)
      || completedBranchHandoffs === undefined
      || !(task.completedAt === undefined || task.completedAt === null || isIsoString(task.completedAt))
      || !isIsoString(task.createdAt)
      || !isIsoString(task.updatedAt)
    ) {
      invalidSchema();
    }
    tasks[key] = {
      taskId: task.taskId,
      rootTaskId: task.rootTaskId,
      parentTaskId: task.parentTaskId,
      previousTaskId: task.previousTaskId,
      depth: task.depth as number,
      state: task.state as ChildTaskChainTaskState,
      archivePath: task.archivePath,
      archiveArtifactDir: task.archiveArtifactDir,
      parentArchivePath: task.parentArchivePath,
      parentArchiveArtifactDir: task.parentArchiveArtifactDir,
      parentContextSnapshot,
      childExecutionScope,
      branchChain,
      completedBranchHandoffs,
      completedAt: task.completedAt ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
  return tasks;
}

function normalizeCompletedBranchHandoffs(value: unknown): ChildTaskCompletedBranchHandoff[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const handoffs: ChildTaskCompletedBranchHandoff[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return undefined;
    const handoff = raw as Record<string, unknown>;
    if (
      !isNonEmptyString(handoff.repoRoot)
      || !isNonEmptyString(handoff.repoLabel)
      || !isNonEmptyString(handoff.chainSourceBranch)
      || !isNonEmptyString(handoff.baseCommitSha)
      || !isNonEmptyString(handoff.headCommitSha)
      || !Number.isInteger(handoff.commitsAhead)
      || (handoff.commitsAhead as number) < 0
      || (handoff.status !== 'ready-for-operator-review' && handoff.status !== 'auto-merged-to-target')
      || !(handoff.targetBranch === null || isNonEmptyString(handoff.targetBranch))
    ) {
      return undefined;
    }
    handoffs.push({
      repoRoot: handoff.repoRoot,
      repoLabel: handoff.repoLabel,
      chainSourceBranch: handoff.chainSourceBranch,
      baseCommitSha: handoff.baseCommitSha,
      headCommitSha: handoff.headCommitSha,
      commitsAhead: handoff.commitsAhead as number,
      status: handoff.status,
      targetBranch: handoff.targetBranch,
    });
  }
  return handoffs;
}
function validateIndexes(chains: Record<string, ChildTaskChainRecord>, tasks: Record<string, ChildTaskChainTaskRecord>): void {
  const taskMembership = new Set<string>();
  for (const [rootTaskId, chain] of Object.entries(chains)) {
    if (!chain.taskIds.includes(chain.currentTipTaskId) || !tasks[chain.currentTipTaskId]) {
      invalidSchema();
    }
    for (const taskId of chain.taskIds) {
      const task = tasks[taskId];
      if (!task || task.rootTaskId !== rootTaskId || taskMembership.has(taskId)) {
        invalidSchema();
      }
      taskMembership.add(taskId);
    }
  }
  for (const task of Object.values(tasks)) {
    if (!chains[task.rootTaskId] || !taskMembership.has(task.taskId)) {
      invalidSchema();
    }
    if (task.branchChain) {
      if (
        task.parentTaskId === null
        || task.branchChain.rootTaskId !== task.rootTaskId
        || task.branchChain.parentTaskId !== task.parentTaskId
        || task.branchChain.depth !== task.depth
      ) {
        invalidSchema();
      }
    }
  }
}
function normalizeContextSnapshot(value: unknown): ChildTaskContextSnapshot | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const snapshot = value as Record<string, unknown>;
  if (!(isNullableString(snapshot.contextPackDir)
    && isNullableString(snapshot.contextPackId)
    && isNullableString(snapshot.scopeMode)
    && isNullableString(snapshot.primaryRepoId)
    && isNullableString(snapshot.primaryFocusId)
    && isStringArray(snapshot.selectedRepoIds)
    && isStringArray(snapshot.selectedFocusIds)
    && (snapshot.repositoryTypes === undefined || isRepositoryTypesRecord(snapshot.repositoryTypes))
    && typeof snapshot.deepFocusEnabled === 'boolean'
    && isNullableString(snapshot.deepFocusPrimaryRepoId)
    && isNullableString(snapshot.deepFocusPrimaryFocusId)
    && (snapshot.selectedFocusPath === undefined || isNullableString(snapshot.selectedFocusPath))
    && (
      snapshot.selectedFocusTargetKind === undefined
      || snapshot.selectedFocusTargetKind === null
      || snapshot.selectedFocusTargetKind === 'directory'
      || snapshot.selectedFocusTargetKind === 'file'
    )
    && Array.isArray(snapshot.selectedFocusTargets)
    && isJsonValue(snapshot.selectedTestTarget)
    && Array.isArray(snapshot.selectedSupportTargets))) {
    return undefined;
  }
  return {
    contextPackDir: snapshot.contextPackDir,
    contextPackId: snapshot.contextPackId,
    scopeMode: snapshot.scopeMode,
    primaryRepoId: snapshot.primaryRepoId,
    primaryFocusId: snapshot.primaryFocusId,
    selectedRepoIds: snapshot.selectedRepoIds,
    selectedFocusIds: snapshot.selectedFocusIds,
    ...(snapshot.repositoryTypes ? { repositoryTypes: { ...snapshot.repositoryTypes } } : {}),
    deepFocusEnabled: snapshot.deepFocusEnabled,
    deepFocusPrimaryRepoId: snapshot.deepFocusPrimaryRepoId,
    deepFocusPrimaryFocusId: snapshot.deepFocusPrimaryFocusId,
    selectedFocusPath: snapshot.selectedFocusPath ?? null,
    selectedFocusTargetKind: snapshot.selectedFocusTargetKind ?? null,
    selectedFocusTargets: snapshot.selectedFocusTargets,
    selectedTestTarget: snapshot.selectedTestTarget,
    selectedSupportTargets: snapshot.selectedSupportTargets,
  };
}
function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function isIsoString(value: unknown): value is string { return isNonEmptyString(value) && !Number.isNaN(Date.parse(value)); }
function invalidSchema(): never {
  throw new Error('child-task-chains-invalid-schema: invalid child task chain state');
}
