import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const checkAgentArtifactCompletion = vi.fn();
const detectParallelOk = vi.fn();

vi.mock('../artifactCompletion.js', () => ({
  checkAgentArtifactCompletion,
  detectParallelOk,
}));

const {
  computeRuntimeFactsSourceSignature,
  computeRuntimeWorkflowFacts,
  writeRuntimeWorkflowFacts,
} = await import('../runtimeFacts.js');

describe('runtimeFacts', () => {
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    detectParallelOk.mockResolvedValue(false);
    repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-facts-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('uses runtime receipts to keep workflow on software-engineer until Dalton completes', async () => {
    checkAgentArtifactCompletion.mockImplementation(async ({ agentId }: { agentId: string }) => {
      if (agentId === 'product-manager') {
        return true;
      }
      return false;
    });

    const facts = await computeRuntimeWorkflowFacts({ repoRoot, handoffsDir, implStepsDir });

    expect(facts.completion['product-manager'].completed).toBe(true);
    expect(facts.completion['software-engineer'].completed).toBe(false);
    expect(facts.next_agent_id).toBe('software-engineer');
    expect(facts.next_agent_source).toBe('typescript runtime completion');
  });

  it('prefers remediation owner over completion-derived next agent', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      '# QA Issues\n\n## Severity\n\nblocking\n\n## Remediation Owner Agent ID\n\nsoftware-engineer\n',
      'utf-8',
    );

    const facts = await computeRuntimeWorkflowFacts({ repoRoot, handoffsDir, implStepsDir });

    expect(facts.next_agent_id).toBe('software-engineer');
    expect(facts.next_agent_source).toBe('qa issues remediation owner');
  });

  it('captures parallel active approval from the TS parser', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nParallel execution authorized.\n',
      'utf-8',
    );
    detectParallelOk.mockResolvedValue(true);

    const facts = await computeRuntimeWorkflowFacts({ repoRoot, handoffsDir, implStepsDir });

    expect(facts.parallel.active_approval).toBe(true);
  });

  it('reuses cached runtime facts while tracked inputs stay unchanged', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    detectParallelOk.mockResolvedValue(false);
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '# Task\n\n## Summary\n\nInitial content.\n',
      'utf-8',
    );

    await writeRuntimeWorkflowFacts({ repoRoot, handoffsDir, implStepsDir });
    await writeRuntimeWorkflowFacts({ repoRoot, handoffsDir, implStepsDir });

    expect(checkAgentArtifactCompletion).toHaveBeenCalledTimes(2);
    expect(detectParallelOk).toHaveBeenCalledTimes(1);

    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '# Task\n\n## Summary\n\nUpdated content.\n',
      'utf-8',
    );

    await writeRuntimeWorkflowFacts({ repoRoot, handoffsDir, implStepsDir });

    expect(checkAgentArtifactCompletion).toHaveBeenCalledTimes(4);
    expect(detectParallelOk).toHaveBeenCalledTimes(2);
  });

  it('ignores testing metadata files when computing the runtime facts signature', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    const conventionsDir = path.join(repoRoot, '.platform-state', 'runtime', 'conventions');
    const guardrailsDir = path.join(repoRoot, '.platform-state', 'runtime', 'guardrails');
    mkdirSync(conventionsDir, { recursive: true });
    mkdirSync(guardrailsDir, { recursive: true });

    const initialSignature = await computeRuntimeFactsSourceSignature({ repoRoot, handoffsDir, implStepsDir });

    writeFileSync(
      path.join(conventionsDir, 'testing-infrastructure.json'),
      JSON.stringify({ status: 'none' }),
      'utf-8',
    );
    writeFileSync(
      path.join(guardrailsDir, 'testing-skip.json'),
      JSON.stringify({ active: true }),
      'utf-8',
    );

    const updatedSignature = await computeRuntimeFactsSourceSignature({ repoRoot, handoffsDir, implStepsDir });

    expect(updatedSignature).toBe(initialSignature);
  });
});
