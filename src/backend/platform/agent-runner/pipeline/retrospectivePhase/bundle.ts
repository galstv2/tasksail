import path from 'node:path';
import { readdir } from 'node:fs/promises';

import { readTextFile, safeJsonParse, slugify, stripHtmlComments } from '../../../core/index.js';
import { getLabelValue } from '../../../queue/artifacts.js';
import {
  RETROSPECTIVE_CYCLE_LENGTH,
  RETROSPECTIVE_REQUIRED_LABEL,
} from '../../../queue/retrospectiveFlag.js';
import { parseMetadata, parseSections } from '../../../workflow-policy/artifacts.js';
import type { CycleTaskContext } from '../retrospectivePhase.js';

const MAX_PRIOR_TASKS = RETROSPECTIVE_CYCLE_LENGTH - 1;

interface CounterPayload {
  cycle_task_ids?: unknown;
}

interface ArchivePayload {
  task_id?: unknown;
  task_title?: unknown;
  title?: unknown;
  task_summary?: unknown;
  completed_work_summary?: unknown;
  key_decisions?: unknown;
  known_limitations?: unknown;
  difficulty_level?: unknown;
  repo_name?: unknown;
  indexed_at?: unknown;
  completed_at_utc?: unknown;
}

interface RetrospectivePayload {
  retrospective_summary?: unknown;
  what_went_well?: unknown;
  what_could_have_gone_better?: unknown;
  action_items?: unknown;
}

interface ArchiveRecord {
  taskId: string;
  path: string;
  payload: ArchivePayload;
}

export async function shouldRunRetrospectivePhase(handoffsDir: string): Promise<boolean> {
  const content = await readTextFile(path.join(handoffsDir, 'retrospective-input.md'));
  return Boolean(content) && normalizeBooleanLabel(getLabelValue(content!, RETROSPECTIVE_REQUIRED_LABEL)) === 'true';
}

export async function buildCycleContextBundle(options: {
  repoRoot: string;
  contextPackDir: string;
  handoffsDir: string;
  currentTaskId: string;
}): Promise<CycleTaskContext[]> {
  const qmdScopeRoot = await resolveQmdScopeRoot(options);
  const archiveRoot = path.join(options.contextPackDir, qmdScopeRoot);
  const selectedPriorIds = await selectPriorTaskIds({
    repoRoot: options.repoRoot,
    contextPackDir: options.contextPackDir,
    archiveRoot,
    currentTaskId: options.currentTaskId,
  });

  const [archived, current] = await Promise.all([
    Promise.all(selectedPriorIds.map((taskId) => buildArchivedEntry(archiveRoot, taskId))),
    buildCurrentEntry(options.handoffsDir, options.currentTaskId),
  ]);
  return [...archived, current];
}

function normalizeBooleanLabel(value: string | undefined): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}

async function selectPriorTaskIds(options: {
  repoRoot: string;
  contextPackDir: string;
  archiveRoot: string;
  currentTaskId: string;
}): Promise<string[]> {
  const selected = uniqueRecent(await readCounterTaskIds(options.repoRoot, options.contextPackDir), options.currentTaskId);
  if (selected.length < MAX_PRIOR_TASKS) {
    const backfilled: string[] = [];
    for (const record of (await scanArchiveTaskRecords(options.archiveRoot)).map((entry) => entry.taskId).reverse()) {
      if (selected.length + backfilled.length >= MAX_PRIOR_TASKS) break;
      if (record !== options.currentTaskId && !selected.includes(record) && !backfilled.includes(record)) {
        backfilled.push(record);
      }
    }
    if (backfilled.length > 0) {
      // Preserve chronological prompt order for archive backfill while selecting newest records.
      selected.push(...backfilled.reverse());
    }
  }
  return selected.slice(-MAX_PRIOR_TASKS);
}

async function readCounterTaskIds(repoRoot: string, contextPackDir: string): Promise<string[]> {
  const counterPath = path.join(repoRoot, '.platform-state', 'task-counters', `${path.basename(contextPackDir)}.json`);
  const raw = await readTextFile(counterPath);
  if (!raw) return [];
  try {
    return asStringArray(safeJsonParse<CounterPayload>(raw, counterPath).cycle_task_ids);
  } catch {
    return [];
  }
}

