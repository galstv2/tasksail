import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../createDropboxTask.js', () => ({
  createDropboxTask: vi.fn().mockResolvedValue('/tmp/dropbox/task.md'),
}));

vi.mock('../../core/index.js', () => ({
  findRepoRoot: vi.fn().mockReturnValue('/resolved/repo/root'),
}));

const { createFollowupTask } = await import('../createFollowupTask.js');
const { assertPolicyPasses } = await import('../policyValidation.js');
const { createDropboxTask } = await import('../createDropboxTask.js');
const { findRepoRoot } = await import('../../core/index.js');

const PMSE_OPTIONS = {
  title: 'Follow-up task',
  parentTaskId: 'TASK-001',
  parentQmdScope: 'qmd/context-packs/test-pack',
  followupReason: 'Continuing from parent task',
  carryForwardSummary: 'Parent completed auth module',
};

describe('createFollowupTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPolicyPasses).mockResolvedValue(undefined);
    vi.mocked(createDropboxTask).mockResolvedValue('/tmp/dropbox/task.md');
    vi.mocked(findRepoRoot).mockReturnValue('/resolved/repo/root');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls assertPolicyPasses with pre-closeout mode before creating task', async () => {
    await createFollowupTask({ ...PMSE_OPTIONS, repoRoot: '/explicit/root' });

    expect(assertPolicyPasses).toHaveBeenCalledWith({
      mode: 'pre-closeout',
      repoRoot: '/explicit/root',
      taskId: 'TASK-001',
      errorMessage: 'Follow-up creation blocked by closeout policy validation.',
    });
    expect(createDropboxTask).toHaveBeenCalled();
  });

  it('uses findRepoRoot when repoRoot is not provided', async () => {
    await createFollowupTask(PMSE_OPTIONS);

    expect(findRepoRoot).toHaveBeenCalled();
    expect(assertPolicyPasses).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'pre-closeout',
        repoRoot: '/resolved/repo/root',
        taskId: 'TASK-001',
      }),
    );
  });

  it('does not fall pmck to process.cwd when repoRoot is omitted', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd');
    await createFollowupTask(PMSE_OPTIONS);

    // findRepoRoot should be used, not process.cwd
    expect(findRepoRoot).toHaveBeenCalled();
    expect(cwdSpy).not.toHaveBeenCalled();
    cwdSpy.mockRestore();
  });

  it('skips policy validation when force is true', async () => {
    await createFollowupTask({ ...PMSE_OPTIONS, force: true });

    expect(assertPolicyPasses).not.toHaveBeenCalled();
    expect(createDropboxTask).toHaveBeenCalled();
  });

  it('throws when policy validation fails', async () => {
    vi.mocked(assertPolicyPasses).mockRejectedValueOnce(
      new Error('Follow-up creation blocked by closeout policy validation.\nViolation details'),
    );

    await expect(
      createFollowupTask(PMSE_OPTIONS),
    ).rejects.toThrow('Follow-up creation blocked by closeout policy validation.');

    expect(createDropboxTask).not.toHaveBeenCalled();
  });

  it('passes child-task kind to createDropboxTask', async () => {
    await createFollowupTask(PMSE_OPTIONS);

    expect(createDropboxTask).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'child-task' }),
    );
  });

  it('uses parentTaskId as rootTaskId when rootTaskId is not provided', async () => {
    await createFollowupTask(PMSE_OPTIONS);

    expect(createDropboxTask).toHaveBeenCalledWith(
      expect.objectContaining({ rootTaskId: 'TASK-001' }),
    );
  });

  it('uses explicit rootTaskId when provided', async () => {
    await createFollowupTask({ ...PMSE_OPTIONS, rootTaskId: 'ROOT-999' });

    expect(createDropboxTask).toHaveBeenCalledWith(
      expect.objectContaining({ rootTaskId: 'ROOT-999' }),
    );
  });

  it('throws when required fields are missing', async () => {
    await expect(
      createFollowupTask({ ...PMSE_OPTIONS, title: '' }),
    ).rejects.toThrow('--title is required');

    await expect(
      createFollowupTask({ ...PMSE_OPTIONS, parentTaskId: '' }),
    ).rejects.toThrow('--parent-task-id is required');

    await expect(
      createFollowupTask({ ...PMSE_OPTIONS, parentQmdScope: '' }),
    ).rejects.toThrow('--parent-qmd-scope is required');

    await expect(
      createFollowupTask({ ...PMSE_OPTIONS, followupReason: '' }),
    ).rejects.toThrow('--followup-reason is required');
  });

  it('forwards Deep Focus metadata to the dropbox task creator', async () => {
    await createFollowupTask({
      ...PMSE_OPTIONS,
      primaryRepoId: 'platform',
      primaryFocusId: 'api',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    }));
  });

  it('forwards standard-mode primary binding metadata to the dropbox task creator', async () => {
    await createFollowupTask({
      ...PMSE_OPTIONS,
      primaryRepoId: 'platform',
      primaryFocusId: 'api',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: ['api'],
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      primaryRepoId: 'platform',
      primaryFocusId: 'api',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: ['api'],
    }));
  });
});
