import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const readTextFile = vi.fn<(_: string) => Promise<string | undefined>>();
const logWarn = vi.fn();

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: logWarn,
      error: vi.fn(),
      progress: vi.fn(),
      child() {
        return this;
      },
    }),
    readTextFile,
  };
});

const {
  buildAgentArtifactRemediationPrompt,
  checkAgentArtifactCompletion,
  checkAgentArtifactCompletionDetails,
} = await import('../artifactCompletion.js');

describe('artifact completion details', () => {
  const taskId = 'task-test-001';
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'artifact-completion-details-'));
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

  const options = (agentId: string) => ({
    agentId,
    handoffsDir,
    implStepsDir,
    repoRoot,
    taskId,
  });

  const completeImplementationSpec = (): string => '# Implementation Spec\n\n'
    + '## Problem and Outcome\n\n'
    + '### Problem Statement\n\nThe task needs a clear implementation plan.\n\n'
    + '### Goals\n\n- Ship the requested behavior.\n\n'
    + '### Non-Goals\n\n- Do not change unrelated behavior.\n\n'
    + '## Current State and Boundaries\n\n'
    + '### Codebase Analysis\n\n- Existing files define the current behavior.\n\n'
    + '### Source Inventory\n\n- SYM-001: src/example.ts focused behavior.\n\n'
    + '### Dependency Analysis\n\n| Dependency | Impact |\n| --- | --- |\n| platform | direct |\n\n'
    + '### Change Boundaries\n\n- Keep the change scoped.\n\n'
    + '## Implementation Plan\n\n'
    + '### Architecture Summary\n\nUse the existing implementation path.\n\n'
    + '### Touched Systems\n\n- platform\n\n'
    + '### Proposed Structure\n\n- Update focused code and tests.\n\n'
    + '### Slice Partition\n\n- slice-1 owns SYM-001 and focused validation.\n\n'
    + '## Validation and Evidence\n\n'
    + '### Validation Strategy\n\n```bash\npnpm test\n```\n\n'
    + '## Change Surface\n\n'
    + '### Files or Areas Likely to Change\n\n- src/example.ts\n';

  const writeReadyProductManagerArtifacts = (): void => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), completeImplementationSpec(), 'utf-8');
    writeFileSync(path.join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\n## Decision\n\nSimple\n', 'utf-8');
    writeFileSync(
      path.join(implStepsDir, 'slice-1.md'),
      '# Slice\n\n## Purpose\n\nDo work.\n\n## Depends On\n\nNone.\n\n## Scope\n\n- code\n\n'
      + '## Current Symbols\n\nNone.\n\n## Included Symbols\n\nNone.\n\n## Excluded Symbols\n\nNone.\n\n'
      + '## Files\n\n- file.ts\n\n## Acceptance Criteria\n\n- works\n\n## Unit Tests\n\n- test\n\n'
      + '## Validation Commands\n\n```bash\npnpm test\n```\n\n## Guards\n\nNo drift.\n',
      'utf-8',
    );
  };

  const parallelOkTemplateShell = (): string => '# Parallel OK\n\n'
    + 'Use this file to choose Simple single-Dalton execution or Complex Dalton fleet/orchestrator execution.\n\n'
    + '## Task Metadata\n\n'
    + '- Task ID:\n'
    + '- Task Title:\n\n'
    + '## Decision\n'
    + '<!-- (1 word) - write "Simple" or "Complex". -->\n\n'
    + '## Independent Slices\n'
    + '<!-- required when Decision is "Complex" -->\n\n'
    + '## Constraints\n'
    + '<!-- required when Decision is "Complex" -->\n\n'
    + '## Coordination Notes\n'
    + '<!-- "None" if not applicable -->\n';

  const writeQaArtifacts = (overrides: { finalSummary?: string; issues?: string; retro?: string } = {}): void => {
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      overrides.issues ?? '# Issues\n\n## Review Outcome\n\npass\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      overrides.retro ?? '# Retrospective\n\n## Retrospective Summary\n\n- no follow-up\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      overrides.finalSummary ?? '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n'
      + '## Test Status\n\npassed\n\n## QA Status\n\npassed\n\n## Task branches\n\n[]\n\n'
      + '## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
      'utf-8',
    );
  };

  it('keeps the boolean wrapper aligned with completion details', async () => {
    writeReadyProductManagerArtifacts();
    await expect(checkAgentArtifactCompletionDetails(options('product-manager'))).resolves.toEqual({
      complete: true,
      reasons: [],
    });
    await expect(checkAgentArtifactCompletion(options('product-manager'))).resolves.toBe(true);

    writeFileSync(path.join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\n## Decision\n\nMaybe\n', 'utf-8');
    await expect(checkAgentArtifactCompletionDetails(options('product-manager'))).resolves.toEqual({
      complete: true,
      reasons: [],
    });
    await expect(checkAgentArtifactCompletion(options('product-manager'))).resolves.toBe(true);
    expect(logWarn).toHaveBeenCalledWith(
      'parallel_ok.decision.invalid_fallback_simple',
      expect.objectContaining({
        taskId,
        source: 'product-manager-artifact-completion',
        decision: 'maybe',
        fallback: 'simple',
      }),
    );
  });

  it('keeps template-only parallel-ok incomplete so product-manager remediation runs', async () => {
    writeReadyProductManagerArtifacts();
    writeFileSync(path.join(handoffsDir, 'parallel-ok.md'), parallelOkTemplateShell(), 'utf-8');

    await expect(checkAgentArtifactCompletionDetails(options('product-manager'))).resolves.toEqual({
      complete: false,
      reasons: ['parallel-ok.md missing or Decision is not Simple or Complex'],
    });
    await expect(checkAgentArtifactCompletion(options('product-manager'))).resolves.toBe(false);
    expect(logWarn).not.toHaveBeenCalledWith(
      'parallel_ok.decision.invalid_fallback_simple',
      expect.anything(),
    );
  });

  it('reports product-manager missing implementation spec, missing slices, and missing slice sections', async () => {
    writeFileSync(path.join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\n## Decision\n\nMaybe\n', 'utf-8');
    const missing = await checkAgentArtifactCompletionDetails(options('product-manager'));
    expect(missing.complete).toBe(false);
    expect(missing.reasons).toEqual(expect.arrayContaining([
      'implementation-spec.md missing or empty',
      'ImplementationSteps missing slice files',
    ]));
    expect(missing.reasons).not.toContain('parallel-ok.md missing or Decision is not Simple or Complex');

    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Goals\n\n- ship\n', 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# Slice\n\n## Purpose\n\nDo work.\n', 'utf-8');
    const sections = await checkAgentArtifactCompletionDetails(options('product-manager'));
    expect(sections.reasons).toEqual(expect.arrayContaining([
      'ImplementationSteps slice slice-1.md missing required semantic section: Scope / Execution Scope',
      'ImplementationSteps slice slice-1.md missing required semantic section: Validation Commands / Validation or nested under Acceptance and Validation',
    ]));
  });

  it('reports invalid product-manager slice filenames with a concrete repair prompt', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Goals\n\n- ship\n', 'utf-8');
    writeFileSync(path.join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\n## Decision\n\nSimple\n', 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice1.md'), '# Slice\n\n## Purpose\n\nDo work.\n', 'utf-8');

    const details = await checkAgentArtifactCompletionDetails(options('product-manager'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('product-manager'));

    expect(details.complete).toBe(false);
    expect(details.reasons).toEqual(expect.arrayContaining([
      'ImplementationSteps invalid slice filenames: slice1.md',
      'ImplementationSteps missing slice files',
    ]));
    expect(prompt).toContain('replace invalid slice file name(s) (slice1.md)');
    expect(prompt).toContain('slice-<number>.md file names');
    expect(prompt).toContain('do not keep invalid slice files as active slices');
  });

  it('reports empty product-manager implementation spec with a concrete remediation prompt', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n<!-- empty -->\n', 'utf-8');
    writeFileSync(path.join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\n## Decision\n\nSimple\n', 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# Slice\n\n## Purpose\n\nDo work.\n', 'utf-8');
    const details = await checkAgentArtifactCompletionDetails(options('product-manager'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('product-manager'));

    expect(details.complete).toBe(false);
    expect(details.reasons).toContain('implementation-spec.md missing or empty');
    expect(prompt).toContain(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs', 'implementation-spec.md'));
    expect(prompt).toContain('complete the implementation spec');
  });

  it('reports qa valid pass closeout as complete with empty reasons', async () => {
    writeQaArtifacts();
    await expect(checkAgentArtifactCompletionDetails(options('qa'))).resolves.toEqual({
      complete: true,
      reasons: [],
    });
  });

  it('reports qa issue outcome and closeout artifact failures deterministically', async () => {
    writeQaArtifacts({
      issues: '# Issues\n\n## Review Outcome\n\nmaybe\n',
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nalice\n\n## Task Branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Unknown\n',
      retro: '# Retrospective\n\n<!-- empty -->\n',
    });
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    expect(details.complete).toBe(false);
    expect(details.reasons).toEqual(expect.arrayContaining([
      'issues.md Review Outcome must be pass, advisory, or blocking',
      'retrospective-input.md missing or empty',
      'final-summary.md Closeout Owner Agent ID must be qa',
      'final-summary.md missing required section content: Completed Work',
      'final-summary.md missing required section content: Key Design Decisions',
      'final-summary.md missing required section content: Known Limitations',
      'final-summary.md Test Result Summary section is missing or empty',
      'final-summary.md Test Status must be passed, failed, partially-passed, or not-run',
      'final-summary.md QA Status must be passed or issues-found',
      'final-summary.md Task branches section is missing or empty',
      'final-summary.md Difficulty Level must be Easy, Medium, or Hard',
    ]));
  });

  it('reports malformed qa structured findings and maps the reason to cleanup prompt text', async () => {
    writeQaArtifacts({
      issues: '# Issues\n\n## Review Outcome\n\nblocking\n\n## Finding\n\n- bug\n\n## Severity\n\nblocking\n',
    });
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('qa'));

    expect(details.complete).toBe(false);
    expect(details.reasons).toContain('issues.md findings are missing required structured sections');
    expect(prompt).toContain('issues.md has findings but is missing required structured sections');
  });

  it('reports the full final-summary contract when qa closeout is non-blocking and final-summary is missing', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: generated requirement\n', 'utf-8');
    writeFileSync(path.join(handoffsDir, 'issues.md'), '# Issues\n\n## Review Outcome\n\npass\n', 'utf-8');
    writeFileSync(path.join(handoffsDir, 'retrospective-input.md'), '# Retrospective\n\n## Retrospective Summary\n\n- done\n', 'utf-8');

    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('qa'));

    expect(details.complete).toBe(false);
    expect(details.reasons).toEqual(expect.arrayContaining([
      'final-summary.md missing or empty',
      'final-summary.md Closeout Owner Agent ID must be qa',
      'final-summary.md missing required section content: Completed Work',
      'final-summary.md missing required section content: Key Design Decisions',
      'final-summary.md missing required section content: Known Limitations',
      'final-summary.md Test Result Summary section is missing or empty',
      'final-summary.md Requirement Verification missing or empty for generated requirements',
      'final-summary.md Test Status must be passed, failed, partially-passed, or not-run',
      'final-summary.md QA Status must be passed or issues-found',
      'final-summary.md Task branches section is missing or empty',
      'final-summary.md Difficulty Level must be Easy, Medium, or Hard',
    ]));
    expect(prompt).toContain(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs', 'final-summary.md'));
    expect(prompt).toContain('## Task branches');
    expect(prompt).toContain('## Requirement Verification');
    expect(prompt).toContain('## Test Result Summary');
    expect(prompt).toContain('## Test Status');
    expect(prompt).toContain('## QA Status');
    expect(prompt).toContain('## Closeout Owner Agent ID');
    expect(prompt).toContain('## Completed Work');
    expect(prompt).toContain('## Key Design Decisions');
    expect(prompt).toContain('## Known Limitations');
    expect(prompt).toContain('## Difficulty Assessment');
    expect(prompt).toContain('The task is not complete until every listed section is populated or the QA Review Outcome is blocking with structured findings.');
  });

  it('reports missing Requirement Verification when generated IDs exist', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: requirement\n', 'utf-8');
    writeQaArtifacts();
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('qa'));

    expect(details.reasons).toContain('final-summary.md Requirement Verification missing or empty for generated requirements');
    expect(prompt).toContain('populate ## Requirement Verification');
  });

  it('reports generated requirement verification IDs and statuses without requirement bodies', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: sensitive body\n- VAL-001: validation body\n', 'utf-8');
    writeQaArtifacts({
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n'
      + '## Requirement Verification\n\n- CR-001: pending - details\n\n'
      + '## Test Status\n\npassed\n\n## QA Status\n\npassed\n\n'
      + '## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
    });
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    expect(details.reasons).toEqual(expect.arrayContaining([
      'final-summary.md Requirement Verification incomplete: CR-001 pending',
      'final-summary.md Requirement Verification incomplete: VAL-001 missing',
    ]));
    expect(details.reasons.join('\n')).not.toContain('sensitive body');
    expect(details.reasons.join('\n')).not.toContain('validation body');
  });

  it('accepts qa completion when generated requirement statuses are natural prose after each ID', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n- VAL-001: Run tests.\n', 'utf-8');
    writeQaArtifacts({
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n'
      + '## Requirement Verification\n\nCR-001 is verified because acceptance criteria passed.\nVAL-001 is advisory because broad suite remains follow-up.\n\n'
      + '## Test Status\n\npassed\n\n## QA Status\n\npassed\n\n'
      + '## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
    });

    await expect(checkAgentArtifactCompletion(options('qa'))).resolves.toBe(true);
  });

  it('does not let later evidence prose override the first generated requirement status', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n', 'utf-8');
    writeQaArtifacts({
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n'
      + '## Requirement Verification\n\nCR-001 is pending until the previously verified evidence is rechecked.\n\n'
      + '## Test Status\n\npassed\n\n## QA Status\n\npassed\n\n'
      + '## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
    });

    await expect(checkAgentArtifactCompletion(options('qa'))).resolves.toBe(false);
  });

  it.each([
    ['blocked'],
    ['unmet'],
    ['failed'],
    ['not met'],
  ])('reports generated requirement status %s as incomplete', async (status) => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: requirement\n', 'utf-8');
    writeQaArtifacts({
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + `## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n`
      + `## Requirement Verification\n\n- CR-001: ${status} - evidence\n\n`
      + '## Test Status\n\npassed\n\n## QA Status\n\npassed\n\n'
      + '## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
    });
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    expect(details.reasons).toContain(`final-summary.md Requirement Verification incomplete: CR-001 ${status}`);
  });

  it('returns a concrete prompt bullet for every qa diagnostic reason in a mixed incomplete closeout', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: requirement\n', 'utf-8');
    writeQaArtifacts({
      issues: '# Issues\n\n## Review Outcome\n\nmaybe\n',
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nalice\n\n## Task Branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Unknown\n',
      retro: '# Retrospective\n\n<!-- empty -->\n',
    });
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('qa'));

    expect(details.complete).toBe(false);
    expect(prompt).toContain('Artifact repair protocol');
    expect(prompt).toContain('do not answer with a prose-only verdict');
    expect(prompt).toContain('Required QA write order during repair');
    expect(prompt).toContain('Review Outcome');
    expect(prompt).toContain('retrospective-input.md');
    expect(prompt).toContain('always populate Retrospective Summary, Meeting Context, and Lily/Alice/Dalton/Ron contribution sections');
    expect(prompt).toContain('Closeout Owner Agent ID');
    expect(prompt).toContain('Completed Work');
    expect(prompt).toContain('Key Design Decisions');
    expect(prompt).toContain('Known Limitations');
    expect(prompt).toContain('Task branches');
    expect(prompt).toContain('Requirement Verification');
    expect(prompt).toContain('Test Result Summary');
    expect(prompt).toContain('Test Status');
    expect(prompt).toContain('QA Status');
    expect(prompt).toContain('Difficulty Level');
  });

  it('treats comment-only final-summary sections as incomplete for QA closeout', async () => {
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: requirement\n', 'utf-8');
    writeQaArtifacts({
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\n<!-- hidden -->\n\n'
      + '## Requirement Verification\n\n<!-- - CR-001: verified - hidden -->\n\n'
      + '## Test Status\n\n<!-- passed -->\n\n## QA Status\n\n<!-- passed -->\n\n'
      + '## Task branches\n\n<!-- [] -->\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n',
    });

    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    expect(details.reasons).toEqual(expect.arrayContaining([
      'final-summary.md Test Result Summary section is missing or empty',
      'final-summary.md Requirement Verification missing or empty for generated requirements',
      'final-summary.md Test Status must be passed, failed, partially-passed, or not-run',
      'final-summary.md QA Status must be passed or issues-found',
      'final-summary.md Task branches section is missing or empty',
    ]));
  });

  it('accepts valid Test Status and QA Status values and rejects invalid values precisely', async () => {
    for (const testStatus of ['passed', 'failed', 'partially-passed', 'not-run']) {
      writeQaArtifacts({ finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
        + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
        + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n'
        + `## Test Status\n\n${testStatus}\n\n## QA Status\n\nissues-found\n\n`
        + '## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n' });
      const details = await checkAgentArtifactCompletionDetails(options('qa'));
      expect(details.reasons).not.toContain('final-summary.md Test Status must be passed, failed, partially-passed, or not-run');
      expect(details.reasons).not.toContain('final-summary.md QA Status must be passed or issues-found');
    }

    writeQaArtifacts({ finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n'
      + '## Completed Work\n\n- done\n\n## Key Design Decisions\n\n- kept simple\n\n'
      + '## Known Limitations\n\n- none\n\n## Test Result Summary\n\nFocused checks passed.\n\n'
      + '## Test Status\n\nmaybe\n\n## QA Status\n\nunknown\n\n'
      + '## Task branches\n\n[]\n\n## Difficulty Assessment\n\n- Difficulty Level: Medium\n' });
    const invalid = await checkAgentArtifactCompletionDetails(options('qa'));
    expect(invalid.reasons).toEqual(expect.arrayContaining([
      'final-summary.md Test Status must be passed, failed, partially-passed, or not-run',
      'final-summary.md QA Status must be passed or issues-found',
    ]));
  });

  it('reflects diagnostic reasons in remediation prompts without artifact body content', async () => {
    writeQaArtifacts({
      finalSummary: '# Final Summary\n\n## Closeout Owner Agent ID\n\nalice\n\n## Completed Work\n\nsecret body\n',
    });
    const details = await checkAgentArtifactCompletionDetails(options('qa'));
    const prompt = await buildAgentArtifactRemediationPrompt(options('qa'));
    expect(details.reasons).toContain('final-summary.md Closeout Owner Agent ID must be qa');
    expect(prompt).toContain('leave the platform-owned ## Closeout Owner Agent ID section unchanged');
    expect(prompt).toContain('populate the Key Design Decisions section');
    expect(prompt).not.toContain('secret body');
  });
});
