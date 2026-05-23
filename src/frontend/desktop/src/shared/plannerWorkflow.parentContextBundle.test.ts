import { describe, expect, it } from 'vitest';

import type { ArchivedParentContextBundle } from './desktopContractPlanner';
import { buildChildTaskStarterPrompt } from './plannerWorkflow';

function bundle(overrides: Partial<ArchivedParentContextBundle> = {}): ArchivedParentContextBundle {
  return {
    schemaVersion: 1,
    parentTaskId: 'TASK-002',
    rootTaskId: 'TASK-001',
    parentTaskTitle: 'Selected child parent',
    archivePath: '/archive/TASK-002/archive.md',
    archiveArtifactDir: '/archive/TASK-002',
    status: 'available',
    missing: [],
    files: [],
    totalBytes: 0,
    truncated: false,
    fallbackSummary: null,
    ...overrides,
  };
}

describe('buildChildTaskStarterPrompt parent context bundle', () => {
  it('renders bundle files in order with read-only metadata warning', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-002',
      parentTaskTitle: 'Selected child parent',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'pack',
      parentContextBundle: bundle({
        files: [
          {
            kind: 'handoff',
            fileName: 'intake.md',
            relativePath: 'handoffs/intake.md',
            sizeBytes: 6,
            content: 'intake\n\n',
            truncated: false,
          },
          {
            kind: 'implementation-step',
            fileName: '001-plan.md',
            relativePath: 'ImplementationSteps/001-plan.md',
            sizeBytes: 4,
            content: 'step',
            truncated: false,
          },
        ],
      }),
    });

    expect(prompt).toContain('Immediate Parent Context Bundle');
    expect(prompt.indexOf('handoffs/intake.md')).toBeLessThan(prompt.indexOf('ImplementationSteps/001-plan.md'));
    expect(prompt).toContain('--- BEGIN IMMEDIATE PARENT CONTEXT FILE: handoffs/intake.md ---\nintake\n--- END');
    expect(prompt).not.toContain('professional-task.md');
    expect(prompt).toContain('Do NOT change Task Lineage, Context Pack Binding, Branch Chain, or Source metadata.');
  });

  it('renders truncation and artifact status notes', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-002',
      parentTaskTitle: 'Selected child parent',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'pack',
      parentContextBundle: bundle({
        status: 'missing-artifacts',
        truncated: true,
        files: [{
          kind: 'handoff',
          fileName: 'intake.md',
          relativePath: 'handoffs/intake.md',
          sizeBytes: 100000,
          content: 'partial',
          truncated: true,
        }],
      }),
    });

    expect(prompt).toContain('nested archive artifacts are missing');
    expect(prompt).toContain('truncated by the platform prompt-size guard');
  });

  it('falls back to summary content for legacy flat archives', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-002',
      parentTaskTitle: 'Selected child parent',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'pack',
      parentContextBundle: bundle({
        status: 'legacy-flat-archive',
        archiveArtifactDir: null,
        fallbackSummary: {
          taskSummary: 'Legacy summary',
          keyDecisions: ['Keep the existing flow'],
        },
      }),
    });

    expect(prompt).toContain('legacy flat archive');
    expect(prompt).toContain('Parent archive task summary:\nLegacy summary');
    expect(prompt).toContain('- Keep the existing flow');
  });
});
