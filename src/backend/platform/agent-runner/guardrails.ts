import { ensureDir, writeTextFileAtomic, resolvePaths, isMissingPathError } from '../core/index.js';
import type { AgentId, PythonResult } from '../core/index.js';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir, stat, writeFile, link, unlink } from 'node:fs/promises';
import { computeRuntimeFactsSourceSignature, writeRuntimeWorkflowFacts } from './runtimeFacts.js';
import { evaluateWorkflowPolicy } from '../workflow-policy/index.js';
import type { PolicyValidationMode } from '../workflow-policy/index.js';
import { getActiveProvider } from '../cli-provider/index.js';

interface PolicyCacheEntry {
  key: string;
  result: PythonResult;
}

class PolicyResultCache {
  private readonly entries = new Map<string, PolicyCacheEntry>();
  private readonly maxSize: number;

  constructor(maxSize = 64) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): PolicyCacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: PolicyCacheEntry): void {
    if (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, value);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const policyResultCache = new PolicyResultCache();

function policyResultCacheKey(repoRoot: string, taskId: string): string {
  return `${repoRoot}::${taskId}`;
}

async function stamp(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath);
    return `${filePath}:${info.mtimeMs}:${info.size}`;
  } catch {
    return `${filePath}:missing`;
  }
}

async function roleSessionPolicyStamp(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const payload = JSON.parse(content) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return stamp(filePath);
    }
    const normalized = { ...(payload as Record<string, unknown>) };
    delete normalized.monitor;
    return `${filePath}:normalized:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
  } catch {
    return stamp(filePath);
  }
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath);
    return entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => path.join(dirPath, entry))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    if (isMissingPathError(err)) {
      return [];
    }
    throw err;
  }
}

async function computeRuntimePolicyStateKey(options: {
  repoRoot: string;
  taskId: string;
  handoffsDir: string;
  implStepsDir: string;
  agentId: AgentId;
  mode: string;
}): Promise<string> {
  const taskRuntime = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId }).taskRuntime;
  const runtimeFactsSignature = await computeRuntimeFactsSourceSignature({
    repoRoot: options.repoRoot,
    taskId: options.taskId,
    taskRuntime,
    handoffsDir: options.handoffsDir,
    implStepsDir: options.implStepsDir,
  });
  const [conventionsFiles, guardrailFiles, roleSessionFiles] = await Promise.all([
    listJsonFiles(path.join(taskRuntime, 'conventions')),
    listJsonFiles(path.join(taskRuntime, 'guardrails')),
    listJsonFiles(path.join(taskRuntime, 'role-sessions')),
  ]);
  const tracked = [
    path.join(options.repoRoot, getActiveProvider(options.repoRoot).agentConfigPaths().registry),
    ...roleSessionFiles,
    ...conventionsFiles.filter((f) => !f.endsWith('/testing-infrastructure.json')),
    ...guardrailFiles.filter((f) => !f.endsWith('/testing-skip.json')),
  ];
  const roleSessionFileSet = new Set(roleSessionFiles);
  const hasher = createHash('sha256');
  hasher.update(`agent=${options.agentId}\nmode=${options.mode}\nruntimeFacts=${runtimeFactsSignature}\n`);
  for (const line of await Promise.all(tracked.map((trackedPath) =>
    roleSessionFileSet.has(trackedPath) ? roleSessionPolicyStamp(trackedPath) : stamp(trackedPath),
  ))) {
    hasher.update(line);
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

/**
 * Compute the guardrail receipt file path for an agent invocation.
 * Resolves to `<taskRuntime>/guardrails/<agentId>.json`.
 */
export function guardrailReceiptPath(
  repoRoot: string,
  agentId: AgentId,
  taskId: string,
): string {
  const taskRuntime = resolvePaths({ repoRoot, taskId }).taskRuntime;
  return path.join(taskRuntime, 'guardrails', `${agentId}.json`);
}

/**
 * Write a guardrail receipt JSON file.
 */
export async function writeGuardrailReceipt(
  receiptPath: string,
  data: Record<string, unknown>,
): Promise<void> {
  await ensureDir(path.dirname(receiptPath));
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeTextFileAtomic(receiptPath, content);
}

/**
 * Race-safe non-overwriting guardrail receipt write. The first same-agent
 * receipt keeps the unsuffixed `<agentId>.json` name; subsequent receipts
 * use `<agentId>-N.json` suffixes via exclusive create. Returns the path
 * written. Throws after 16 occupied candidates to prevent runaway loops.
 */
export async function writeUniqueGuardrailReceipt(options: {
  repoRoot: string;
  agentId: AgentId;
  taskId: string;
  data: Record<string, unknown>;
  launchId?: string;
  launchPhase?: string;
}): Promise<string> {
  const firstPath = guardrailReceiptPath(options.repoRoot, options.agentId, options.taskId);
  await ensureDir(path.dirname(firstPath));
  const payload = {
    ...options.data,
    ...(options.launchId !== undefined ? { launch_id: options.launchId } : {}),
    ...(options.launchPhase !== undefined ? { launch_phase: options.launchPhase } : {}),
  };
  const content = JSON.stringify(payload, null, 2) + '\n';

  // Write the full content to a private temp first, then claim a unique final
  // name via link() (atomic, and fails EEXIST if the name is already taken).
  // This preserves the race-safe non-overwrite semantics AND makes the receipt
  // crash-atomic: a crash mid-write leaves only an orphan temp, never a torn
  // final receipt that a reader would parse as corrupt.
  const tmpPath = `${firstPath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  await writeFile(tmpPath, content);
  try {
    let lastCandidate = firstPath;
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      const candidate = attempt === 1
        ? firstPath
        : path.join(path.dirname(firstPath), `${options.agentId}-${attempt}.json`);
      lastCandidate = candidate;
      try {
        await link(tmpPath, candidate);
        return candidate;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          continue;
        }
        throw err;
      }
    }
    throw new Error(`No available guardrail receipt path after 16 attempts. Last candidate: ${lastCandidate}`);
  } finally {
    await unlink(tmpPath).catch(() => { /* best-effort temp cleanup */ });
  }
}

