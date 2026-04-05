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
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'artifact-completion-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps');
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

  const writeQaArtifacts = (options: { closeoutOwner?: string; difficultyLevel?: string } = {}): void => {
    const { closeoutOwner = 'qa', difficultyLevel = 'Medium' } = options;
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      '# Issues\n\n## Review Outcome\n\npass\n',
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
    });

    expect(prompt).toContain('implementation-spec.md');
    expect(prompt).toContain('Simple or Complex');
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
    });

    expect(prompt).toContain('parallel-ok.md');
    expect(prompt).toContain("'Simple' or 'Complex'");
  });

  it('returns true immediately for software-engineer (no required artifacts)', async () => {
    await expect(checkAgentArtifactCompletion({
      agentId: 'software-engineer',
      handoffsDir,
      implStepsDir,
    })).resolves.toBe(true);
  });

  it('returns empty remediation prompt for software-engineer', async () => {
    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'software-engineer',
      handoffsDir,
      implStepsDir,
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
    })).resolves.toBe(true);
  });

  it('rejects qa completion when the closeout owner is not qa', async () => {
    writeQaArtifacts({ closeoutOwner: 'product-manager' });

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
    })).resolves.toBe(false);
  });

  it('blocks qa completion when final summary difficulty is blank', async () => {
    writeQaArtifacts({ difficultyLevel: '' });

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
    })).resolves.toBe(false);
  });

  it('mentions difficulty remediation when qa final summary is otherwise complete', async () => {
    writeQaArtifacts({ difficultyLevel: '' });

    const prompt = await buildAgentArtifactRemediationPrompt({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
    });

    expect(prompt).toContain('Difficulty Level');
    expect(prompt).toContain("'Easy', 'Medium', or 'Hard'");
  });
});
