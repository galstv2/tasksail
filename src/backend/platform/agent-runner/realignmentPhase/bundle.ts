import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readTextFile, safeJsonParse, slugify } from '../../core/index.js';
import { resolveReinforcementStoreFileForRead } from '../reinforcementPaths.js';

const RECENT_NEGATIVE_FEEDBACK_LIMIT = 10;
const RECENT_TASK_LIMIT = 5;
const ROLLING_RETROSPECTIVE_LIMIT = 10;
const SHARED_RETROSPECTIVE_MEMORY_LIMIT = 4096;

export interface FeedbackEventEntry {
  feedbackId: string;
  taskId: string;
  feedbackType: 'none' | 'positive' | 'negative';
  starRating: number | null;
  comment: string;
  createdAt: string;
}

export interface TaskBundleEntry {
  taskId: string;
  taskTitle: string;
  taskSummary: string;
  completedWorkSummary: string;
  keyDecisions: string[];
  knownLimitations: string[];
  difficultyLevel: string;
  retrospectiveSummary: string;
  whatWentWell: string[];
  whatCouldHaveGoneBetter: string[];
  actionItems: string[];
  warnings: string[];
}

export interface RetrospectiveDigestEntry {
  taskId: string;
  taskTitle: string;
  completedAt: string;
  retrospectiveSummary: string;
  whatWentWell: string[];
  whatCouldHaveGoneBetter: string[];
  actionItems: string[];
  warnings: string[];
}

export interface RealignmentBundle {
  realignmentId: string;
  triggerFeedback: FeedbackEventEntry | { trigger: 'ui-triggered' } | null;
  triggerTask: TaskBundleEntry | null;
  recentNegativeFeedback: FeedbackEventEntry[];
  recentTasks: TaskBundleEntry[];
  globalRealignmentDoc: {
    standingExpectations: string[];
    lessonsLearned: string[];
    behavioralGuidance: string[];
    fairnessFraming: string[];
    version: number;
  };
  rollingRetrospectives: RetrospectiveDigestEntry[];
  sharedRetrospectiveMemory: string;
  warnings: string[];
}

interface CollectionPayload {
  entries?: unknown;
}

interface FeedbackPayload {
  feedback_id?: unknown;
  task_id?: unknown;
  feedback_type?: unknown;
  star_rating?: unknown;
  comment?: unknown;
  created_at?: unknown;
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
  task_id?: unknown;
  task_title?: unknown;
  completed_at_utc?: unknown;
  indexed_at?: unknown;
  retrospective_summary?: unknown;
  what_went_well?: unknown;
  what_could_have_gone_better?: unknown;
  action_items?: unknown;
}

interface ArchiveRecord {
  taskId: string;
  filePath: string;
  payload: ArchivePayload;
}

interface RetrospectiveRecord {
  filePath: string;
  slug: string;
  payload: RetrospectivePayload;
}