/**
 * Run the runtime workflow policy check via the TypeScript workflow-policy engine.
 *
 * Returns a subprocess-compatible result shape. The caller should inspect exitCode:
 * - 0 = policy passed
 * - non-zero = policy violation
 */
export async function runRuntimePolicyCheck(
  repoRoot: string,
  agentId: AgentId,
  mode: PolicyValidationMode = 'runtime',
  taskId: string,
): Promise<PythonResult> {
  const paths = resolvePaths({ repoRoot, taskId });
  await writeRuntimeWorkflowFacts({
    repoRoot,
    taskId,
    taskRuntime: paths.taskRuntime,
    handoffsDir: paths.handoffs,
    implStepsDir: paths.implementationSteps,
  });
  const stateKey = await computeRuntimePolicyStateKey({
    repoRoot,
    taskId,
    handoffsDir: paths.handoffs,
    implStepsDir: paths.implementationSteps,
    agentId,
    mode,
  });
  const cacheKey = policyResultCacheKey(repoRoot, taskId);
  const cached = policyResultCache.get(cacheKey);
  if (cached?.key === stateKey) {
    return cached.result;
  }

  const result = await evaluateWorkflowPolicy({
    repoRoot,
    mode,
    taskId,
    enforce: true,
    requestedAgentId: agentId,
    format: 'json',
  });
  const cachedResult = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
  policyResultCache.set(cacheKey, {
    key: stateKey,
    result: cachedResult,
  });
  return cachedResult;
}

/**
 * Drop any cached policy result for a given task. Call this when a task
 * reaches a terminal state so cache entries do not outlive completed work.
 */
export function evictPolicyResultCache(repoRoot: string, taskId: string): void {
  policyResultCache.delete(policyResultCacheKey(repoRoot, taskId));
}
