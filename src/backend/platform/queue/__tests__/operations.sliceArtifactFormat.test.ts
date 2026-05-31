/**
 * Slice artifact format freezing tests for activateNextPendingItemIfReady.
 *
 * Covers Track A spec requirements:
 *   - Platform config absent (file-not-found) => sidecar.sliceArtifactFormat = 'markdown'
 *   - Platform config declares markdown => sidecar.sliceArtifactFormat = 'markdown'
 *   - Platform config declares xml => sidecar.sliceArtifactFormat = 'xml'
 *   - Invalid slice_artifact_format in platform config => activation fails before Alice launch
 *   - Changing platform config after activation does not change the frozen task format
 *
 * Also covers Track B spec requirements:
 *   - Activation passes frozen sliceArtifactFormat into lifecycle template staging
 *   - XML mode stages slice-template.xml; markdown mode stages slice-template.md
 *   - parallel-ok.md template no longer hardcodes ImplementationSteps/<sliceId>.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activateNextPendingItemIfReady } from '../operations.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';
import { readTaskJson } from '../taskJson.js';
import { listActivePipelines, stopPipeline } from '../../agent-runner/pipelineSupervisor.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from '../../platform-config/types.js';

async function stopPipelinesStartedByTest(): Promise<void> {
  await Promise.all(
    listActivePipelines().map(({ taskId }) => stopPipeline(taskId, 1000)),
  );
}

function seedTemplates(templatesDir: string): void {
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');
  // Also seed xml template so xml-mode activation can stage it
  writeFileSync(path.join(templatesDir, 'slice-template.xml'), '<?xml version="1.0"?><executionSlice/>\n');
}

function writePlatformConfig(repoRoot: string, overrides: Record<string, unknown> = {}): void {
  const stateDir = path.join(repoRoot, '.platform-state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, 'platform.json'),
    JSON.stringify({
      schema_version: CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
      container_runtime: 'podman',
      ...overrides,
    }, null, 2) + '\n',
    'utf-8',
  );
}

describe('slice artifact format freezing at activation', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-slice-format-'));
    const queuePaths = resolveQueuePaths(repoRoot);
    mkdirSync(queuePaths.pendingDir, { recursive: true });
    mkdirSync(queuePaths.templatesDir, { recursive: true });
    seedTemplates(queuePaths.templatesDir);
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  function seedPendingItem(taskId: string): void {
    const queuePaths = resolveQueuePaths(repoRoot);
    writeFileSync(path.join(queuePaths.pendingDir, `${taskId}.md`), `# Task ${taskId}\n`);
  }

  it('writes sliceArtifactFormat=markdown when platform config is absent (file-not-found)', async () => {
    // No .platform-state/platform.json
    const taskId = 'format-absent-config';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const sidecar = readTaskJson(taskId, repoRoot);
    expect(sidecar.sliceArtifactFormat).toBe('markdown');
  });

  it('writes sliceArtifactFormat=markdown when platform config declares markdown', async () => {
    writePlatformConfig(repoRoot, { slice_artifact_format: 'markdown' });
    const taskId = 'format-markdown-config';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const sidecar = readTaskJson(taskId, repoRoot);
    expect(sidecar.sliceArtifactFormat).toBe('markdown');
  });

  it('writes sliceArtifactFormat=xml when platform config declares xml', async () => {
    writePlatformConfig(repoRoot, { slice_artifact_format: 'xml' });
    const taskId = 'format-xml-config';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const sidecar = readTaskJson(taskId, repoRoot);
    expect(sidecar.sliceArtifactFormat).toBe('xml');
  });

  it('activation fails when platform config has invalid slice_artifact_format', async () => {
    // Write a syntactically valid config file with an invalid slice_artifact_format value.
    // loadPlatformConfig will return valid=false with a field-named error (not file-missing),
    // so activation must throw rather than default to markdown.
    writePlatformConfig(repoRoot, { slice_artifact_format: 'toml' });
    const taskId = 'format-invalid-config';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    await expect(
      activateNextPendingItemIfReady({ paths: queuePaths, repoRoot }),
    ).rejects.toThrow(/Invalid platform config/);
  });

  it('frozen format is immutable after activation even if platform config changes', async () => {
    // Activate with xml, then change config to markdown; the sidecar must still say xml.
    writePlatformConfig(repoRoot, { slice_artifact_format: 'xml' });
    const taskId = 'format-frozen';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    // Change platform config to markdown
    writePlatformConfig(repoRoot, { slice_artifact_format: 'markdown' });

    // Re-read the sidecar: must still be xml (frozen at activation time)
    const raw = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    expect(raw['sliceArtifactFormat']).toBe('xml');

    const sidecar = readTaskJson(taskId, repoRoot);
    expect(sidecar.sliceArtifactFormat).toBe('xml');
  });

  it('writes sliceArtifactFormat=markdown when platform config is absent (no .platform-state dir)', async () => {
    // Ensure no .platform-state directory exists at all
    const taskId = 'format-no-state-dir';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const sidecar = readTaskJson(taskId, repoRoot);
    expect(sidecar.sliceArtifactFormat).toBe('markdown');
  });
});

// ---------------------------------------------------------------------------
// Track B: activation threads frozen format into lifecycle template staging
// ---------------------------------------------------------------------------

describe('slice template staging during activation (Track B)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-staging-'));
    const queuePaths = resolveQueuePaths(repoRoot);
    mkdirSync(queuePaths.pendingDir, { recursive: true });
    mkdirSync(queuePaths.templatesDir, { recursive: true });
    seedTemplates(queuePaths.templatesDir);
  });

  afterEach(async () => {
    await stopPipelinesStartedByTest();
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  function seedPendingItem(taskId: string): void {
    const queuePaths = resolveQueuePaths(repoRoot);
    writeFileSync(path.join(queuePaths.pendingDir, `${taskId}.md`), `# Task ${taskId}\n`);
  }

  it('markdown activation stages slice-template.md and not slice-template.xml', async () => {
    writePlatformConfig(repoRoot, { slice_artifact_format: 'markdown' });
    const taskId = 'staging-md';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const implStepsDir = queuePaths.taskImplementationSteps(taskId);
    expect(existsSync(path.join(implStepsDir, 'slice-template.md'))).toBe(true);
    expect(existsSync(path.join(implStepsDir, 'slice-template.xml'))).toBe(false);
  });

  it('xml activation stages slice-template.xml and not slice-template.md', async () => {
    writePlatformConfig(repoRoot, { slice_artifact_format: 'xml' });
    const taskId = 'staging-xml';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const implStepsDir = queuePaths.taskImplementationSteps(taskId);
    expect(existsSync(path.join(implStepsDir, 'slice-template.xml'))).toBe(true);
    expect(existsSync(path.join(implStepsDir, 'slice-template.md'))).toBe(false);
  });

  it('absent platform config defaults to staging slice-template.md', async () => {
    // No .platform-state/platform.json
    const taskId = 'staging-absent';
    seedPendingItem(taskId);
    const queuePaths = resolveQueuePaths(repoRoot);

    const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
    expect(result.activated).toBe(true);

    const implStepsDir = queuePaths.taskImplementationSteps(taskId);
    expect(existsSync(path.join(implStepsDir, 'slice-template.md'))).toBe(true);
    expect(existsSync(path.join(implStepsDir, 'slice-template.xml'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Track B: parallel-ok.md template no longer hardcodes .md extension
// ---------------------------------------------------------------------------

describe('parallel-ok.md template slice reference comment', () => {
  it('does not hardcode ImplementationSteps/<sliceId>.md in the seeded comment', async () => {
    // The spec requires the Independent Slices comment to use format-neutral wording.
    // This scan mirrors the structuralScans.parallel-ok-template-active-format-comment check.
    const templatePath = path.join(
      process.cwd(),
      'AgentWorkSpace', 'templates', 'parallel-ok.md',
    );
    const content = await readFile(templatePath, 'utf-8');

    expect(content).not.toMatch(/ImplementationSteps\/<sliceId>\.md/);
    expect(content).not.toMatch(/slice-N\.md/);
    expect(content).not.toMatch(/slice-\*\.md/);
    // The section must still exist (markdown-only, not removed)
    expect(content).toContain('## Independent Slices');
  });
});
