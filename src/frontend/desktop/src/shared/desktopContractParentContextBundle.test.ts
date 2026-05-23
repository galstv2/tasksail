import { describe, expect, it } from 'vitest';

import type {
  ArchivedParentContextBundle,
  DesktopActionRequest,
  DesktopActionResponse,
} from './desktopContract';
import { DESKTOP_ACTION_NAMES } from './desktopContract';
import { validateDesktopActionRequest } from './desktopContractValidators';

describe('desktop parent context bundle contract', () => {
  it('approves and validates planner.readParentContextBundle requests', () => {
    const request: DesktopActionRequest = {
      action: 'planner.readParentContextBundle',
      payload: {
        parentTaskId: 'TASK-001',
        contextPackDir: '/tmp/context-packs/orders',
        contextPackId: 'orders',
      },
    };

    expect(DESKTOP_ACTION_NAMES).toContain('planner.readParentContextBundle');
    expect(validateDesktopActionRequest(request)).toEqual([]);
  });

  it('rejects missing parent id and non-absolute context pack directory', () => {
    expect(validateDesktopActionRequest({
      action: 'planner.readParentContextBundle',
      payload: {
        parentTaskId: '',
        contextPackDir: 'relative/context-pack',
        contextPackId: '',
      },
    })).toEqual([
      'payload.parentTaskId must be a non-empty string.',
      'payload.contextPackDir must be an absolute path string.',
      'payload.contextPackId must be a non-empty string.',
    ]);
  });

  it('types loaded bundle responses', () => {
    const bundle: ArchivedParentContextBundle = {
      schemaVersion: 1,
      parentTaskId: 'TASK-001',
      rootTaskId: 'ROOT-001',
      parentTaskTitle: 'Parent task',
      archivePath: '/archive/tasks/2026/TASK-001/archive.md',
      archiveArtifactDir: '/archive/tasks/2026/TASK-001',
      status: 'available',
      missing: [],
      files: [{
        kind: 'handoff',
        fileName: 'intake.md',
        relativePath: 'handoffs/intake.md',
        sizeBytes: 12,
        content: 'Parent intake',
        truncated: false,
      }],
      totalBytes: 12,
      truncated: false,
      fallbackSummary: null,
    };
    const response: DesktopActionResponse = {
      action: 'planner.readParentContextBundle',
      mode: 'loaded',
      accepted: true,
      message: 'Loaded.',
      bundle,
    };

    expect(response.action).toBe('planner.readParentContextBundle');
  });
});
