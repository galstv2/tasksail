import { join, relative } from 'node:path';

import { REPO_ROOT } from '../paths';
import { pathExists, type ReadOnlyRepoFs } from '../utils';

export const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
export const PENDING_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
export const ACTIVE_ITEMS_DIR = join(PENDING_DIR, '.active-items');
export const ERROR_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'error-items');

export const SUSPECTED_STUCK_AFTER_MS = 20 * 60 * 1000;
export const ORPHANED_GRACE_MS = 2 * 60 * 1000;

export type GuardrailSeverity = 'info' | 'warning' | 'error';
export type JsonObject = Record<string, unknown>;

export function toRepoRelativePath(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');
}

export async function readMarkdownFileIfPresent(
  path: string,
  fsAdapter: ReadOnlyRepoFs,
): Promise<string | null> {
  if (!(await pathExists(path, fsAdapter))) {
    return null;
  }

  return fsAdapter.readFile(path, 'utf-8');
}

export async function readDirIfPresent(path: string, fsAdapter: ReadOnlyRepoFs): Promise<string[]> {
  if (!(await pathExists(path, fsAdapter))) {
    return [];
  }

  try {
    return await fsAdapter.readdir(path);
  } catch {
    return [];
  }
}

export async function countMarkdownFiles(path: string, fsAdapter: ReadOnlyRepoFs): Promise<number> {
  const entries = await readDirIfPresent(path, fsAdapter);
  return entries.filter((entry) => entry.endsWith('.md') && entry !== '.gitkeep').length;
}

export function extractMetadataValue(content: string | null, label: string): string | null {
  if (!content) {
    return null;
  }

  const match = content.match(new RegExp(`^- ${label}:[ \t]*([^\r\n]*)$`, 'm'));
  return match?.[1]?.trim() || null;
}

export function extractHeading(content: string | null): string | null {
  if (!content) {
    return null;
  }

  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

export function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function readJsonObjectIfPresent(
  path: string,
  fsAdapter: ReadOnlyRepoFs,
): Promise<{ payload: JsonObject | null; parseError: string | null }> {
  if (!(await pathExists(path, fsAdapter))) {
    return { payload: null, parseError: null };
  }

  try {
    const raw = await fsAdapter.readFile(path, 'utf-8');
    const payload = JSON.parse(raw) as unknown;
    const jsonObject = asJsonObject(payload);
    if (!jsonObject) {
      return { payload: null, parseError: 'JSON payload must be an object.' };
    }
    return { payload: jsonObject, parseError: null };
  } catch (error) {
    return {
      payload: null,
      parseError: error instanceof Error ? error.message : 'Unable to parse JSON payload.',
    };
  }
}

export function stringArrayOrEmpty(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(-4);
}

export function splitOutputLines(...chunks: Array<string | null | undefined>): string[] {
  return chunks
    .flatMap((chunk) => (chunk ?? '').split(/\r?\n/g))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4);
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
