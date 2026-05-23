import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../core/index.js';
import {
  PolicyValidator,
  loadWorkspaceArtifact,
  parseSections,
  parseSemanticSections,
  stripHtmlCommentsFromSections,
} from '../index.js';
import { evaluateCloseoutRules } from '../rules/closeout.js';
import { evaluateIntakeQualityRules } from '../rules/intake.js';
import { evaluateSpecQualityRules } from '../rules/spec.js';
import { evaluateTaskQualityRules } from '../rules/taskQuality.js';

const TEST_TASK_ID = 'task-test-001';

function writeFile(repoRoot: string, relativePath: string, content: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
}

function createRoot(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'html-comment-semantics-'));
  const { handoffs, implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
  mkdirSync(handoffs, { recursive: true });
  mkdirSync(implementationSteps, { recursive: true });
  for (const fileName of [
    'professional-task.md',
    'implementation-spec.md',
    'parallel-ok.md',
    'retrospective-input.md',
    'issues.md',
    'final-summary.md',
  ]) {
    writeFileSync(path.join(handoffs, fileName), '', 'utf-8');
  }
  writeFileSync(
    path.join(handoffs, 'professional-task.md'),
    '# Task\n\n## Task Metadata\n- Task ID: task-test-001\n',
    'utf-8',
  );
  return repoRoot;
}

function handoffPath(repoRoot: string, fileName: string): string {
  return path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, fileName);
}

function validator(repoRoot: string, mode: 'lint' | 'ci' | 'pre-closeout' | 'pre-archive' = 'lint'): PolicyValidator {
  return new PolicyValidator({ rootDir: repoRoot, mode, taskId: TEST_TASK_ID });
}

function writeImplementationSpec(repoRoot: string, content: string): void {
  writeFileSync(handoffPath(repoRoot, 'implementation-spec.md'), content, 'utf-8');
}

function specMarkdown(sectionBody: string): string {
  return [
    '# Implementation Spec',
    '',
    '## Problem Statement',
    sectionBody,
    '',
    '## Goals',
    '- Goal is measurable.',
    '',
    '## Non-Goals',
    '- No unrelated work.',
    '',
    '## Architecture Summary',
    '- Small change.',
    '',
    '## Touched Systems',
    '- Backend policy.',
    '',
    '## Change Boundaries',
    '- No UI.',
    '',
    '## Dependency Analysis',
    '- None.',
    '',
    '## Codebase Analysis',
    '- Existing parser.',
    '',
    '## Proposed Structure',
    '- Helper plus callers.',
    '',
    '## Validation Strategy',
    '```bash',
    'pnpm run lint',
    '```',
    '',
    '## Files or Areas Likely to Change',
    '- src/backend/platform/workflow-policy/artifacts.ts',
  ].join('\n');
}

