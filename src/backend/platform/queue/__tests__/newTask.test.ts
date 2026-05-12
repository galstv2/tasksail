import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../retrospectiveFlag.js', () => ({
  stampRetrospectiveRequiredMetadata: vi.fn().mockResolvedValue(undefined),
}));

import { initializeTask, validateTaskId, generateTaskId, TASK_ID_PATTERN } from '../newTask.js';
import {
  HANDOFF_FILES,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsTemplatePath,
} from '../paths.js';

describe('initializeTask starter slice generation', () => {
  let repoRoot: string;
  let templatesDir: string;
  // §4.1B: initializeTask writes per-task artifacts under tasks/<taskId>/
  // Use a fixed taskId so we can locate the per-task ImplementationSteps dir.
  const FIXED_TASK_ID = 'alice-runtime-templates';

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-new-task-'));
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(templatesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('creates starter slices from the canonical slice template', async () => {
    seedTemplates({
      implementationSpecTemplate: '# Implementation Spec\n\n## Problem and Outcome\n\nPlanning is complete.\n',
      sliceTemplate: [
        '# Slice Template',
        '',
        '## Objective',
        '',
        '### Purpose',
        '<!-- describe the objective -->',
        '',
        '## Acceptance and Validation',
        '',
        '### Validation Commands',
        '<!-- add commands -->',
        '',
      ].join('\n'),
    });

    await initializeTask({
      repoRoot,
      taskId: FIXED_TASK_ID,
      withStarterSlice: true,
      force: true,
    });

    // §4.1B: per-task ImplementationSteps path
    const implementationStepsDir = path.join(
      repoRoot, 'AgentWorkSpace', 'tasks', FIXED_TASK_ID, 'ImplementationSteps',
    );
    const starterSlices = readdirSync(implementationStepsDir)
      .filter((entry) => entry.endsWith('.md') && entry !== SLICE_TEMPLATE_FILENAME);

    expect(starterSlices).toHaveLength(1);
    expect(readFileSync(
      path.join(implementationStepsDir, starterSlices[0]!),
      'utf-8',
    )).toBe(readFileSync(
      implementationStepsTemplatePath(implementationStepsDir),
      'utf-8',
    ));
  });

  it('blocks starter slices when implementation-spec.md has no authored content', async () => {
    seedTemplates({
      implementationSpecTemplate: [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '',
        '- Task ID:',
        '',
        '## Problem and Outcome',
        '',
        '<!-- fill this in later -->',
        '',
      ].join('\n'),
      sliceTemplate: '# Slice Template\n\n## Objective\n',
    });

    await expect(
      initializeTask({
        repoRoot,
        taskId: FIXED_TASK_ID,
        withStarterSlice: true,
        force: true,
      }),
    ).rejects.toThrow('Starter slice blocked by missing pre-slice artifacts.');

    // §4.1B: per-task ImplementationSteps path
    const implementationStepsDir = path.join(
      repoRoot, 'AgentWorkSpace', 'tasks', FIXED_TASK_ID, 'ImplementationSteps',
    );
    const markdownFiles = readdirSync(implementationStepsDir)
      .filter((entry) => entry.endsWith('.md'));

    expect(markdownFiles).toEqual([SLICE_TEMPLATE_FILENAME]);
  });

  function seedTemplates(options: {
    implementationSpecTemplate: string;
    sliceTemplate: string;
  }): void {
    for (const filename of HANDOFF_FILES) {
      const template = filename === 'implementation-spec.md'
        ? options.implementationSpecTemplate
        : `# ${filename}\n<!-- placeholder -->\n`;
      writeFileSync(path.join(templatesDir, filename), template);
    }

    writeFileSync(
      path.join(templatesDir, SLICE_TEMPLATE_FILENAME),
      options.sliceTemplate,
    );
  }
});

// ── §4.5 — validateTaskId / generateTaskId / per-task handoffs path ──────────

describe('validateTaskId — MG-10 shape constraints', () => {
  it('accepts valid taskIds', () => {
    expect(() => validateTaskId('t1')).not.toThrow();
    expect(() => validateTaskId('task-abc_123')).not.toThrow();
    expect(() => validateTaskId('ab')).not.toThrow();
    expect(() => validateTaskId('task-20240101t120000z')).not.toThrow();
  });

  it('rejects taskId with a dot — sentinel filename ambiguity', () => {
    expect(() => validateTaskId('bad.id')).toThrowError(
      expect.objectContaining({ code: 'invalid-task-id-shape' }),
    );
    const err = (() => { try { validateTaskId('bad.id'); } catch (e) { return e; } })() as { reason: string };
    expect(err.reason).toContain('dot not allowed');
  });

  it('rejects taskId with uppercase letters', () => {
    const err = (() => { try { validateTaskId('Bad-Id'); } catch (e) { return e; } })() as { code: string; reason: string };
    expect(err.code).toBe('invalid-task-id-shape');
    expect(err.reason).toContain('uppercase');
  });

  it('rejects taskId with leading hyphen', () => {
    const err = (() => { try { validateTaskId('-leading-dash'); } catch (e) { return e; } })() as { code: string; reason: string };
    expect(err.code).toBe('invalid-task-id-shape');
    expect(err.reason).toContain('must not start');
  });

  it('rejects taskId with trailing hyphen', () => {
    const err = (() => { try { validateTaskId('trailing-'); } catch (e) { return e; } })() as { code: string; reason: string };
    expect(err.code).toBe('invalid-task-id-shape');
    expect(err.reason).toContain('must not end');
  });

  it('rejects single-character taskId (too short)', () => {
    const err = (() => { try { validateTaskId('a'); } catch (e) { return e; } })() as { code: string };
    expect(err.code).toBe('invalid-task-id-shape');
  });
});

describe('generateTaskId — slug normalization', () => {
  it('generates a slug that passes TASK_ID_PATTERN', () => {
    const id = generateTaskId('My Feature Title');
    expect(TASK_ID_PATTERN.test(id)).toBe(true);
  });

  it('normalizes uppercase letters in the title', () => {
    const id = generateTaskId('ALL CAPS TITLE');
    expect(TASK_ID_PATTERN.test(id)).toBe(true);
    // No uppercase in output
    expect(/[A-Z]/.test(id)).toBe(false);
  });

  it('normalizes dots in the title (dot not allowed in taskId)', () => {
    const id = generateTaskId('v1.2.3 Release');
    expect(/\./.test(id)).toBe(false);
    expect(TASK_ID_PATTERN.test(id)).toBe(true);
  });

  it('produces output of length between 2 and 64 chars', () => {
    const id = generateTaskId('Short');
    expect(id.length).toBeGreaterThanOrEqual(2);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('output does not start or end with hyphen or underscore', () => {
    const id = generateTaskId('---starts-and-ends-weird---');
    expect(/^[-_]/.test(id)).toBe(false);
    expect(/[-_]$/.test(id)).toBe(false);
    expect(TASK_ID_PATTERN.test(id)).toBe(true);
  });
});

describe('initializeTask §4.1B — writes under tasks/<taskId>/handoffs/', () => {
  let repoRoot: string;
  let templatesDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-newtask-mg10-'));
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(templatesDir, { recursive: true });

    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n<!-- placeholder -->\n`);
    }
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('when no taskId given, writes handoffs under tasks/<generatedId>/handoffs/', async () => {
    await initializeTask({ repoRoot, title: 'MG10 Test Task', force: true });

    const tasksDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks');
    expect(existsSync(tasksDir)).toBe(true);

    const taskDirs = readdirSync(tasksDir);
    expect(taskDirs).toHaveLength(1);

    const taskId = taskDirs[0]!;
    expect(TASK_ID_PATTERN.test(taskId)).toBe(true);

    const handoffsDir = path.join(tasksDir, taskId, 'handoffs');
    expect(existsSync(handoffsDir)).toBe(true);
  });

  it('when explicit taskId given, writes under tasks/<taskId>/handoffs/', async () => {
    await initializeTask({ repoRoot, taskId: 'my-explicit-task', force: true });

    const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'my-explicit-task', 'handoffs');
    expect(existsSync(handoffsDir)).toBe(true);
  });

  it('rejects an invalid explicit taskId before touching the filesystem', async () => {
    await expect(
      initializeTask({ repoRoot, taskId: 'Invalid.Task', force: true }),
    ).rejects.toMatchObject({ code: 'invalid-task-id-shape' });
  });
});

// ── Core Metadata + Task Lineage label injection during template stamping ──
//
// `stampHandoffTemplate` populates `- LABEL:` lines from the template using
// `injectLabelValues`, which skips empty values. Both flows that initialize
// handoff artifacts must therefore supply the lineage record explicitly —
// otherwise the Task Lineage labels (notably `Task Kind`) stay blank.

describe('initializeTask — stamps Core Metadata and Task Lineage labels', () => {
  let repoRoot: string;
  let templatesDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-newtask-lineage-'));
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(templatesDir, { recursive: true });

    const labeledTemplate = [
      '# implementation-spec.md',
      '',
      '### Core Metadata',
      '',
      '- Task ID:',
      '- Task Title:',
      '- Initialized At (UTC):',
      '- Active Branch:',
      '- Intake Source:',
      '',
      '### Task Lineage',
      '',
      '- Task Kind:',
      '- Parent Task ID:',
      '- Root Task ID:',
      '- Parent QMD Record ID:',
      '- Parent QMD Scope:',
      '- Follow-Up Reason:',
      '',
    ].join('\n');

    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), labeledTemplate);
    }
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('populates Core Metadata and defaults Task Kind to "standard"', async () => {
    await initializeTask({
      repoRoot,
      taskId: 'lineage-stamp',
      title: 'Lineage Stamp',
      force: true,
    });

    const stamped = readFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'lineage-stamp', 'handoffs', 'implementation-spec.md'),
      'utf-8',
    );

    expect(stamped).toContain('- Task ID: lineage-stamp');
    expect(stamped).toContain('- Task Title: Lineage Stamp');
    expect(stamped).toMatch(/- Initialized At \(UTC\): \d{4}-\d{2}-\d{2}T/);
    expect(stamped).toContain('- Active Branch: unknown');
    expect(stamped).toContain('- Task Kind: standard');
    // Manual init has no parent/QMD context, so those labels stay blank
    // (the pending-item activation flow is the path that populates them).
    expect(stamped).toContain('- Parent Task ID:\n');
    expect(stamped).toContain('- Root Task ID:\n');
  });
});