function uniqueRecent(ids: string[], currentTaskId: string): string[] {
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || trimmed === currentTaskId) continue;
    const existing = result.indexOf(trimmed);
    if (existing >= 0) result.splice(existing, 1);
    result.push(trimmed);
  }
  return result.slice(-MAX_PRIOR_TASKS);
}

async function resolveQmdScopeRoot(options: {
  repoRoot: string;
  contextPackDir: string;
  currentTaskId: string;
}): Promise<string> {
  const snapshotPath = path.join(options.repoRoot, 'AgentWorkSpace', 'tasks', options.currentTaskId, 'pack-snapshot.json');
  const snapshotRaw = await readTextFile(snapshotPath);
  if (snapshotRaw) {
    try {
      const snapshot = safeJsonParse<{ qmdScopeRoot?: unknown }>(snapshotRaw, snapshotPath);
      if (typeof snapshot.qmdScopeRoot === 'string' && snapshot.qmdScopeRoot.trim()) return snapshot.qmdScopeRoot.trim();
    } catch {
      // Fall through to the live context-pack manifest.
    }
  }

  const manifestPath = path.join(options.contextPackDir, 'qmd', 'repo-sources.json');
  const manifestRaw = await readTextFile(manifestPath);
  if (manifestRaw) {
    try {
      const manifest = safeJsonParse<{ qmd_scope_root?: unknown }>(manifestRaw, manifestPath);
      if (typeof manifest.qmd_scope_root === 'string' && manifest.qmd_scope_root.trim()) return manifest.qmd_scope_root.trim();
    } catch {
      // Fall through to the conventional root.
    }
  }

  return path.join('qmd', 'context-packs', path.basename(options.contextPackDir));
}

