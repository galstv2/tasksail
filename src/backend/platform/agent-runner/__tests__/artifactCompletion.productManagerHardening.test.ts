import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readTextFile = vi.fn<(_: string) => Promise<string | undefined>>();

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    readTextFile,
  };
});

const {
  buildAgentArtifactRemediationPrompt,
  checkAgentArtifactCompletionDetails,
} = await import('../artifactCompletion.js');

describe('product-manager artifact completion hardening', () => {
  const taskId = 'task-test-001';
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'pm-artifact-hardening-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    readTextFile.mockImplementation(async (filePath: string) => {
      try {
        return await readFile(filePath, 'utf-8');
      } catch {
        return undefined;
      }
    });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const options = () => ({
    agentId: 'product-manager',
    handoffsDir,
    implStepsDir,
    repoRoot,
    taskId,
  });

  function completeImplementationSpec(): string {
    return [
      '# Implementation Spec',
      '',
      '## Problem and Outcome',
      '',
      '### Problem Statement',
      'The task needs a precise execution plan.',
      '',
      '### Goals',
      '- Deliver the requested behavior.',
      '',
      '### Non-Goals',
      '- Do not change unrelated behavior.',
      '',
      '## Current State and Boundaries',
      '',
      '### Codebase Analysis',
      '- Existing code owns current behavior.',
      '',
      '### Dependency Analysis',
      '| Dependency | Impact |',
      '| --- | --- |',
      '| platform | direct |',
      '',
      '### Change Boundaries',
      '- Keep changes scoped.',
      '',
      '## Implementation Plan',
      '',
      '### Architecture Summary',
      'Use existing seams.',
      '',
      '### Touched Systems',
      '- platform',
      '',
      '### Proposed Structure',
      '- Update focused code and tests.',
      '',
      '## Validation and Evidence',
      '',
      '### Validation Strategy',
      '```bash',
      'pnpm test',
      '```',
      '',
      '## Change Surface',
      '',
      '### Files or Areas Likely to Change',
      '- src/example.ts',
    ].join('\n');
  }

  function completeSlice(purpose: string): string {
    return [
      '# Slice',
      '',
      '## Purpose',
      purpose,
      '',
      '## Depends On',
      'None.',
      '',
      '## Scope',
      '- Focused code change.',
      '',
      '## Files',
      '- src/example.ts',
      '',
      '## Acceptance Criteria',
      '- Behavior is correct.',
      '',
      '## Unit Tests',
      '- Focused unit test.',
      '',
      '## Validation Commands',
      '```bash',
      'pnpm test',
      '```',
      '',
      '## Guards',
      'No unrelated changes.',
    ].join('\n');
  }

  function writeBaseArtifacts(decision = 'Simple', independentSlices = 'None.'): void {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), completeImplementationSpec(), 'utf-8');
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      [
        '# Parallel OK',
        '',
        '## Decision',
        decision,
        '',
        '## Independent Slices',
        independentSlices,
      ].join('\n'),
      'utf-8',
    );
  }

  it('checks every canonical slice instead of only the final slice', async () => {
    writeBaseArtifacts();
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# Slice\n\n## Purpose\n\n<!-- template -->\n', 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-2.md'), completeSlice('Second slice is complete.'), 'utf-8');

    const details = await checkAgentArtifactCompletionDetails(options());

    expect(details.complete).toBe(false);
    expect(details.reasons).toEqual(expect.arrayContaining([
      'ImplementationSteps slice slice-1.md missing required semantic section: Scope / Execution Scope',
      'ImplementationSteps slice slice-1.md missing required semantic section: Validation Commands / Validation or nested under Acceptance and Validation',
    ]));
  });

  it('rejects Complex when Independent Slices is blank or comment-only', async () => {
    writeBaseArtifacts('Complex', '<!-- list orchestrated slices -->');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), completeSlice('Implement the change.'), 'utf-8');

    const details = await checkAgentArtifactCompletionDetails(options());

    expect(details.complete).toBe(false);
    expect(details.reasons).toContain('parallel-ok.md Complex decision requires Independent Slices to list existing slice-N.md files');
  });

  it('rejects Complex when Independent Slices references a missing slice file', async () => {
    writeBaseArtifacts('Complex', '- slice-1.md\n- missing-slice.md');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), completeSlice('Implement the change.'), 'utf-8');

    const details = await checkAgentArtifactCompletionDetails(options());

    expect(details.complete).toBe(false);
    expect(details.reasons).toContain('parallel-ok.md Complex Independent Slices references missing slice file: missing-slice.md');
  });

  it('accepts Complex when Independent Slices lists existing complete slices', async () => {
    writeBaseArtifacts('Complex', '- slice-1.md\n- slice-2.md\n- slice-3.md');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), completeSlice('First slice.'), 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-2.md'), completeSlice('Second slice.'), 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-3.md'), completeSlice('Third slice.'), 'utf-8');

    await expect(checkAgentArtifactCompletionDetails(options())).resolves.toEqual({
      complete: true,
      reasons: [],
    });
  });

  it('keeps Simple valid without Independent Slices content', async () => {
    writeBaseArtifacts('Simple', 'None.');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), completeSlice('Implement the simple path.'), 'utf-8');

    await expect(checkAgentArtifactCompletionDetails(options())).resolves.toEqual({
      complete: true,
      reasons: [],
    });
  });

  it('builds concrete cleanup bullets for slice and Complex Independent Slices failures', async () => {
    writeBaseArtifacts('Complex', '- slice-1.md\n- missing-slice.md');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# Slice\n\n## Purpose\n\n<!-- template -->\n', 'utf-8');

    const prompt = await buildAgentArtifactRemediationPrompt(options());

    expect(prompt).toContain(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'ImplementationSteps', 'slice-1.md'));
    expect(prompt).toContain('fill the required slice semantic section still missing content');
    expect(prompt).toContain(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs', 'parallel-ok.md'));
    expect(prompt).toContain('missing-slice.md');
    expect(prompt).not.toContain('## Product Manager Artifact Checklist');
    expect(prompt).not.toContain('## QA Artifact Checklist');
    expect(prompt).not.toContain('$COPILOT_HANDOFFS_DIR');
    expect(prompt).not.toContain('$COPILOT_IMPL_STEPS_DIR');
  });
});