describe('workflow-policy HTML comment semantics', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('keeps parseSections raw while semantic helpers strip comments without mutating input', () => {
    const markdown = '## Decision\n<!-- seeded guidance -->\nSimple\n';
    const raw = parseSections(markdown);
    const semantic = parseSemanticSections(markdown);
    const original = { Decision: ['<!-- comment -->', 'Simple'] };
    const stripped = stripHtmlCommentsFromSections(original);

    expect(raw.Decision).toEqual(['<!-- seeded guidance -->', 'Simple']);
    expect(semantic.Decision).toEqual(['', 'Simple']);
    expect(stripped.Decision).toEqual(['', 'Simple']);
    expect(original.Decision).toEqual(['<!-- comment -->', 'Simple']);
  });

  it('loads workspace artifacts with semantic sections while leaving markdown bytes unchanged', async () => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    writeFile(
      repoRoot,
      'artifact.md',
      [
        '# Artifact',
        '',
        '## Task Metadata',
        '<!-- guidance -->',
        '- Task ID: task-test-001',
        '',
        '### Task Lineage',
        '<!-- lineage guidance -->',
        '- Parent Task ID: parent-1',
        '',
        '## Content',
        '<!-- only guidance -->',
      ].join('\n'),
    );

    const before = readFileSync(path.join(repoRoot, 'artifact.md'), 'utf-8');
    const artifact = await loadWorkspaceArtifact(repoRoot, 'artifact.md');
    const after = readFileSync(path.join(repoRoot, 'artifact.md'), 'utf-8');

    expect(artifact.sections['Task Metadata']).toEqual(['', '- Task ID: task-test-001', '', '### Task Lineage', '', '- Parent Task ID: parent-1', '']);
    expect(artifact.metadata['Task ID']).toBe('task-test-001');
    expect(artifact.taskLineage['Parent Task ID']).toBe('parent-1');
    expect(artifact.hasSubstantiveContent).toBe(false);
    expect(after).toBe(before);
  });

  it('computes substantive content from semantic section bodies', async () => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    writeFile(repoRoot, 'comment-only.md', '# A\n\n## Content\n<!-- guidance -->\n');
    writeFile(repoRoot, 'with-content.md', '# A\n\n## Content\n<!-- guidance -->\nReal value\n');

    await expect(loadWorkspaceArtifact(repoRoot, 'comment-only.md')).resolves.toMatchObject({
      hasSubstantiveContent: false,
    });
    await expect(loadWorkspaceArtifact(repoRoot, 'with-content.md')).resolves.toMatchObject({
      hasSubstantiveContent: true,
    });
  });

  it.each(['pass', 'advisory', 'blocking'])('reads issues Review Outcome comment plus %s semantically', async (outcome) => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    writeFileSync(handoffPath(repoRoot, 'issues.md'), `# Issues\n\n## Review Outcome\n<!-- guidance -->\n${outcome}\n`, 'utf-8');

    const policy = validator(repoRoot, 'pre-closeout');
    await policy.initialize();
    await evaluateCloseoutRules(policy);

    const qaReview = policy.violations.filter((violation) => violation.rule_id === 'closeout.qa-review-approved');
    expect(qaReview).toEqual(outcome === 'blocking' ? [
      expect.objectContaining({ message: expect.stringContaining("Review Outcome is 'blocking'") }),
    ] : []);
  });

  it('treats comment-only issues Review Outcome as missing', async () => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    writeFileSync(handoffPath(repoRoot, 'issues.md'), '# Issues\n\n## Review Outcome\n<!-- guidance -->\n', 'utf-8');

    const policy = validator(repoRoot, 'pre-closeout');
    await policy.initialize();
    await evaluateCloseoutRules(policy);

    expect(policy.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule_id: 'closeout.qa-review-approved',
        message: expect.stringContaining("Review Outcome is 'missing'"),
      }),
    ]));
  });

  it('accepts final-summary closeout owner comment plus qa and rejects comment-only owner', async () => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    writeFileSync(handoffPath(repoRoot, 'issues.md'), '# Issues\n\n## Review Outcome\npass\n', 'utf-8');
    writeFileSync(
      handoffPath(repoRoot, 'final-summary.md'),
      '# Final\n\n## Closeout Owner Agent ID\n<!-- guidance -->\nqa\n\n## Difficulty Assessment\n- Difficulty Level: Medium\n',
      'utf-8',
    );
    const accepted = validator(repoRoot, 'pre-closeout');
    await accepted.initialize();
    await evaluateCloseoutRules(accepted);
    expect(accepted.violations.some((violation) => violation.rule_id === 'closeout.owner-agent-valid')).toBe(false);

    writeFileSync(
      handoffPath(repoRoot, 'final-summary.md'),
      [
        '# Final',
        '',
        '## Closeout Owner Agent ID',
        '<!-- guidance -->',
        '',
        '## Completed Work',
        '- Completed the work.',
        '',
        '## Difficulty Assessment',
        '- Difficulty Level: Medium',
      ].join('\n'),
      'utf-8',
    );
    const rejected = validator(repoRoot, 'pre-closeout');
    await rejected.initialize();
    await evaluateCloseoutRules(rejected);
    expect(rejected.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule_id: 'closeout.owner-agent-valid',
        message: expect.stringContaining("found 'blank'"),
      }),
    ]));
  });

  it('uses semantic sections for implementation-spec lint reads', async () => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    writeImplementationSpec(repoRoot, specMarkdown('<!-- guidance -->'));

    const missing = validator(repoRoot, 'lint');
    await missing.initialize();
    await evaluateSpecQualityRules(missing);
    expect(missing.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'spec.required-section-present', message: expect.stringContaining('Problem Statement') }),
    ]));

    writeImplementationSpec(repoRoot, specMarkdown('<!-- guidance -->\n- Problem is clear.'));
    const present = validator(repoRoot, 'lint');
    await present.initialize();
    await evaluateSpecQualityRules(present);
    expect(present.violations.some((violation) =>
      violation.rule_id === 'spec.required-section-present' && violation.message.includes('Problem Statement'),
    )).toBe(false);
  });

  it('uses semantic sections for slice, intake, and professional-task direct validation reads', async () => {
    const repoRoot = createRoot();
    roots.push(repoRoot);
    const { implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
    writeFileSync(
      path.join(implementationSteps, 'slice-1.md'),
      '# Slice\n\n## Purpose\n<!-- guidance -->\n',
      'utf-8',
    );
    const slicePolicy = validator(repoRoot);
    await slicePolicy.initialize();
    await expect(slicePolicy.sliceArtifactIsParallelReady(path.join(implementationSteps, 'slice-1.md')))
      .resolves.toMatchObject({ ready: false, missingSections: expect.arrayContaining(['Purpose']) });

    writeFile(repoRoot, 'AgentWorkSpace/dropbox/intake.md', '# Intake\n\n## Request Summary\n<!-- guidance -->\n');
    const intakePolicy = validator(repoRoot, 'lint');
    await intakePolicy.initialize();
    await evaluateIntakeQualityRules(intakePolicy);
    expect(intakePolicy.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'intake.required-section-present', message: expect.stringContaining('Request Summary') }),
    ]));

    writeFileSync(
      handoffPath(repoRoot, 'professional-task.md'),
      '# Task\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Problem Statement\n<!-- guidance -->\n',
      'utf-8',
    );
    const taskPolicy = validator(repoRoot, 'lint');
    await taskPolicy.initialize();
    await evaluateTaskQualityRules(taskPolicy);
    expect(taskPolicy.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'task.required-section-present', message: expect.stringContaining('Problem Statement') }),
    ]));
  });
});
