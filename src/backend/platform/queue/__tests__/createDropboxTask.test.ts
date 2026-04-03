import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDropboxTask } from '../createDropboxTask.js';

describe('createDropboxTask', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'tq-create-'));
    // Create minimal repo structure with .git dir for findRepoRoot
    mkdirSync(path.join(tmpRoot, '.git'));
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'dropbox'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'pendingitems'), {
      recursive: true,
    });
    mkdirSync(path.join(tmpRoot, 'AgentWorkSpace', 'handoffs'), {
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
    expect(content).toContain('- Task Kind: standard');
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
    expect(content).toContain('- Recommended Execution: sequential');
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

  it('generates a timestamped filename', async () => {
    const outputPath = await createDropboxTask({
      title: 'Timestamped',
      repoRoot: tmpRoot,
    });

    const filename = path.basename(outputPath);
    // Should match pattern: YYYYMMDDTHHMMSSz-slugified-title.md
    expect(filename).toMatch(/^\d{8}T\d{6}Z-timestamped\.md$/);
  });

  it('throws when title is missing', async () => {
    await expect(
      createDropboxTask({ title: '', repoRoot: tmpRoot }),
    ).rejects.toThrow('--title is required');
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
});
