import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../retrospectiveFlag.js', () => ({
  syncRetrospectiveRequiredMetadata: vi.fn().mockResolvedValue(undefined),
}));

import { initializeTask } from '../newTask.js';
import {
  HANDOFF_FILES,
  SLICE_TEMPLATE_FILENAME,
  implementationStepsDirFor,
  implementationStepsTemplatePath,
} from '../paths.js';

describe('initializeTask starter slice generation', () => {
  let repoRoot: string;
  let templatesDir: string;

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
      title: 'Alice Runtime Templates',
      withStarterSlice: true,
      force: true,
    });

    const implementationStepsDir = implementationStepsDirFor(repoRoot);
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
        title: 'Alice Runtime Templates',
        withStarterSlice: true,
        force: true,
      }),
    ).rejects.toThrow('Starter slice blocked by missing pre-slice artifacts.');

    const implementationStepsDir = implementationStepsDirFor(repoRoot);
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
