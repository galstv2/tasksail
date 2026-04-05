import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acquireDirLock,
  moveDropboxItemsOnce,
  queueNameForSource,
  activateNextPendingItemIfReady,
} from '../operations.js';
import { resetHandoffArtifacts } from '../lifecycle.js';
import {
  HANDOFF_FILES,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsTemplatePath,
} from '../paths.js';

describe('acquireDirLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('acquires a lock and returns a release function', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    const release = await acquireDirLock(lockDir, 3, 10);

    expect(release).not.toBeNull();
    expect(existsSync(lockDir)).toBe(true);

    await release!();
    expect(existsSync(lockDir)).toBe(false);
  });

  it('fails to acquire when lock is already held', async () => {
    const lockDir = path.join(tmpDir, '.test-lock.d');
    mkdirSync(lockDir);

    const release = await acquireDirLock(lockDir, 2, 10);
    expect(release).toBeNull();

    // Clean up
    rmSync(lockDir, { recursive: true });
  });
});

describe('moveDropboxItemsOnce', () => {
  let tmpDir: string;
  let dropboxDir: string;
  let pendingDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-move-'));
    dropboxDir = path.join(tmpDir, 'dropbox');
    pendingDir = path.join(tmpDir, 'pending');
    mkdirSync(dropboxDir);
    mkdirSync(pendingDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves .md files from dropbox to pending', async () => {
    writeFileSync(path.join(dropboxDir, 'task-a.md'), '# Task A');
    writeFileSync(path.join(dropboxDir, 'task-b.md'), '# Task B');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(2);

    const pendingFiles = readdirSync(pendingDir);
    expect(pendingFiles.length).toBe(2);
    expect(pendingFiles.every((f) => f.endsWith('.md'))).toBe(true);

    // Source files should be gone
    expect(readdirSync(dropboxDir).length).toBe(0);
  });

  it('ignores non-markdown files', async () => {
    writeFileSync(path.join(dropboxDir, 'task.md'), '# Task');
    writeFileSync(path.join(dropboxDir, 'image.png'), 'binary');

    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);

    expect(count).toBe(1);
    // The .png file should still be in dropbox
    expect(existsSync(path.join(dropboxDir, 'image.png'))).toBe(true);
  });

  it('returns 0 when dropbox is empty', async () => {
    const count = await moveDropboxItemsOnce(dropboxDir, pendingDir);
    expect(count).toBe(0);
  });
});

describe('queueNameForSource', () => {
  it('generates a timestamped name with the original filename', () => {
    const name = queueNameForSource('/some/path/my-task.md');
    // Should match: YYYYMMDDTHHMMSSz-my-task.md
    expect(name).toMatch(/^\d{8}T\d{6}Z-my-task\.md$/);
  });

  it('preserves the basename of the source file', () => {
    const name = queueNameForSource('/deep/nested/path/special-file.md');
    expect(name).toContain('special-file.md');
  });
});

