import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDropboxTask } from '../createDropboxTask.js';

describe('createDropboxTask', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-create-'));
    // Create minimal repo structure with .git dir for findRepoRoot
    const TEST_TASK_ID = 'task-test-001';
    mkdirSync(path.join(tmpRoot, '.git'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'dropbox'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'templates'), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a markdown file with the correct title', async () => {
    const outputPath = await createDropboxTask({
      title: 'My Test Task',
      repoRoot: tmpRoot,
    });

    expect(outputPath).toContain('my-test-task');
    expect(outputPath).toMatch(/\.md$/);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toMatch(/^# My Test Task$/m);
  });

  it('includes metadata sections in the output', async () => {
    const outputPath = await createDropboxTask({
      title: 'Metadata Task',
      summary: 'A brief summary',
      desiredOutcome: 'The desired outcome',
      constraints: 'Some constraints',
      repoRoot: tmpRoot,
    });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('## Task Lineage');
    expect(content).toContain('## Request Summary');
    expect(content).toContain('A brief summary');
    expect(content).toContain('## Desired Outcome');
    expect(content).toContain('The desired outcome');
    expect(content).toContain('## Constraints');
    expect(content).toContain('Some constraints');
    expect(content).toContain('## Critical Requirements\n\nNone');
    expect(content).toContain('## Compatibility Requirements\n\nNone');
    expect(content).toContain('## Required Validation\n\nNone');
    expect(content).toContain('- Task Kind: standard');
  });

  it('emits requirement sections in template order', async () => {
    const outputPath = await createDropboxTask({
      title: 'Requirement Task',
      summary: 'A brief summary',
      desiredOutcome: 'The desired outcome',
      constraints: '- Constraint one',
      criticalRequirements: '- CR-001: Preserve the exact merge algorithm.',
      compatibilityRequirements: '- COMP-001: Keep direct calls compatible.',
      requiredValidation: '- VAL-001: $ pnpm run lint',
      acceptanceSignals: '- Acceptance signal one',
      repoRoot: tmpRoot,
    });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content.indexOf('## Constraints')).toBeLessThan(content.indexOf('## Critical Requirements'));
    expect(content.indexOf('## Critical Requirements')).toBeLessThan(content.indexOf('## Compatibility Requirements'));
    expect(content.indexOf('## Compatibility Requirements')).toBeLessThan(content.indexOf('## Required Validation'));
    expect(content.indexOf('## Required Validation')).toBeLessThan(content.indexOf('## Acceptance Signals'));
    expect(content).toContain('- CR-001: Preserve the exact merge algorithm.');
    expect(content).toContain('- COMP-001: Keep direct calls compatible.');
    expect(content).toContain('- VAL-001: $ pnpm run lint');
  });

  it('matches the planning intake template structure', async () => {
    const outputPath = await createDropboxTask({
      title: 'Template Match Task',
      summary: 'A brief summary',
      desiredOutcome: 'The desired outcome',
      constraints: '- Constraint one',
      acceptanceSignals: '- Acceptance signal one',
      planningNotes: 'Planner note',
      repoRoot: tmpRoot,
    });

    const content = readFileSync(outputPath, 'utf-8');
    const templatePath = path.resolve(process.cwd(), 'AgentWorkSpace', 'templates', 'planning-intake.md');
    const template = readFileSync(templatePath, 'utf-8');
    const extractHeadings = (markdown: string) => (
      markdown
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('## '))
    );

    expect(extractHeadings(content)).toEqual(extractHeadings(template));
    expect(content).toContain('- Task Kind: standard');
    expect(content).toContain('- Recommended Execution: Simple');
    expect(content).toContain('- Planner Notes: Planner note');
    expect(content).toContain('- Created By: Planning Agent');
  });

  it('handles missing optional fields gracefully', async () => {
    const outputPath = await createDropboxTask({
      title: 'Minimal Task',
      repoRoot: tmpRoot,
    });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('# Minimal Task');
    expect(content).toContain('- Task Kind: standard');
    // Empty sections should still have the heading
    expect(content).toContain('## Request Summary');
    expect(content).toContain('## Desired Outcome');
  });

  it('preserves explicit output paths', async () => {
    const explicitPath = path.join(tmpRoot, 'AgentWorkSpace', 'dropbox', 'explicit-task.md');
    const outputPath = await createDropboxTask({
      title: 'Explicit Task',
      outputPath: explicitPath,
      repoRoot: tmpRoot,
    });

    expect(outputPath).toBe(explicitPath);
  });

  it('persists standard-mode primary repo and focus metadata in queue markdown', async () => {
    const outputPath = await createDropboxTask({
      title: 'Repo Selection Task',
      repoRoot: tmpRoot,
      contextPackDir: '/packs/platform',
      contextPackId: 'platform-pack',
      scopeMode: 'repo-selection',
      primaryRepoId: 'platform',
      primaryFocusId: 'api',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: ['api'],
    });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('- Scope Mode: repo-selection');
    expect(content).toContain('- Primary Repo ID: platform');
    expect(content).toContain('- Selected Repo IDs: platform, tools');
    expect(content).toContain('- Primary Focus ID: api');
    expect(content).toContain('- Selected Focus IDs: api');
  });

  it('generates a timestamped filename', async () => {
    const outputPath = await createDropboxTask({
      title: 'Timestamped',
      repoRoot: tmpRoot,
    });

    const filename = path.basename(outputPath);
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_timestamped-\d{6}\.md$/);
  });

  it('avoids generated task-id collisions with pending items', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T09:02:46.000Z'));
    try {
      const firstPath = await createDropboxTask({
        title: 'Collision Task',
        repoRoot: tmpRoot,
      });
      const firstName = path.basename(firstPath);
      writeFileSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems', firstName), '# Existing\n');
      rmSync(firstPath, { force: true });

      const secondPath = await createDropboxTask({
        title: 'Collision Task',
        repoRoot: tmpRoot,
      });

      expect(path.basename(secondPath)).toBe(firstName.replace(/\.md$/, '-2.md'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when title is missing', async () => {
    await expect(
      createDropboxTask({ title: '', repoRoot: tmpRoot }),
    ).rejects.toThrow('--title is required');
  });

  it('rejects explicit output paths with invalid task-id shape', async () => {
    await expect(
      createDropboxTask({
        title: 'Invalid explicit name',
        outputPath: 'Bad.Name.md',
        repoRoot: tmpRoot,
      }),
    ).rejects.toThrow('invalid-task-id-shape');
  });

  it('rejects whitespace-only required fields for child-task kind', async () => {
    await expect(
      createDropboxTask({
        title: 'Whitespace test',
        kind: 'child-task',
        parentTaskId: '   ',
        followupReason: 'valid',
        carryForwardSummary: 'valid',
        parentQmdScope: 'qmd/context-packs/test-pack',
        repoRoot: tmpRoot,
      }),
    ).rejects.toThrow('--parent-task-id is required');
  });

  it('rejects missing parentQmdScope for child-task kind', async () => {
    await expect(
      createDropboxTask({
        title: 'Missing scope',
        kind: 'child-task',
        parentTaskId: 'CAP-PARENT-1',
        followupReason: 'valid',
        carryForwardSummary: 'valid',
        repoRoot: tmpRoot,
      }),
    ).rejects.toThrow('--parent-qmd-scope is required for child-task intake');
  });

  it('creates child-task with lineage fields', async () => {
    const outputPath = await createDropboxTask({
      title: 'Follow-up Task',
      kind: 'child-task',
      parentTaskId: 'parent-abc',
      followupReason: 'needs fix',
      carryForwardSummary: 'parent context here',
      parentQmdScope: 'qmd/context-packs/test-pack',
      repoRoot: tmpRoot,
    });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('- Task Kind: child-task');
    expect(content).toContain('- Parent Task ID: parent-abc');
    expect(content).toContain('- Follow-Up Reason: needs fix');
    expect(content).toContain('parent context here');
  });

  it('persists Deep Focus binding metadata in queue markdown', async () => {
    const outputPath = await createDropboxTask({
      title: 'Deep Focus Task',
      repoRoot: tmpRoot,
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('- Deep Focus Enabled: true');
    expect(content).toContain('- Selected Focus Path: src/orders');
    expect(content).toContain('- Selected Focus Target Kind: directory');
    expect(content).toContain('- Selected Test Target: {"path":"tests/orders","kind":"directory"}');
    expect(content).toContain('- Selected Support Targets: [{"path":"docs/orders.md","kind":"file"}]');
  });
});
