import path from 'node:path';
import { readdir, unlink, readFile } from 'node:fs/promises';
import { ensureDir, writeTextFile } from '../core/index.js';
import { deriveQueueStatePaths } from './paths.js';

export async function readQueueOrderManifest(
  manifestPath: string,
): Promise<string[]> {
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as { order?: string[] };
    return Array.isArray(manifest.order) ? manifest.order : [];
  } catch {
    return [];
  }
}

export async function writeQueueOrderManifest(
  queueOrderPath: string,
  order: string[],
): Promise<void> {
  await ensureDir(path.dirname(queueOrderPath));
  await writeTextFile(queueOrderPath, JSON.stringify({ order }, null, 2) + '\n');
}

export async function insertIntoQueueManifest(
  pendingDir: string,
  fileName: string,
  insertAtIndex: number,
  queueOrderPath?: string,
): Promise<void> {
  const resolvedPath = queueOrderPath
    ?? deriveQueueStatePaths(pendingDir).queueOrderPath;
  const currentFiles = (await readdir(pendingDir))
    .filter((e) => e.endsWith('.md') && !e.startsWith('.'))
    .sort();

  const manifest = await readQueueOrderManifest(resolvedPath);
  const tracked = new Set(manifest);
  const reconciled = manifest.filter((f) => currentFiles.includes(f));
  for (const f of currentFiles) {
    if (!tracked.has(f) && f !== fileName) reconciled.push(f);
  }
  const filtered = reconciled.filter((f) => f !== fileName);
  const idx = Math.max(0, Math.min(insertAtIndex, filtered.length));
  filtered.splice(idx, 0, fileName);
  await writeQueueOrderManifest(resolvedPath, filtered);
}

export async function removeFromQueueOrderManifest(
  queueOrderPath: string,
  fileName: string,
): Promise<void> {
  try {
    const order = await readQueueOrderManifest(queueOrderPath);
    const filtered = order.filter((f) => f !== fileName);
    if (filtered.length > 0) {
      await writeQueueOrderManifest(queueOrderPath, filtered);
    } else {
      await unlink(queueOrderPath);
    }
  } catch {
    // Best-effort cleanup path.
  }
}
