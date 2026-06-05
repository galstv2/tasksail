import path from 'node:path';
import { readTextFile, resolvePaths } from '../core/index.js';
import { checkAgentArtifactCompletion, detectParallelOk } from '../agent-runner/artifactCompletion.js';
import { parseSemanticSections } from './artifacts.js';
import { issuesHaveBlockingFindings, markdownSectionsHaveContent, normalizeAgentId, normalizeText } from './matching.js';
import { softwareEngineerGuardrailPassed } from './softwareEngineerEvidence.js';
import { CONTENT_SECTION_EXCLUSIONS } from './models.js';
import { getActiveProvider } from '../cli-provider/index.js';

const ISSUES_MD_FILENAME = 'issues.md';
const FINAL_SUMMARY_MD_FILENAME = 'final-summary.md';

interface RuntimeInferenceArtifact {
  exists: boolean;
  sections: Record<string, string[]>;
  hasSubstantiveContent: boolean;
}

export interface RuntimeAgentFacts {
  completed: boolean;
}

export interface RuntimeInferenceResult {
  completion: Record<string, RuntimeAgentFacts>;
  parallel: {
    active_approval: boolean;
  };
  nextAgent: {
    agentId: string;
    source: string;
  };
}

async function loadArtifact(absolutePath: string): Promise<RuntimeInferenceArtifact> {
  const rawText = await readTextFile(absolutePath);
  const sections = parseSemanticSections(rawText ?? '');
  return {
    exists: rawText !== undefined,
    sections,
    hasSubstantiveContent: markdownSectionsHaveContent(sections, {
      excludedSections: CONTENT_SECTION_EXCLUSIONS,
    }),
  };
}

async function remediationNextAgent(
  handoffsDir: string,
  runtimeToProviderAgentId: (agentId: string) => string,
): Promise<{ agentId: string; source: string } | null> {
  const artifact = await loadArtifact(path.join(handoffsDir, ISSUES_MD_FILENAME));
  if (!artifact.exists || !artifact.hasSubstantiveContent) {
    return null;
  }
  if (!issuesHaveBlockingFindings(artifact.sections)) {
    return null;
  }
  const owner = normalizeAgentId(normalizeText(artifact.sections['Remediation Owner Agent ID'] ?? []), runtimeToProviderAgentId);
  if (owner) {
    return { agentId: owner, source: 'qa issues remediation owner' };
  }
  return null;
}

async function closeoutNextAgent(
  handoffsDir: string,
  runtimeToProviderAgentId: (agentId: string) => string,
): Promise<{ agentId: string; source: string } | null> {
  const finalSummary = await loadArtifact(path.join(handoffsDir, FINAL_SUMMARY_MD_FILENAME));
  if (!finalSummary.exists || !finalSummary.hasSubstantiveContent) {
    return null;
  }
  const owner = normalizeAgentId(normalizeText(finalSummary.sections['Closeout Owner Agent ID'] ?? []), runtimeToProviderAgentId);
  if (!owner) {
    return null;
  }
  return { agentId: owner, source: 'final-summary closeout owner' };
}

async function softwareEngineerCompleted(repoRoot: string, taskId: string): Promise<boolean> {
  const taskRuntime = resolvePaths({ repoRoot, taskId }).taskRuntime;
  // Runtime completion accepts a finished session (terminal.status === 'completed')
  // OR a passing guardrail receipt. This is distinct from the remediation-loop
  // guardrail (rules/transition.ts), which intentionally requires only the
  // authoritative guardrail receipt.
  const roleSessionPath = path.join(taskRuntime, 'role-sessions', 'software-engineer.json');
  const roleSessionRaw = await readTextFile(roleSessionPath);
  if (roleSessionRaw) {
    try {
      const parsed = JSON.parse(roleSessionRaw) as { terminal?: { status?: string } };
      if (parsed.terminal?.status === 'completed') {
        return true;
      }
    } catch {
      // Fall through to the guardrail receipt.
    }
  }
  return softwareEngineerGuardrailPassed(taskRuntime);
}

export async function computeRuntimeCompletionFacts(options: {
  repoRoot: string;
  taskId: string;
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<Record<string, RuntimeAgentFacts>> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const handoffsDir = options.handoffsDir ?? paths.handoffs;
  const implStepsDir = options.implStepsDir ?? paths.implementationSteps;

  const sharedOpts = { handoffsDir, implStepsDir, repoRoot: options.repoRoot };
  const [pmCompleted, sweCompleted, qaCompleted] = await Promise.all([
    checkAgentArtifactCompletion({ agentId: 'product-manager', ...sharedOpts }),
    softwareEngineerCompleted(options.repoRoot, options.taskId),
    checkAgentArtifactCompletion({ agentId: 'qa', ...sharedOpts }),
  ]);
  return {
    'product-manager': { completed: pmCompleted },
    'software-engineer': { completed: sweCompleted },
    qa: { completed: qaCompleted },
  } satisfies Record<string, RuntimeAgentFacts>;
}

export function inferNextAgentFromCompletion(
  completion: Record<string, RuntimeAgentFacts>,
): { agentId: string; source: string } {
  if (!completion['product-manager']?.completed) {
    return { agentId: 'product-manager', source: 'typescript runtime completion' };
  }
  if (!completion['software-engineer']?.completed) {
    return { agentId: 'software-engineer', source: 'typescript runtime completion' };
  }
  return { agentId: 'qa', source: 'typescript runtime completion' };
}

export async function evaluateRuntimeInference(options: {
  repoRoot: string;
  taskId: string;
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<RuntimeInferenceResult> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const handoffsDir = options.handoffsDir ?? paths.handoffs;
  const provider = getActiveProvider(options.repoRoot);
  const runtimeToProviderAgentId = (agentId: string): string => provider.runtimeToProviderAgentId(agentId);
  const completion = await computeRuntimeCompletionFacts(options);
  const remediation = await remediationNextAgent(handoffsDir, runtimeToProviderAgentId);
  const closeout = await closeoutNextAgent(handoffsDir, runtimeToProviderAgentId);
  const nextAgent = remediation ?? closeout ?? inferNextAgentFromCompletion(completion);

  return {
    completion,
    parallel: {
      active_approval: await detectParallelOk(handoffsDir),
    },
    nextAgent,
  };
}
