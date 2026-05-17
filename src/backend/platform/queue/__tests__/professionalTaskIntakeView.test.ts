import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activateNextPendingItemIfReady } from '../operations.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';

const PROFESSIONAL_TASK_TEMPLATE = [
  '# Professional Task',
  '',
  '## Task Metadata',
  '',
  '- Task ID:',
  '- Task Title:',
  '- Initialized At (UTC):',
  '- Active Branch:',
  '- Intake Source:',
  '',
  '## Task Lineage',
  '',
  '- Task Kind:',
  '- Parent Task ID:',
  '- Root Task ID:',
  '- Parent QMD Record ID:',
  '- Parent QMD Scope:',
  '- Follow-Up Reason:',
  '',
  '## Raw Request',
  '',
  '## Parent Task Carry-Forward Context',
  '',
  '## Problem Statement',
  '',
  '## Business Goal',
  '',
  '## Scope',
  '',
  '## Non-Goals',
  '',
  '## Constraints',
  '',
  '## Acceptance Criteria',
  '',
  '## Risks',
  '',
  '## Open Questions',
  '',
].join('\n');

import { IMPLEMENTATION_SPEC_TEMPLATE, sectionBetween } from './intakeTestHelpers.js';

function seedTemplates(templatesDir: string): void {
  for (const filename of HANDOFF_FILES) {
    const template = filename === 'professional-task.md'
      ? PROFESSIONAL_TASK_TEMPLATE
      : filename === 'implementation-spec.md'
        ? IMPLEMENTATION_SPEC_TEMPLATE
        : '# Template\n';
    writeFileSync(path.join(templatesDir, filename), template);
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# Slice Template\n');
}

describe('professional-task intake view generation during activation', () => {
  let repoRoot: string;
  let pendingDir: string;
  let templatesDir: string;
  let savedAutostart: string | undefined;

  beforeEach(() => {
    savedAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-professional-task-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
    seedTemplates(templatesDir);
  });

  afterEach(() => {
    if (savedAutostart === undefined) {
      delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    } else {
      process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = savedAutostart;
    }
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('generates fallback professional-task sections for legacy pending markdown', async () => {
    writeFileSync(path.join(pendingDir, 'task-004.md'), '# Add search\n');

    const result = await activateNextPendingItemIfReady({
      paths: resolveQueuePaths(repoRoot),
      repoRoot,
    });

    expect(result.activated).toBe(true);
    const taskHandoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-004', 'handoffs');
    expect(existsSync(path.join(taskHandoffsDir, 'professional-task.md'))).toBe(true);
    const professionalTask = readFileSync(path.join(taskHandoffsDir, 'professional-task.md'), 'utf-8');
    expect(professionalTask).toContain('- Task ID: task-004');
    expect(professionalTask).toContain('- Task Title: Add search');
    expect(professionalTask).toContain('- Intake Source: AgentWorkSpace/pendingitems/task-004.md');
    expect(professionalTask).toContain('## Raw Request\n\nAdd search');
    expect(professionalTask).toContain('## Business Goal\n\nComplete the requested task.');
    expect(professionalTask).toContain('## Scope\n\n- Requested task is completed without weakening existing behavior.');
    expect(professionalTask).toContain('## Non-Goals\n\n- None stated in intake.');
    expect(professionalTask).toContain('## Acceptance Criteria\n\n- Requested task is completed without weakening existing behavior.');
    expect(professionalTask).toContain('## Risks\n\n- None stated in intake.');
    expect(professionalTask).toContain('## Open Questions\n\n- None.');
  });

  it('generates professional-task.md from populated intake while preserving intake bytes', async () => {
    const pendingMarkdown = [
      '# Improve search',
      '',
      '## Request Summary',
      '',
      'Improve search relevance for saved filters.',
      '',
      '<!-- comment stripped from generated professional task -->',
      '',
      '## Desired Outcome',
      '',
      'Operators find saved filters faster.',
      '',
      '## Constraints',
      '',
      '- Do not change filter persistence.',
      '- Keep existing keyboard shortcuts.',
      '',
      '## Acceptance Signals',
      '',
      '- Search returns relevant saved filters.',
      '',
      '## Critical Requirements',
      '',
      '- CR-001: Preserve saved filter IDs exactly.',
      '- CR-002: Preserve this exact command block:',
      '  ```bash',
      '  pnpm exec vitest run src/backend/platform/queue/__tests__/professionalTaskIntakeView.test.ts',
      '  ```',
      '',
      '## Compatibility Requirements',
      '',
      '- COMP-001: Existing saved filter shortcuts still work.',
      '',
      '## Required Validation',
      '',
      '    pnpm run validate -- --preserve-leading-indent',
      '',
      '- VAL-001: Run `pnpm run lint`.',
      '- VAL-002: Run exact validation:',
      '  ```bash',
      '  pnpm run validate',
      '  ```',
      '',
      '## Task Lineage',
      '',
      '- Task Kind: child-task',
      '- Parent Task ID: parent-1',
      '- Root Task ID: root-1',
      '- Parent QMD Record ID: qmd-1',
      '- Parent QMD Scope: search',
      '- Follow-Up Reason: regression',
      '',
      '## Parent Task Carry-Forward Summary',
      '',
      '- Preserve the parent search rollout boundary.',
      '',
    ].join('\n');
    writeFileSync(path.join(pendingDir, 'task-005.md'), pendingMarkdown);

    const result = await activateNextPendingItemIfReady({
      paths: resolveQueuePaths(repoRoot),
      repoRoot,
    });

    expect(result.activated).toBe(true);
    const taskHandoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-005', 'handoffs');
    const professionalTask = readFileSync(path.join(taskHandoffsDir, 'professional-task.md'), 'utf-8');
    expect(professionalTask).toContain('## Raw Request\n\nImprove search relevance for saved filters.');
    expect(professionalTask).toContain('## Problem Statement\n\nImprove search relevance for saved filters.');
    expect(professionalTask).toContain('## Business Goal\n\nOperators find saved filters faster.');
    expect(professionalTask).toContain('## Scope\n\n- CR-001: Preserve saved filter IDs exactly.');
    expect(professionalTask).toContain('## Non-Goals\n\n- Do not change filter persistence.');
    expect(professionalTask).toContain('## Constraints\n\n- Do not change filter persistence.\n- Keep existing keyboard shortcuts.\n\nCompatibility requirements from intake:\n- COMP-001: Existing saved filter shortcuts still work.');
    expect(professionalTask).toContain([
      '## Acceptance Criteria',
      '',
      '- Search returns relevant saved filters.',
      '',
      'Required validation from intake:',
      '    pnpm run validate -- --preserve-leading-indent',
      '',
      '- VAL-001: Run `pnpm run lint`.',
    ].join('\n'));
    expect(professionalTask).toContain('## Parent Task Carry-Forward Context\n\n- Preserve the parent search rollout boundary.');
    expect(professionalTask).not.toContain('comment stripped');
    expect(readFileSync(path.join(taskHandoffsDir, 'intake.md'), 'utf-8')).toBe(pendingMarkdown);

    const implementationSpec = readFileSync(
      path.join(taskHandoffsDir, 'implementation-spec.md'),
      'utf-8',
    );
    expect(implementationSpec).toContain('## Intake Requirements');
    expect(implementationSpec).toContain('### Critical Requirements');
    expect(implementationSpec).toContain('### Compatibility Requirements');
    expect(implementationSpec).toContain('### Required Validation');
    expect(implementationSpec).not.toContain('comment stripped');
    expect(sectionBetween(
      implementationSpec,
      '### Critical Requirements',
      '### Compatibility Requirements',
    )).toBe([
      '- CR-001: Preserve saved filter IDs exactly.',
      '- CR-002: Preserve this exact command block:',
      '  ```bash',
      '  pnpm exec vitest run src/backend/platform/queue/__tests__/professionalTaskIntakeView.test.ts',
      '  ```',
    ].join('\n'));
    expect(sectionBetween(
      implementationSpec,
      '### Compatibility Requirements',
      '### Required Validation',
    )).toBe('- COMP-001: Existing saved filter shortcuts still work.');
    expect(sectionBetween(
      implementationSpec,
      '### Required Validation',
      '## Problem and Outcome',
    )).toBe([
      '    pnpm run validate -- --preserve-leading-indent',
      '',
      '- VAL-001: Run `pnpm run lint`.',
      '- VAL-002: Run exact validation:',
      '  ```bash',
      '  pnpm run validate',
      '  ```',
    ].join('\n'));
  });

  it('uses acceptance signals as generated scope when critical requirements are None', async () => {
    writeFileSync(
      path.join(pendingDir, 'task-006.md'),
      [
        '# Critical none',
        '',
        '## Request Summary',
        '',
        'Handle a small request.',
        '',
        '## Critical Requirements',
        '',
        'None',
        '',
        '## Acceptance Signals',
        '',
        '- Small request is handled.',
        '',
      ].join('\n'),
    );

    await activateNextPendingItemIfReady({
      paths: resolveQueuePaths(repoRoot),
      repoRoot,
    });

    const professionalTask = readFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-006', 'handoffs', 'professional-task.md'),
      'utf-8',
    );
    expect(professionalTask).toContain('## Scope\n\n- Small request is handled.');

    const implementationSpec = readFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-006', 'handoffs', 'implementation-spec.md'),
      'utf-8',
    );
    expect(sectionBetween(
      implementationSpec,
      '### Critical Requirements',
      '### Compatibility Requirements',
    )).toBe('None');
    expect(sectionBetween(
      implementationSpec,
      '### Compatibility Requirements',
      '### Required Validation',
    )).toBe('None');
    expect(sectionBetween(
      implementationSpec,
      '### Required Validation',
      '## Problem and Outcome',
    )).toBe('None');
  });
});
