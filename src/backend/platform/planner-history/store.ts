import path from 'node:path';
import {
  readTextFile,
  safeJsonParse,
  writeTextFileAtomic,
} from '../core/index.js';
import { withFileLock } from '../core/fileLock.js';
import { resolvePlannerHistoryPath } from './paths.js';
import type {
  PlannerConversationHistoryFile,
  PlannerConversationRecord,
} from './types.js';
import {
  PLANNER_HISTORY_RECORD_CAP,
  PLANNER_HISTORY_VERSION,
  PlannerHistoryValidationError,
  TRANSCRIPT_MESSAGE_CAP,
} from './types.js';

export interface PlannerHistoryReadOptions {
  repoRoot: string;
}

export interface PlannerHistoryListOptions extends PlannerHistoryReadOptions {
  contextPackDir: string;
  contextPackId?: string;
}

export interface PlannerHistoryUpsertOptions extends PlannerHistoryReadOptions {
  record: PlannerConversationRecord;
}

export function emptyPlannerHistoryFile(): PlannerConversationHistoryFile {
  return {
    version: PLANNER_HISTORY_VERSION,
    conversationsByContextPackDir: {},
  };
}

export async function readPlannerHistory(
  opts: PlannerHistoryReadOptions,
): Promise<PlannerConversationHistoryFile> {
  const historyPath = resolvePlannerHistoryPath(opts.repoRoot);
  const raw = await readTextFile(historyPath);
  if (raw === undefined) {
    return emptyPlannerHistoryFile();
  }
  return safeJsonParse<PlannerConversationHistoryFile>(raw, historyPath);
}

export async function listPlannerHistoryForPack(
  opts: PlannerHistoryListOptions,
): Promise<PlannerConversationRecord[]> {
  const history = await readPlannerHistory(opts);
  const contextPackDir = normalizeContextPackDir(opts.contextPackDir);
  const exactBucket = history.conversationsByContextPackDir[contextPackDir] ?? [];

  if (exactBucket.length > 0) {
    return sortByCreatedAtDesc(exactBucket);
  }

  if (!opts.contextPackId) {
    return [];
  }

  const fallbackRecords = Object.values(history.conversationsByContextPackDir)
    .flat()
    .filter((record) => record.contextPackId === opts.contextPackId);
  return sortByCreatedAtDesc(fallbackRecords);
}

export async function getPlannerHistoryRecord(
  opts: PlannerHistoryListOptions & { recordId: string },
): Promise<PlannerConversationRecord | null> {
  const records = await listPlannerHistoryForPack(opts);
  return records.find((record) => record.id === opts.recordId) ?? null;
}

export async function upsertPlannerHistoryRecord(
  opts: PlannerHistoryUpsertOptions,
): Promise<void> {
  validateTranscriptCap(opts.record);
  const contextPackDir = normalizeContextPackDir(opts.record.contextPackDir);
  const record = {
    ...opts.record,
    contextPackDir,
  };

  const historyPath = resolvePlannerHistoryPath(opts.repoRoot);
  // Serialize the whole read-modify-write under a per-file lock so two
  // simultaneous upserts of different records cannot read the same baseline
  // and clobber each other (atomic rename alone would lose one record).
  await withFileLock(historyPath, async () => {
    const history = await readPlannerHistory(opts);
    const currentBucket = history.conversationsByContextPackDir[contextPackDir] ?? [];
    const existingIndex = currentBucket.findIndex((existing) => existing.id === record.id);
    const nextBucket = [...currentBucket];

    if (existingIndex >= 0) {
      nextBucket[existingIndex] = {
        ...record,
        createdAt: nextBucket[existingIndex]!.createdAt,
      };
    } else {
      nextBucket.unshift(record);
    }

    history.conversationsByContextPackDir[contextPackDir] = sortByCreatedAtDesc(nextBucket)
      .slice(0, PLANNER_HISTORY_RECORD_CAP);

    await writePlannerHistory(opts.repoRoot, history);
  });
}

function validateTranscriptCap(record: PlannerConversationRecord): void {
  if (record.transcript.length > TRANSCRIPT_MESSAGE_CAP) {
    throw new PlannerHistoryValidationError(
      `Planner conversation transcript exceeds cap of ${TRANSCRIPT_MESSAGE_CAP} messages.`,
    );
  }
}

function normalizeContextPackDir(contextPackDir: string): string {
  return path.normalize(path.resolve(contextPackDir));
}

function sortByCreatedAtDesc(
  records: PlannerConversationRecord[],
): PlannerConversationRecord[] {
  return [...records].sort((left, right) => {
    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
    return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
  });
}

async function writePlannerHistory(
  repoRoot: string,
  history: PlannerConversationHistoryFile,
): Promise<void> {
  const historyPath = resolvePlannerHistoryPath(repoRoot);
  // Same JSON serialization and trailing newline as before; the shared helper
  // now provides collision-resistant temp naming and atomic rename.
  await writeTextFileAtomic(historyPath, `${JSON.stringify(history, null, 2)}\n`);
}

