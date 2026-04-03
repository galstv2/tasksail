import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { readTextFile, safeJsonParse, writeTextFile } from '../core/index.js';
import { evaluateRuntimeInference, type RuntimeAgentFacts } from '../workflow-policy/runtimeInference.js';

export const WORKFLOW_FACTS_RELATIVE_PATH = '.platform-state/runtime/workflow-facts.json';

export interface RuntimeWorkflowFacts {
  schema_version: 1;
  source: 'typescript';
  generated_at: string;
  source_signature?: string;
  completion: Record<string, RuntimeAgentFacts>;
  parallel: {
    active_approval: boolean;
  };
  next_agent_id: string;
  next_agent_source: string;
}

interface RuntimeFactsCacheEntry {
  sourceSignature: string;
  facts: RuntimeWorkflowFacts;
}

const runtimeFactsCache = new Map<string, RuntimeFactsCacheEntry>();

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function fileStamp(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath);
    return `${filePath}:${info.mtimeMs}:${info.size}`;
  } catch {
    return `${filePath}:missing`;
  }
}

export async function computeRuntimeFactsSourceSignature(options: {
  repoRoot: string;
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<string> {
  const handoffsDir = options.handoffsDir ?? path.join(options.repoRoot, 'AgentWorkSpace', 'handoffs');
  const implStepsDir = options.implStepsDir ?? path.join(options.repoRoot, 'AgentWorkSpace', 'ImplementationSteps');
  const tracked = [
    ...(await collectMarkdownFiles(handoffsDir)),
    ...(await collectMarkdownFiles(implStepsDir)),
  ];
  const hasher = createHash('sha256');
  for (const stamp of await Promise.all(tracked.map((trackedPath) => fileStamp(trackedPath)))) {
    hasher.update(stamp);
    hasher.update('\n');
  }
  return hasher.digest('hex');
}


export async function computeRuntimeWorkflowFacts(options: {
  repoRoot: string;
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<RuntimeWorkflowFacts> {
  const inference = await evaluateRuntimeInference(options);

  return {
    schema_version: 1,
    source: 'typescript',
    generated_at: new Date().toISOString(),
    completion: inference.completion,
    parallel: {
      active_approval: inference.parallel.active_approval,
    },
    next_agent_id: inference.nextAgent.agentId,
    next_agent_source: inference.nextAgent.source,
  };
}

export async function writeRuntimeWorkflowFacts(options: {
  repoRoot: string;
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<RuntimeWorkflowFacts> {
  const sourceSignature = await computeRuntimeFactsSourceSignature(options);
  const cached = runtimeFactsCache.get(options.repoRoot);
  if (cached?.sourceSignature === sourceSignature) {
    return cached.facts;
  }
  const facts = await computeRuntimeWorkflowFacts(options);
  facts.source_signature = sourceSignature;
  await writeTextFile(
    path.join(options.repoRoot, WORKFLOW_FACTS_RELATIVE_PATH),
    JSON.stringify(facts, null, 2) + '\n',
  );
  runtimeFactsCache.set(options.repoRoot, {
    sourceSignature,
    facts,
  });
  return facts;
}

export async function readRuntimeWorkflowFacts(repoRoot: string): Promise<RuntimeWorkflowFacts | null> {
  const raw = await readTextFile(path.join(repoRoot, WORKFLOW_FACTS_RELATIVE_PATH));
  if (!raw) {
    return null;
  }
  try {
    return safeJsonParse<RuntimeWorkflowFacts>(raw, WORKFLOW_FACTS_RELATIVE_PATH);
  } catch {
    return null;
  }
}
