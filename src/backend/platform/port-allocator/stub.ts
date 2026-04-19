/**
 * §5.3 Port Allocator STUB
 *
 * This is a STUB that will be replaced by portAllocator.allocate/release/listAllocations
 * in Level 8 (§6.2). It writes a port-allocations.json file under
 * .platform-state/runtime/ using a deterministic counter.
 *
 * TODO(§6.2): replace this entire module with the real portAllocator implementation.
 *
 * Contract (stub):
 *   - allocatePortStub(taskId, repoRoot): allocates a port for the task,
 *     writes to port-allocations.json, returns the port number.
 *   - releasePortStub(taskId, repoRoot): removes the task's entry from the table.
 *   - listAllocations(repoRoot): reads port-allocations.json and returns Record<taskId, port>.
 */
import path from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const PORT_ALLOCATIONS_RELATIVE = path.join('.platform-state', 'runtime', 'port-allocations.json');

/** Base port for stub allocations. TODO(§6.2): remove. */
const STUB_PORT_BASE = 8850;
/** Range for stub allocations. TODO(§6.2): remove. */
const STUB_PORT_RANGE = 150;

/**
 * Simple deterministic hash of taskId for port selection.
 * NOT a real allocator — no socket binding, no pool management.
 * TODO(§6.2): replace with portAllocator.allocate(taskId).
 */
function hashTaskId(taskId: string): number {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = ((hash << 5) - hash + taskId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function allocationTablePath(repoRoot: string): string {
  return path.join(repoRoot, PORT_ALLOCATIONS_RELATIVE);
}

async function readTable(repoRoot: string): Promise<Record<string, number>> {
  const tablePath = allocationTablePath(repoRoot);
  if (!existsSync(tablePath)) {
    return {};
  }
  try {
    const raw = await readFile(tablePath, 'utf-8');
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

async function writeTable(repoRoot: string, table: Record<string, number>): Promise<void> {
  const tablePath = allocationTablePath(repoRoot);
  await mkdir(path.dirname(tablePath), { recursive: true });
  const tmpPath = tablePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(table, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, tablePath);
}

/**
 * Allocate a port for taskId. Idempotent: if taskId already has an entry, returns it.
 * Picks a port based on hash-of-taskId mod range, then increments if collision.
 *
 * TODO(§6.2): replace with portAllocator.allocate(taskId).
 */
export async function allocatePortStub(taskId: string, repoRoot: string): Promise<number> {
  const table = await readTable(repoRoot);

  // Idempotent: return existing allocation
  if (typeof table[taskId] === 'number') {
    return table[taskId];
  }

  // Pick a starting port using hash
  const startOffset = hashTaskId(taskId) % STUB_PORT_RANGE;
  const allocatedPorts = new Set(Object.values(table));

  let port = STUB_PORT_BASE + startOffset;
  let attempts = 0;
  while (allocatedPorts.has(port) && attempts < STUB_PORT_RANGE) {
    port = STUB_PORT_BASE + ((startOffset + attempts + 1) % STUB_PORT_RANGE);
    attempts++;
  }

  table[taskId] = port;
  await writeTable(repoRoot, table);
  return port;
}

/**
 * Release a port allocation for taskId.
 * Swallows errors — the table may be absent.
 *
 * TODO(§6.2): replace with portAllocator.release(taskId).
 */
export async function releasePortStub(taskId: string, repoRoot: string): Promise<void> {
  try {
    const table = await readTable(repoRoot);
    if (!(taskId in table)) return;
    delete table[taskId];
    await writeTable(repoRoot, table);
  } catch {
    // Swallow failures — table may be absent or corrupted.
  }
}

/**
 * List all current port allocations.
 * Returns Record<taskId, port>.
 *
 * TODO(§6.2): replace with portAllocator.listAllocations().
 */
export async function listAllocations(repoRoot: string): Promise<Record<string, number>> {
  return readTable(repoRoot);
}
