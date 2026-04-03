import { ensureDir, writeTextFile, resolvePaths } from '../core/index.js';
import type { AgentId, PythonResult } from '../core/index.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { glob } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { computeRuntimeFactsSourceSignature, writeRuntimeWorkflowFacts } from './runtimeFacts.js';
import { evaluateWorkflowPolicy } from '../workflow-policy/index.js';
import type { PolicyValidationMode } from '../workflow-policy/index.js';

interface PolicyCacheEntry {
  key: string;
  result: PythonResult;
}

const policyResultCache = new Map<string, PolicyCacheEntry>();

async function stamp(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath);
    return `${filePath}:${info.mtimeMs}:${info.size}`;
  } catch {
    return `${filePath}:missing`;
  }
}

async function listGlob(pattern: string): Promise<string[]> {
  const results: string[] = [];
  for await (const entry of glob(pattern)) {
    results.push(entry);
  }
  return results.sort((a, b) => a.localeCompare(b));
}

async function computeRuntimePolicyStateKey(options: {
  repoRoot: string;
  handoffsDir: string;
  implStepsDir: string;
  agentId: AgentId;
  mode: string;
}): Promise<string> {
  const runtimeFactsSignature = await computeRuntimeFactsSourceSignature({
    repoRoot: options.repoRoot,
    handoffsDir: options.handoffsDir,
    implStepsDir: options.implStepsDir,
  });
  const [conventionsFiles, guardrailFiles, roleSessionFiles] = await Promise.all([
    listGlob(path.join(options.repoRoot, '.platform-state', 'runtime', 'conventions', '*.json')),
    listGlob(path.join(options.repoRoot, '.platform-state', 'runtime', 'guardrails', '*.json')),
    listGlob(path.join(options.repoRoot, '.platform-state', 'runtime', 'role-sessions', '*.json')),
  ]);
  const tracked = [
    path.join(options.repoRoot, '.github', 'agents', 'registry.json'),
    ...roleSessionFiles,
    ...conventionsFiles.filter((f) => !f.endsWith('/testing-infrastructure.json')),
    ...guardrailFiles.filter((f) => !f.endsWith('/testing-skip.json')),
  ];
  const hasher = createHash('sha256');
  hasher.update(`agent=${options.agentId}\nmode=${options.mode}\nruntimeFacts=${runtimeFactsSignature}\n`);
  for (const line of await Promise.all(tracked.map((trackedPath) => stamp(trackedPath)))) {
    hasher.update(line);
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

/**
 * Compute the guardrail receipt file path for an agent invocation.
 */
export function guardrailReceiptPath(
  guardrailsDir: string,
  agentId: AgentId,
): string {
  return path.join(guardrailsDir, `${agentId}.json`);
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
  await writeTextFile(receiptPath, content);
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
): Promise<PythonResult> {
  const paths = resolvePaths(repoRoot);
  await writeRuntimeWorkflowFacts({
    repoRoot,
    handoffsDir: paths.handoffs,
    implStepsDir: paths.implementationSteps,
  });
  const stateKey = await computeRuntimePolicyStateKey({
    repoRoot,
    handoffsDir: paths.handoffs,
    implStepsDir: paths.implementationSteps,
    agentId,
    mode,
  });
  const cached = policyResultCache.get(repoRoot);
  if (cached?.key === stateKey) {
    return cached.result;
  }

  const result = await evaluateWorkflowPolicy({
    repoRoot,
    mode,
    enforce: true,
    requestedAgentId: agentId,
    format: 'json',
  });
  const cachedResult = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
  policyResultCache.set(repoRoot, {
    key: stateKey,
    result: cachedResult,
  });
  return cachedResult;
}