async function buildArchivedEntry(archiveRoot: string, taskId: string): Promise<CycleTaskContext> {
  try {
    const archiveRecord = await findTaskArchiveRecord(archiveRoot, taskId);
    if (!archiveRecord) return emptyEntry(taskId, false, [`Missing archived task record for ${taskId}.`]);
    const retrospective = await readRetrospectivePayload(archiveRoot, archiveRecord.payload);
    return {
      taskId,
      taskTitle: asString(archiveRecord.payload.task_title) || asString(archiveRecord.payload.title),
      taskSummary: asString(archiveRecord.payload.task_summary),
      completedWorkSummary: asString(archiveRecord.payload.completed_work_summary),
      keyDecisions: asStringArray(archiveRecord.payload.key_decisions),
      knownLimitations: asStringArray(archiveRecord.payload.known_limitations),
      difficultyLevel: asString(archiveRecord.payload.difficulty_level),
      retrospectiveSummary: asString(retrospective.payload?.retrospective_summary),
      whatWentWell: asStringArray(retrospective.payload?.what_went_well),
      whatCouldHaveGoneBetter: asStringArray(retrospective.payload?.what_could_have_gone_better),
      actionItems: asStringArray(retrospective.payload?.action_items),
      isCurrentTask: false,
      warnings: retrospective.warnings,
    };
  } catch (error) {
    return emptyEntry(taskId, false, [`Unable to read archived task ${taskId}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

async function buildCurrentEntry(handoffsDir: string, currentTaskId: string): Promise<CycleTaskContext> {
  const finalSections = parseSections(await readTextFile(path.join(handoffsDir, 'final-summary.md')) ?? '');
  const retrospectiveSections = parseSections(await readTextFile(path.join(handoffsDir, 'retrospective-input.md')) ?? '');
  const finalMetadata = parseMetadata(finalSections['Task Metadata'] ?? []);
  const retrospectiveMetadata = parseMetadata(retrospectiveSections['Task Metadata'] ?? []);
  const difficultyMetadata = parseMetadata(finalSections['Difficulty Assessment'] ?? []);

  return {
    taskId: currentTaskId,
    taskTitle: finalMetadata['Task Title'] || retrospectiveMetadata['Task Title'] || '',
    taskSummary: sectionText(finalSections, 'Test Result Summary'),
    completedWorkSummary: sectionText(finalSections, 'Completed Work'),
    keyDecisions: sectionList(finalSections, 'Key Design Decisions'),
    knownLimitations: sectionList(finalSections, 'Known Limitations'),
    difficultyLevel: difficultyMetadata['Difficulty Level'] ?? '',
    retrospectiveSummary: sectionText(retrospectiveSections, 'Retrospective Summary'),
    whatWentWell: sectionList(retrospectiveSections, 'What Went Well'),
    whatCouldHaveGoneBetter: sectionList(retrospectiveSections, 'What Could Have Gone Better'),
    actionItems: sectionList(retrospectiveSections, 'Action Items'),
    isCurrentTask: true,
    warnings: [],
  };
}

function emptyEntry(taskId: string, isCurrentTask: boolean, warnings: string[]): CycleTaskContext {
  return {
    taskId,
    taskTitle: '',
    taskSummary: '',
    completedWorkSummary: '',
    keyDecisions: [],
    knownLimitations: [],
    difficultyLevel: '',
    retrospectiveSummary: '',
    whatWentWell: [],
    whatCouldHaveGoneBetter: [],
    actionItems: [],
    isCurrentTask,
    warnings,
  };
}

async function findTaskArchiveRecord(archiveRoot: string, taskId: string): Promise<ArchiveRecord | undefined> {
  const slug = slugify(taskId);
  if (/^\d{4}/.test(taskId)) {
    const direct = await readArchiveRecord(path.join(archiveRoot, 'archive', 'tasks', taskId.slice(0, 4), `${slug}.json`));
    if (direct) return direct;
  }
  return (await scanArchiveTaskRecords(archiveRoot)).find((record) => record.taskId === taskId);
}

async function scanArchiveTaskRecords(archiveRoot: string): Promise<ArchiveRecord[]> {
  const records: ArchiveRecord[] = [];
  for (const file of await listJsonFiles(path.join(archiveRoot, 'archive', 'tasks'))) {
    const record = await readArchiveRecord(file);
    if (record) records.push(record);
  }
  return records.sort((left, right) => {
    const leftTime = asString(left.payload.completed_at_utc) || asString(left.payload.indexed_at);
    const rightTime = asString(right.payload.completed_at_utc) || asString(right.payload.indexed_at);
    return leftTime.localeCompare(rightTime) || left.path.localeCompare(right.path);
  });
}

async function readArchiveRecord(filePath: string): Promise<ArchiveRecord | undefined> {
  const raw = await readTextFile(filePath);
  if (!raw) return undefined;
  const payload = safeJsonParse<ArchivePayload>(raw, filePath);
  const taskId = asString(payload.task_id);
  return taskId ? { taskId, path: filePath, payload } : undefined;
}

async function readRetrospectivePayload(
  archiveRoot: string,
  archivePayload: ArchivePayload,
): Promise<{ payload?: RetrospectivePayload; warnings: string[] }> {
  const taskId = asString(archivePayload.task_id);
  const slug = slugify(taskId);
  const repoName = asString(archivePayload.repo_name);
  const year = yearFrom(asString(archivePayload.completed_at_utc) || asString(archivePayload.indexed_at) || taskId);
  if (repoName && year) {
    const direct = await readRetrospectiveRecord(path.join(
      archiveRoot,
      'archive',
      'retrospectives',
      repoName,
      year,
      slug,
      'retrospective.md.record.json',
    ));
    if (direct) return { payload: direct, warnings: [] };
  }
  const scanned = await findRetrospectiveRecordBySlug(archiveRoot, slug);
  return scanned ? { payload: scanned, warnings: [] } : { warnings: [`Missing retrospective record for ${taskId}.`] };
}

async function readRetrospectiveRecord(filePath: string): Promise<RetrospectivePayload | undefined> {
  const raw = await readTextFile(filePath);
  return raw ? safeJsonParse<RetrospectivePayload>(raw, filePath) : undefined;
}

async function findRetrospectiveRecordBySlug(archiveRoot: string, slug: string): Promise<RetrospectivePayload | undefined> {
  const suffix = path.join(slug, 'retrospective.md.record.json');
  for (const file of await listJsonFiles(path.join(archiveRoot, 'archive', 'retrospectives'))) {
    if (file.endsWith(suffix)) return readRetrospectiveRecord(file);
  }
  return undefined;
}

async function listJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return listJsonFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.json') ? [entryPath] : [];
    }));
    return nested.flat().sort();
  } catch {
    return [];
  }
}

function sectionText(sections: Record<string, string[]>, section: string): string {
  return sectionList(sections, section).join('\n');
}

function sectionList(sections: Record<string, string[]>, section: string): string[] {
  return (sections[section] ?? [])
    .map((line) => stripHtmlComments(line).trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function yearFrom(value: string): string {
  return /^(\d{4})/.exec(value)?.[1] ?? '';
}