export async function buildRealignmentContextBundle(options: {
  repoRoot: string;
  contextPackDir: string;
  realignmentId: string;
  triggerTaskId: string;
  triggerFeedbackId: string;
}): Promise<RealignmentBundle> {
  const warnings: string[] = [];
  const qmdScopeRoot = await resolveQmdScopeRoot(options);
  const archiveRoot = path.join(options.contextPackDir, qmdScopeRoot);

  const [feedbackEvents, globalRealignmentDoc, sharedRetrospectiveMemory] = await Promise.all([
    loadFeedbackEvents(options.repoRoot, warnings),
    loadGlobalRealignmentDoc(options.repoRoot, warnings),
    loadSharedRetrospectiveMemory(options.repoRoot),
  ]);

  const triggerFeedback = resolveTriggerFeedback(feedbackEvents, options.triggerFeedbackId, warnings);
  const recentNegativeFeedback = feedbackEvents
    .filter((event) => (
      event.feedbackType === 'negative'
      && event.feedbackId !== options.triggerFeedbackId
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, RECENT_NEGATIVE_FEEDBACK_LIMIT)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const archiveRecords = await scanArchiveTaskRecords(archiveRoot, warnings);
  const retrospectiveRecords = await scanRetrospectiveRecords(archiveRoot, warnings);
  const triggerArchive = archiveRecords.find((record) => record.taskId === options.triggerTaskId);
  const triggerTask = triggerArchive
    ? buildTaskEntry(triggerArchive, retrospectiveRecords)
    : null;
  if (!triggerArchive && options.triggerTaskId.trim()) {
    warnings.push(`Missing trigger task archive for ${options.triggerTaskId}.`);
  }

  const recentTasks = (await Promise.all(
    archiveRecords
      .filter((record) => record.taskId !== options.triggerTaskId)
      .sort(compareArchiveNewestFirst)
      .slice(0, RECENT_TASK_LIMIT)
      .sort(compareArchiveChronological)
      .map((record) => buildTaskEntry(record, retrospectiveRecords)),
  ));

  const rollingRetrospectives = await buildRollingRetrospectiveDigest(
    archiveRecords,
    retrospectiveRecords,
  );

  return {
    realignmentId: options.realignmentId,
    triggerFeedback,
    triggerTask,
    recentNegativeFeedback,
    recentTasks,
    globalRealignmentDoc,
    rollingRetrospectives,
    sharedRetrospectiveMemory,
    warnings,
  };
}

async function resolveQmdScopeRoot(options: {
  repoRoot: string;
  contextPackDir: string;
  triggerTaskId: string;
}): Promise<string> {
  const snapshotPath = path.join(options.repoRoot, 'AgentWorkSpace', 'tasks', options.triggerTaskId, 'pack-snapshot.json');
  const snapshotRaw = await readTextFile(snapshotPath);
  if (snapshotRaw) {
    try {
      const snapshot = safeJsonParse<{ qmdScopeRoot?: unknown }>(snapshotRaw, snapshotPath);
      if (typeof snapshot.qmdScopeRoot === 'string' && snapshot.qmdScopeRoot.trim()) {
        return snapshot.qmdScopeRoot.trim();
      }
    } catch {
      // Fall through to live manifest.
    }
  }

  const manifestPath = path.join(options.contextPackDir, 'qmd', 'repo-sources.json');
  const manifestRaw = await readTextFile(manifestPath);
  if (manifestRaw) {
    try {
      const manifest = safeJsonParse<{ qmd_scope_root?: unknown }>(manifestRaw, manifestPath);
      if (typeof manifest.qmd_scope_root === 'string' && manifest.qmd_scope_root.trim()) {
        return manifest.qmd_scope_root.trim();
      }
    } catch {
      // Fall through to conventional context-pack archive root.
    }
  }

  return path.join('qmd', 'context-packs', path.basename(options.contextPackDir));
}

async function loadFeedbackEvents(repoRoot: string, warnings: string[]): Promise<FeedbackEventEntry[]> {
  try {
    const payload = await readStoreJson<CollectionPayload>(repoRoot, warnings, 'feedback-events.json');
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    return entries
      .map(mapFeedbackEvent)
      .filter((event): event is FeedbackEventEntry => event !== null);
  } catch (error) {
    warnings.push(`Unable to read feedback events: ${errorMessage(error)}`);
    return [];
  }
}

function resolveTriggerFeedback(
  events: FeedbackEventEntry[],
  triggerFeedbackId: string,
  warnings: string[],
): FeedbackEventEntry | { trigger: 'ui-triggered' } | null {
  if (triggerFeedbackId === 'ui-triggered') {
    return { trigger: 'ui-triggered' };
  }
  if (!triggerFeedbackId.trim()) {
    return null;
  }
  const event = events.find((entry) => entry.feedbackId === triggerFeedbackId) ?? null;
  if (!event) {
    warnings.push(`Missing trigger feedback event ${triggerFeedbackId}.`);
  }
  return event;
}

async function loadGlobalRealignmentDoc(
  repoRoot: string,
  warnings: string[],
): Promise<RealignmentBundle['globalRealignmentDoc']> {
  const payload = await readStoreJson<Record<string, unknown>>(repoRoot, warnings, 'global-realignment-doc.json');
  if (!payload) {
    warnings.push('Missing global-realignment-doc.json; using empty GRD context.');
  }
  return {
    standingExpectations: asStringArray(payload?.['standing_expectations']),
    lessonsLearned: asStringArray(payload?.['lessons_learned']),
    behavioralGuidance: asStringArray(payload?.['behavioral_guidance']),
    fairnessFraming: asStringArray(payload?.['fairness_framing']),
    version: typeof payload?.['version'] === 'number' ? payload['version'] : 0,
  };
}

async function readStoreJson<T>(
  repoRoot: string,
  warnings: string[],
  ...parts: string[]
): Promise<T | null> {
  const filePath = await resolveReinforcementStoreFileForRead(repoRoot, ...parts);
  const raw = await readTextFile(filePath);
  if (!raw) return null;
  try {
    return safeJsonParse<T>(raw, filePath);
  } catch (error) {
    warnings.push(`Unable to parse ${parts.join('/')}: ${errorMessage(error)}`);
    return null;
  }
}

async function scanArchiveTaskRecords(
  archiveRoot: string,
  warnings: string[],
): Promise<ArchiveRecord[]> {
  const records: ArchiveRecord[] = [];
  for (const filePath of await listJsonFiles(path.join(archiveRoot, 'archive', 'tasks'))) {
    const raw = await readTextFile(filePath);
    if (!raw) continue;
    try {
      const payload = safeJsonParse<ArchivePayload>(raw, filePath);
      const taskId = asString(payload.task_id);
      if (taskId) {
        records.push({ taskId, filePath, payload });
      }
    } catch (error) {
      warnings.push(`Unable to read task archive ${filePath}: ${errorMessage(error)}`);
    }
  }
  return records.sort(compareArchiveChronological);
}

async function scanRetrospectiveRecords(
  archiveRoot: string,
  warnings: string[],
): Promise<RetrospectiveRecord[]> {
  const records: RetrospectiveRecord[] = [];
  for (const filePath of await listJsonFiles(path.join(archiveRoot, 'archive', 'retrospectives'))) {
    if (!filePath.endsWith('retrospective.md.record.json')) continue;
    const raw = await readTextFile(filePath);
    if (!raw) continue;
    try {
      const payload = safeJsonParse<RetrospectivePayload>(raw, filePath);
      records.push({
        filePath,
        slug: path.basename(path.dirname(filePath)),
        payload,
      });
    } catch (error) {
      warnings.push(`Unable to read retrospective record ${filePath}: ${errorMessage(error)}`);
    }
  }
  return records;
}

function buildTaskEntry(
  archiveRecord: ArchiveRecord,
  retrospectiveRecords: RetrospectiveRecord[],
): TaskBundleEntry {
  const warnings: string[] = [];
  const retrospective = findRetrospectiveForArchive(archiveRecord, retrospectiveRecords);
  if (!retrospective) {
    warnings.push(`Missing retrospective record for ${archiveRecord.taskId}.`);
  }
  return {
    taskId: archiveRecord.taskId,
    taskTitle: asString(archiveRecord.payload.task_title) || asString(archiveRecord.payload.title),
    taskSummary: asString(archiveRecord.payload.task_summary),
    completedWorkSummary: asString(archiveRecord.payload.completed_work_summary),
    keyDecisions: asStringArray(archiveRecord.payload.key_decisions),
    knownLimitations: asStringArray(archiveRecord.payload.known_limitations),
    difficultyLevel: asString(archiveRecord.payload.difficulty_level),
    retrospectiveSummary: asString(retrospective?.payload.retrospective_summary),
    whatWentWell: asStringArray(retrospective?.payload.what_went_well),
    whatCouldHaveGoneBetter: asStringArray(retrospective?.payload.what_could_have_gone_better),
    actionItems: asStringArray(retrospective?.payload.action_items),
    warnings,
  };
}

async function buildRollingRetrospectiveDigest(
  archiveRecords: ArchiveRecord[],
  retrospectiveRecords: RetrospectiveRecord[],
): Promise<RetrospectiveDigestEntry[]> {
  const bySlug = new Map(retrospectiveRecords.map((record) => [record.slug, record]));
  const used = new Set<RetrospectiveRecord>();
  const paired = archiveRecords.flatMap((archiveRecord) => {
    const retrospective = findRetrospectiveForArchive(archiveRecord, retrospectiveRecords);
    if (!retrospective || !hasRetrospectiveText(retrospective.payload)) return [];
    used.add(retrospective);
    return [{
      sortKey: archiveSortKey(archiveRecord),
      entry: mapDigestEntry(archiveRecord, retrospective, []),
    }];
  });

  const orphaned = [...bySlug.values()]
    .filter((record) => !used.has(record) && hasRetrospectiveText(record.payload))
    .map((record) => ({
      sortKey: asString(record.payload.completed_at_utc) || asString(record.payload.indexed_at) || record.filePath,
      entry: mapDigestEntry(null, record, ['Retrospective sidecar has no paired task archive metadata.']),
    }));

  return [...paired, ...orphaned]
    .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
    .slice(0, ROLLING_RETROSPECTIVE_LIMIT)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map((item) => item.entry);
}

function mapDigestEntry(
  archiveRecord: ArchiveRecord | null,
  retrospective: RetrospectiveRecord,
  warnings: string[],
): RetrospectiveDigestEntry {
  return {
    taskId: archiveRecord?.taskId || asString(retrospective.payload.task_id) || retrospective.slug,
    taskTitle: asString(archiveRecord?.payload.task_title) || asString(archiveRecord?.payload.title) || asString(retrospective.payload.task_title),
    completedAt: archiveRecord ? archiveSortKey(archiveRecord) : asString(retrospective.payload.completed_at_utc) || asString(retrospective.payload.indexed_at),
    retrospectiveSummary: asString(retrospective.payload.retrospective_summary),
    whatWentWell: asStringArray(retrospective.payload.what_went_well),
    whatCouldHaveGoneBetter: asStringArray(retrospective.payload.what_could_have_gone_better),
    actionItems: asStringArray(retrospective.payload.action_items),
    warnings,
  };
}

function findRetrospectiveForArchive(
  archiveRecord: ArchiveRecord,
  retrospectiveRecords: RetrospectiveRecord[],
): RetrospectiveRecord | undefined {
  const slug = slugify(archiveRecord.taskId);
  return retrospectiveRecords.find((record) => record.slug === slug);
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

async function loadSharedRetrospectiveMemory(repoRoot: string): Promise<string> {
  const candidates = [
    path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'retrospectives', 'shared-retrospective-memory.md'),
    path.join(repoRoot, 'qmd', 'global', 'retrospectives', 'shared-retrospective-memory.md'),
  ];
  for (const candidate of candidates) {
    const raw = await readTextFile(candidate);
    if (raw) return tailOnLineBoundary(raw, SHARED_RETROSPECTIVE_MEMORY_LIMIT);
  }
  return '';
}

function tailOnLineBoundary(value: string, limit: number): string {
  if (value.length <= limit) return value.trim();
  const tail = value.slice(-limit);
  const newline = tail.indexOf('\n');
  return (newline >= 0 ? tail.slice(newline + 1) : tail).trim();
}

function compareArchiveNewestFirst(left: ArchiveRecord, right: ArchiveRecord): number {
  return compareArchiveChronological(right, left);
}

function compareArchiveChronological(left: ArchiveRecord, right: ArchiveRecord): number {
  return archiveSortKey(left).localeCompare(archiveSortKey(right)) || left.filePath.localeCompare(right.filePath);
}

function archiveSortKey(record: ArchiveRecord): string {
  return asString(record.payload.completed_at_utc) || asString(record.payload.indexed_at) || record.filePath;
}

function mapFeedbackEvent(value: unknown): FeedbackEventEntry | null {
  if (!isRecord(value)) return null;
  const payload = value as FeedbackPayload;
  const feedbackId = asString(payload.feedback_id);
  const taskId = asString(payload.task_id);
  if (!feedbackId || !taskId) return null;
  const feedbackType = asString(payload.feedback_type);
  return {
    feedbackId,
    taskId,
    feedbackType: feedbackType === 'positive' || feedbackType === 'negative' ? feedbackType : 'none',
    starRating: typeof payload.star_rating === 'number' ? payload.star_rating : null,
    comment: asString(payload.comment),
    createdAt: asString(payload.created_at),
  };
}

function hasRetrospectiveText(payload: RetrospectivePayload): boolean {
  return Boolean(
    asString(payload.retrospective_summary)
    || asStringArray(payload.what_went_well).length
    || asStringArray(payload.what_could_have_gone_better).length
    || asStringArray(payload.action_items).length,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
