import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createArchivedTask,
  createClient,
  renderPlannerModalHook,
} from './usePlannerModal.testSetup';

describe('usePlannerModal parent archive preview', () => {
  it('forwards the selected parent scope to readParentArchiveMarkdown without changing selection', async () => {
    const parent = createArchivedTask();
    const readParentArchiveMarkdown = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.readParentArchiveMarkdown',
        mode: 'loaded',
        accepted: true,
        message: 'Loaded.',
        taskId: parent.taskId,
        title: parent.title,
        archivePath: parent.archivePath,
        archivedAt: parent.archivedAt,
        content: '# Parent',
        sizeBytes: 8,
      },
    });
    const client = createClient({ readParentArchiveMarkdown });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.parentArchivePreview?.openForTask(parent);
    });

    await waitFor(() => expect(result.current.plannerModalProps.parentArchivePreview?.archive?.content).toBe('# Parent'));
    expect(readParentArchiveMarkdown).toHaveBeenCalledWith({
      parentTaskId: parent.taskId,
      contextPackDir: parent.plannerFocusSnapshot?.contextPackDir,
      contextPackId: parent.plannerFocusSnapshot?.contextPackId,
    });
    expect(result.current.plannerModalProps.selectedParentTask).toBeNull();
  });
});
