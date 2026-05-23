import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const readTextFile = vi.fn<(_: string) => Promise<string | undefined>>();

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    readTextFile,
  };
});

const { checkAgentArtifactCompletion, buildAgentArtifactRemediationPrompt, detectParallelOk } = await import('../artifactCompletion.js');

describe('artifactCompletion', () => {
  const TEST_TASK_ID = 'task-test-001';
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'artifact-completion-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
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

  const writeQaArtifacts = (options: { closeoutOwner?: string; difficultyLevel?: string; reviewOutcome?: string } = {}): void => {
    const { closeoutOwner = 'qa', difficultyLevel = 'Medium', reviewOutcome = 'pass' } = options;
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      `# Issues\n\n## Review Outcome\n\n${reviewOutcome}\n`,
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Retrospective Summary\n\n- concise note\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n'
      + `## Closeout Owner Agent ID\n\n${closeoutOwner}\n\n`
      + '## Completed Work\n\n- delivered fix\n\n'
      + '## Key Design Decisions\n\n- kept contract aligned\n\n'
      + '## Known Limitations\n\n- none\n\n'
      + '## Task branches\n\n[]\n\n'
      + `## Difficulty Assessment\n\n- Difficulty Level: ${difficultyLevel}\n`,
      'utf-8',
    );
  };

  it('allows explicit sequential parallel-ok artifacts for product manager completion', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nsimple\n\n## Independent Slices\n\nNone.\n\n## Coordination Notes\n\nNo split.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('requires an explicit parallel-ok decision before product manager can complete', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('requires implementation-spec before product manager can complete', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n<!-- placeholder -->\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('treats placeholder-only slice sections as incomplete for product manager completion', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nTBD\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('names missing product-manager slice sections in remediation prompt', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n## Purpose\n\nAdd search support.\n\n## Depends On\n\nNone.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    });

    expect(prompt).toContain('slice-search.md');
    expect(prompt).toContain('Scope');
    expect(prompt).toContain('Validation Commands / Validation');
    expect(prompt).toContain('Acceptance and Validation');
  });

  it('accepts workflow-policy section aliases when checking product-manager slice readiness', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Objective\n\nAdd search support.\n\n'
      + '## Dependencies\n\nNone.\n\n'
      + '## Execution Scope\n\n- add exact-match search\n\n'
      + '## Files and Interfaces\n\n- crud.py\n\n'
      + '## Acceptance\n\n- search works\n\n'
      + '## Tests\n\n- test_search\n\n'
      + '## Validation\n\n```bash\npytest -q\n```\n\n'
      + '## Coordination Notes\n\nNo unrelated changes.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('accepts validation commands nested under the Acceptance and Validation container', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance and Validation\n\n'
      + '### Acceptance Criteria\n\n- search works\n\n'
      + '### Unit Tests\n\n- test_search\n\n'
      + '### Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('requires the final product-manager slice to be runtime ready', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice2.md'),
      '# Slice Template\n\n## Purpose\n<!-- placeholder -->\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);

    writeFileSync(
      path.join(implStepsDir, 'slice2.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nFinish CRUD tests.\n\n'
      + '## Depends On\n\nslice-search\n\n'
      + '## Scope\n\n- add search assertions\n\n'
      + '## Files\n\n- test_crud.py: extend tests\n\n'
      + '## Acceptance Criteria\n\n- search coverage passes\n\n'
      + '## Unit Tests\n\n- test_search_filters_matching_records\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nDo not alter production logic here.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('tells product manager to complete implementation-spec before routing parallel or sequential work', async () => {
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    });

    expect(prompt).toContain('implementation-spec.md');
    expect(prompt).toContain('Simple or Complex');
  });

  it('gives Alice concrete cleanup instructions for generated intake spine policy failures', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
      taskId: TEST_TASK_ID,
      policyViolationRuleIds: ['spec.intake-requirements-critical-matches'],
    });

    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/implementation-spec.md');
    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/intake.md');
    expect(prompt).toContain('## Intake Requirements');
    expect(prompt).toContain(
      'restore the generated ## Intake Requirements section from intake.md. Do not reinterpret, summarize, reorder, or weaken the copied Critical Requirements, Compatibility Requirements, or Required Validation content. Leave authored planning sections otherwise unchanged unless needed to keep markdown structure valid.',
    );
  });

  it('does not create cleanup instructions for unrelated policy failures alone', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
      taskId: TEST_TASK_ID,
      policyViolationRuleIds: ['runtime.agent-transition-legal'],
    });

    expect(prompt).toBe('');
  });

  it.each([
    'slice.requirement-id-covered',
    'slice.validation-id-covered',
    'slice.requirement-id-known',
  ])('gives Alice concrete cleanup instructions for %s policy failures', async (ruleId) => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-1.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
      taskId: TEST_TASK_ID,
      policyViolationRuleIds: [ruleId],
    });

    expect(prompt).toContain('$COPILOT_HANDOFFS_DIR/implementation-spec.md');
    expect(prompt).toContain('$COPILOT_IMPL_STEPS_DIR/');
    expect(prompt).toContain('## Intake Requirements');
    expect(prompt).toContain('### Requirement Handling');
    expect(prompt).toContain('### Requirement Coverage');
    expect(prompt).toContain('account for every generated CR-*, COMP-*, and VAL-* ID by exact ID');
    expect(prompt).toContain('put every VAL-* in a validation surface');
    expect(prompt).toContain('remove or correct any unknown requirement ID');
    expect(prompt).toContain('Do not paste every ID into every slice.');
  });

  it('tells product manager to record a simple-or-complex decision in parallel-ok', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Goals\n\n- add query helpers\n\n## Validation Strategy\n\n```bash\npytest -q\n```\n\n## Files or Areas Likely to Change\n\n- crud.py\n',
      'utf-8',
    );
    writeFileSync(
      path.join(implStepsDir, 'slice-search.md'),
      '# Slice Template\n\n'
      + '## Purpose\n\nAdd search support.\n\n'
      + '## Depends On\n\nNone.\n\n'
      + '## Scope\n\n- add exact-match search\n\n'
      + '## Files\n\n- crud.py\n\n'
      + '## Acceptance Criteria\n\n- search works\n\n'
      + '## Unit Tests\n\n- test_search\n\n'
      + '## Validation Commands\n\n```bash\npytest -q\n```\n\n'
      + '## Guards\n\nNo unrelated changes.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    });

    expect(prompt).toContain('parallel-ok.md');
    expect(prompt).toContain("'Simple' or 'Complex'");
  });

  it('returns true immediately for software-engineer (no required artifacts)', async () => {
    await expect(checkAgentArtifactCompletion({
      agentId: 'software-engineer',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('returns empty remediation prompt for software-engineer', async () => {
    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'software-engineer',
      handoffsDir,
      implStepsDir,
      repoRoot,
    });
    expect(prompt).toBe('');
  });

  it('detects active complex authorization from the Decision section only', async () => {
    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nComplex execution authorized.\n',
      'utf-8',
    );
    await expect(detectParallelOk(handoffsDir)).resolves.toBe(true);

    writeFileSync(
      path.join(handoffsDir, 'parallel-ok.md'),
      '# Parallel OK\n\n## Decision\n\nSimple execution required.\n',
      'utf-8',
    );
    await expect(detectParallelOk(handoffsDir)).resolves.toBe(false);
  });

  it('completes qa work with closeout artifacts, qa ownership, and accepted difficulty', async () => {
    writeQaArtifacts();

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('rejects qa completion when the closeout owner is not qa', async () => {
    writeQaArtifacts({ closeoutOwner: 'product-manager' });

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('blocks qa completion when final summary difficulty is blank', async () => {
    writeQaArtifacts({ difficultyLevel: '' });

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('accepts qa completion with natural review outcome and difficulty phrasing', async () => {
    writeQaArtifacts({ reviewOutcome: 'Pass - no findings.' });
    const finalSummaryPath = path.join(handoffsDir, 'final-summary.md');
    writeFileSync(
      finalSummaryPath,
      '# Final Summary\n\n'
      + '## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- delivered fix\n\n'
      + '## Key Design Decisions\n\n- kept contract aligned\n\n'
      + '## Known Limitations\n\n- none\n\n'
      + '## Task branches\n\n[]\n\n'
      + '## Difficulty Assessment\n\nDifficulty Level - medium confidence\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('fails qa completion when generated requirement IDs are still pending', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n- VAL-001: Run tests.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n'
      + '## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- delivered fix\n\n'
      + '## Key Design Decisions\n\n- kept contract aligned\n\n'
      + '## Known Limitations\n\n- none\n\n'
      + '## Requirement Verification\n\n- CR-001: pending - Ron must verify before pass/advisory closeout.\n- VAL-001: verified - focused tests passed.\n\n'
      + '## Task branches\n\n[]\n\n'
      + '## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('fails qa completion when generated requirement IDs exist and Requirement Verification is absent', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('fails qa completion when requirement evidence is hidden in comments or fenced code', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n'
      + '## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- delivered fix\n\n'
      + '## Key Design Decisions\n\n- kept contract aligned\n\n'
      + '## Known Limitations\n\n- none\n\n'
      + '## Requirement Verification\n\n<!-- - CR-001: verified - hidden -->\n\n```text\n- CR-001: verified - hidden\n```\n\n'
      + '## Task branches\n\n[]\n\n'
      + '## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('accepts qa completion when generated requirements are verified or advisory', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n- VAL-001: Run tests.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n'
      + '## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- delivered fix\n\n'
      + '## Key Design Decisions\n\n- kept contract aligned\n\n'
      + '## Known Limitations\n\n- none\n\n'
      + '## Requirement Verification\n\n- CR-001: verified acceptance criteria passed.\n- VAL-001: advisory broad suite remains follow-up.\n\n'
      + '## Task branches\n\n[]\n\n'
      + '## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('accepts qa completion when generated requirement statuses use dash separators', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n- VAL-001: Run tests.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n'
      + '## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- delivered fix\n\n'
      + '## Key Design Decisions\n\n- kept contract aligned\n\n'
      + '## Known Limitations\n\n- none\n\n'
      + '## Requirement Verification\n\n- CR-001 — verified—acceptance criteria passed.\n- VAL-001 - advisory - broad suite remains follow-up.\n\n'
      + '## Task branches\n\n[]\n\n'
      + '## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('names Requirement Verification in qa remediation when generated IDs are incomplete', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
      taskId: TEST_TASK_ID,
    });

    expect(prompt).toContain('populate ## Requirement Verification');
    expect(prompt).toContain('replace each pending with verified or advisory');
  });

  it('fails qa completion when issues.md lacks top-level Review Outcome', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      '# Issues\n\n## Task Metadata\n\n- Review Outcome: pass\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('allows blocking qa completion without final-summary or retrospective artifacts', async () => {
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      '# Issues\n\n'
      + '## Review Outcome\n\nblocking\n\n'
      + '## Finding\n\nThe implementation is incomplete.\n\n'
      + '## Severity\n\nblocking\n\n'
      + '## Finding Type\n\ncode-review\n\n'
      + '## Required Fix\n\nFinish the required behavior.\n\n'
      + '## Remediation Owner Agent ID\n\nsoftware-engineer\n\n'
      + '## Revalidation Agent ID\n\nqa\n\n'
      + '## Return-To Agent ID\n\nqa\n\n'
      + '## Retest Instructions\n\nRun the focused test.\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('fails qa completion when final-summary lacks top-level Closeout Owner Agent ID', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Task Metadata\n\n- Closeout Owner Agent ID: qa\n\n## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- choice\n\n## Known Limitations\n\n- none\n\n## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('fails qa completion when Task branches heading casing is wrong', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- choice\n\n## Known Limitations\n\n- none\n\n## Task Branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('remediation prompt for shape failures instructs Ron to preserve seeded top-level headings', async () => {
    writeQaArtifacts();
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- choice\n\n## Known Limitations\n\n- none\n\n## Task Branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
      taskId: TEST_TASK_ID,
    });

    expect(prompt).toContain('preserve every top-level ## heading from the seeded template');
    expect(prompt).toContain('Do not move Closeout Owner Agent ID, Review Outcome, or Task branches into Task Metadata or a custom summary');
  });

  it('mentions difficulty remediation when qa final summary is otherwise complete', async () => {
    writeQaArtifacts({ difficultyLevel: '' });

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    });

    expect(prompt).toContain('Difficulty Level');
    expect(prompt).toContain("'Easy', 'Medium', or 'Hard'");
  });

  it('confirms per-task isolation: reads qa artifacts from per-task handoffsDir', async () => {
    const perTaskHandoffs = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 't1', 'handoffs');
    const perTaskImplSteps = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 't1', 'ImplementationSteps');
    mkdirSync(perTaskHandoffs, { recursive: true });
    mkdirSync(perTaskImplSteps, { recursive: true });

    // Per-task handoffs have complete qa artifacts
    writeFileSync(
      path.join(perTaskHandoffs, 'issues.md'),
      '# Issues\n\n## Review Outcome\n\npass\n',
      'utf-8',
    );
    writeFileSync(
      path.join(perTaskHandoffs, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Retrospective Summary\n\n- concise note\n',
      'utf-8',
    );
    writeFileSync(
      path.join(perTaskHandoffs, 'final-summary.md'),
      '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- choice\n\n## Known Limitations\n\n- none\n\n## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir: perTaskHandoffs,
      implStepsDir: perTaskImplSteps,
      repoRoot,
      taskId: 't1',
    })).resolves.toBe(true);
  });
});
