import { describe, expect, it } from 'vitest';

import { DESKTOP_ACTION_NAMES } from './desktopContract';
import { validateDesktopActionRequest } from './desktopContractValidators';
import type { PlannerReadParentArchiveMarkdownResponse } from './desktopContractPlanner';

describe('planner.readParentArchiveMarkdown contract', () => {
  it('registers and validates the action request', () => {
    expect(DESKTOP_ACTION_NAMES).toContain('planner.readParentArchiveMarkdown');
    expect(validateDesktopActionRequest({
      action: 'planner.readParentArchiveMarkdown',
      payload: {
        parentTaskId: 'parent-1',
        contextPackDir: '/packs/test',
        contextPackId: 'test',
      },
    })).toEqual([]);
  });

  it('rejects invalid payloads', () => {
    expect(validateDesktopActionRequest({
      action: 'planner.readParentArchiveMarkdown',
      payload: {
        parentTaskId: '',
        contextPackDir: 'relative',
        contextPackId: '',
      },
    })).toEqual([
      'payload.parentTaskId must be a non-empty string.',
      'payload.contextPackDir must be an absolute path string.',
      'payload.contextPackId must be a non-empty string.',
    ]);
  });

  it('supports the loaded response shape', () => {
    const response: PlannerReadParentArchiveMarkdownResponse = {
      action: 'planner.readParentArchiveMarkdown',
      mode: 'loaded',
      accepted: true,
      message: 'Parent archive markdown loaded.',
      taskId: 'parent-1',
      title: 'Parent',
      archivePath: '/packs/test/archive/tasks/2026/parent-1/archive.md',
      archivedAt: null,
      content: '# Parent',
      sizeBytes: 8,
    };
    expect(response.content).toBe('# Parent');
  });
});