describe('activateNextPendingItemIfReady', () => {
  let tmpDir: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-activate-lock-'));
    pendingDir = path.join(tmpDir, 'pending');
    handoffsDir = path.join(tmpDir, 'handoffs');
    templatesDir = path.join(tmpDir, 'templates');
    mkdirSync(pendingDir);
    mkdirSync(handoffsDir);
    mkdirSync(templatesDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('activates a pending item when no failure lock is present (lock system removed)', async () => {
    writeFileSync(path.join(pendingDir, 'task-003.md'), '# Task');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, 'slice-template.md'), '# slice\n');

    const activated = await activateNextPendingItemIfReady(
      pendingDir,
      handoffsDir,
      templatesDir,
    );

    expect(activated).toBe(true);
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(true);
  });

  it('seeds handoffs and ImplementationSteps templates when activating a pending item', async () => {
    writeFileSync(path.join(pendingDir, 'task-004.md'), '# Add search\n');
    for (const filename of HANDOFF_FILES) {
      const template = filename === 'retrospective-input.md'
        ? '# retrospective-input.md\n\n## Task Metadata\n\n- Task ID:\n- Retrospective Required:\n'
        : filename === 'professional-task.md'
          ? '# Professional Task\n\n## Task Metadata\n\n- Task ID:\n- Task Title:\n- Initialized At (UTC):\n- Active Branch:\n- Intake Source:\n\n## Raw Request\n'
          : `# ${filename}\n\n- Task ID:\n`;
      writeFileSync(path.join(templatesDir, filename), template);
    }
    writeFileSync(
      path.join(templatesDir, SLICE_TEMPLATE_FILENAME),
      '# Slice Template\n\n## Objective\n\n### Purpose\n',
    );

    const activated = await activateNextPendingItemIfReady(
      pendingDir,
      handoffsDir,
      templatesDir,
    );

    expect(activated).toBe(true);
    expect(existsSync(path.join(pendingDir, '.active-item'))).toBe(true);
    expect(existsSync(path.join(handoffsDir, 'professional-task.md'))).toBe(true);
    const copiedSliceTemplatePath = implementationStepsTemplatePath(
      path.join(tmpDir, 'ImplementationSteps'),
    );
    expect(existsSync(copiedSliceTemplatePath)).toBe(true);
    expect(readFileSync(copiedSliceTemplatePath, 'utf-8')).toBe(
      '# Slice Template\n\n## Objective\n\n### Purpose\n',
    );
    const retrospective = readdirSync(handoffsDir).includes('retrospective-input.md')
      ? readFileSync(path.join(handoffsDir, 'retrospective-input.md'), 'utf-8')
      : '';
    expect(retrospective).toContain('- Retrospective Required: false');
    const professionalTask = readFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      'utf-8',
    );
    expect(professionalTask).toContain('- Task ID: task-004');
    expect(professionalTask).toContain('- Task Title: Add search');
    expect(professionalTask).toContain('- Intake Source: AgentWorkSpace/pendingitems/task-004.md');
    expect(professionalTask).not.toContain('## Raw Request\n\n# Add search');
  });

  it('clears prior runtime receipts only after the next task activates successfully', async () => {
    const repoRoot = path.join(tmpDir, 'repo');
    const repoPendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    const repoHandoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    const repoTemplatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    const runtimeDir = path.join(repoRoot, '.platform-state', 'runtime');
    const roleSessionsDir = path.join(runtimeDir, 'role-sessions');
    const guardrailsDir = path.join(runtimeDir, 'guardrails');
    mkdirSync(repoPendingDir, { recursive: true });
    mkdirSync(repoHandoffsDir, { recursive: true });
    mkdirSync(repoTemplatesDir, { recursive: true });
    mkdirSync(roleSessionsDir, { recursive: true });
    mkdirSync(guardrailsDir, { recursive: true });

    writeFileSync(path.join(roleSessionsDir, 'dalton.json'), '{"status":"failed"}\n');
    writeFileSync(path.join(guardrailsDir, 'dalton.json'), '{"status":"failed"}\n');
    writeFileSync(path.join(runtimeDir, 'pipeline-receipt.json'), '{"status":"failed"}\n');

    writeFileSync(path.join(repoPendingDir, 'task-005.md'), '# Add audit trail\n');
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(repoTemplatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(repoTemplatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const activated = await activateNextPendingItemIfReady(
      repoPendingDir,
      repoHandoffsDir,
      repoTemplatesDir,
    );

    expect(activated).toBe(true);
    expect(readdirSync(roleSessionsDir).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(readdirSync(guardrailsDir).filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(existsSync(path.join(runtimeDir, 'pipeline-receipt.json'))).toBe(false);
    expect(existsSync(path.join(runtimeDir, 'last-reset-ts'))).toBe(true);
  });
});

describe('resetHandoffArtifacts runtime receipt retention', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-reset-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves runtime receipts until a new task activates', async () => {
    const handoffsDir = path.join(tmpDir, 'AgentWorkSpace', 'handoffs');
    const runtimeDir = path.join(tmpDir, '.platform-state', 'runtime');
    const roleSessionsDir = path.join(runtimeDir, 'role-sessions');
    const implStepsDir = path.join(tmpDir, 'AgentWorkSpace', 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(roleSessionsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });

    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '# task\n');
    writeFileSync(path.join(implStepsDir, SLICE_TEMPLATE_FILENAME), '# slice\n');
    writeFileSync(path.join(roleSessionsDir, 'dalton.json'), '{"status":"failed"}\n');

    await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, {
      implementationStepsDir: implStepsDir,
    });

    expect(existsSync(path.join(roleSessionsDir, 'dalton.json'))).toBe(true);
  });
});
