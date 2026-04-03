import path from 'node:path';
import { readTextFile } from '../core/index.js';
import { checkAgentArtifactCompletion, detectParallelOk } from '../agent-runner/artifactCompletion.js';

const ISSUES_MD_RELATIVE_PATH = 'AgentWorkSpace/handoffs/issues.md';
const FINAL_SUMMARY_MD_RELATIVE_PATH = 'AgentWorkSpace/handoffs/final-summary.md';

const MULTILINE_HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const AGENT_ID_ALIASES: Record<string, string> = {
  lily: 'planning-agent',
  alice: 'product-manager',
  dalton: 'software-engineer',
  ron: 'qa',
};

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

function parseSections(text: string | null | undefined): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const rawLine of (text ?? '').split('\n')) {
    const match = /^##\s+(.*\S)\s*$/.exec(rawLine.trim());
    if (match) {
      current = match[1] ?? null;
      if (current && !(current in sections)) {
        sections[current] = [];
      }
      continue;
    }
    if (current) {
      sections[current]!.push(rawLine.replace(/\n$/, ''));
    }
  }
  return sections;
}

function normalizeText(lines: string[]): string {
  return lines
    .map((line) => line.replace(MULTILINE_HTML_COMMENT_RE, '').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

function normalizeAgentId(value: string): string {
  const normalized = value.replace(MULTILINE_HTML_COMMENT_RE, '').trim().toLowerCase();
  return AGENT_ID_ALIASES[normalized] ?? normalized;
}

async function loadArtifact(repoRoot: string, relativePath: string): Promise<RuntimeInferenceArtifact> {
  const rawText = await readTextFile(path.join(repoRoot, relativePath));
  const sections = parseSections(rawText ?? '');
  return {
    exists: rawText !== undefined,
    sections,
    hasSubstantiveContent: Object.values(sections).some((lines) => normalizeText(lines).length > 0),
  };
}

function issuesHaveBlockingFindings(artifact: RuntimeInferenceArtifact): boolean {
  const severityText = normalizeText(artifact.sections.Severity ?? []).toLowerCase();
  return severityText.includes('blocking');
}

async function remediationNextAgent(repoRoot: string): Promise<{ agentId: string; source: string } | null> {
  const artifact = await loadArtifact(repoRoot, ISSUES_MD_RELATIVE_PATH);
  if (!artifact.exists || !artifact.hasSubstantiveContent) {
    return null;
  }
  if (!issuesHaveBlockingFindings(artifact)) {
    return null;
  }
  const owner = normalizeAgentId(normalizeText(artifact.sections['Remediation Owner Agent ID'] ?? []));
  if (owner) {
    return { agentId: owner, source: 'qa issues remediation owner' };
  }
  return null;
}

async function closeoutNextAgent(repoRoot: string): Promise<{ agentId: string; source: string } | null> {
  const finalSummary = await loadArtifact(repoRoot, FINAL_SUMMARY_MD_RELATIVE_PATH);
  if (!finalSummary.exists || !finalSummary.hasSubstantiveContent) {
    return null;
  }
  const owner = normalizeAgentId(normalizeText(finalSummary.sections['Closeout Owner Agent ID'] ?? []));
  if (!owner) {
    return null;
  }
  return { agentId: owner, source: 'final-summary closeout owner' };
}

async function softwareEngineerCompleted(repoRoot: string): Promise<boolean> {
  const roleSessionPath = path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'role-sessions',
    'software-engineer.json',
  );
  const roleSessionRaw = await readTextFile(roleSessionPath);
  if (roleSessionRaw) {
    try {
      const parsed = JSON.parse(roleSessionRaw) as {
        terminal?: { status?: string };
      };
      if (parsed.terminal?.status === 'completed') {
        return true;
      }
    } catch {
      // Fall through to the guardrail receipt.
    }
  }

  const guardrailPath = path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'guardrails',
    'software-engineer.json',
  );
  const guardrailRaw = await readTextFile(guardrailPath);
  if (!guardrailRaw) {
    return false;
  }

  try {
    const parsed = JSON.parse(guardrailRaw) as {
      status?: string;
    };
    const status = parsed.status ?? '';
    return status === 'passed' || status === 'internal-bypass';
  } catch {
    return false;
  }
}

export async function computeRuntimeCompletionFacts(options: {
  repoRoot: string;
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<Record<string, RuntimeAgentFacts>> {
  const handoffsDir = options.handoffsDir ?? path.join(options.repoRoot, 'AgentWorkSpace', 'handoffs');
  const implStepsDir = options.implStepsDir ?? path.join(options.repoRoot, 'AgentWorkSpace', 'ImplementationSteps');

  const sharedOpts = { handoffsDir, implStepsDir, repoRoot: options.repoRoot };
  const [pmCompleted, sweCompleted, qaCompleted] = await Promise.all([
    checkAgentArtifactCompletion({ agentId: 'product-manager', ...sharedOpts }),
    softwareEngineerCompleted(options.repoRoot),
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
  handoffsDir?: string;
  implStepsDir?: string;
}): Promise<RuntimeInferenceResult> {
  const handoffsDir = options.handoffsDir ?? path.join(options.repoRoot, 'AgentWorkSpace', 'handoffs');
  const completion = await computeRuntimeCompletionFacts(options);
  const remediation = await remediationNextAgent(options.repoRoot);
  const closeout = await closeoutNextAgent(options.repoRoot);
  const nextAgent = remediation ?? closeout ?? inferNextAgentFromCompletion(completion);

  return {
    completion,
    parallel: {
      active_approval: await detectParallelOk(handoffsDir),
    },
    nextAgent,
  };
}
