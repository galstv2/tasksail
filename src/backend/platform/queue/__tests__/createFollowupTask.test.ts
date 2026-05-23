import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../createDropboxTask.js', () => ({
  createDropboxTask: vi.fn().mockResolvedValue('/tmp/dropbox/task.md'),
}));
vi.mock('../childTaskChainPlanning.js', () => ({
  recordPlannedChildTask: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
}));
vi.mock('../taskRegistry.js', () => ({
  removeTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/index.js', () => ({
  findRepoRoot: vi.fn().mockReturnValue('/resolved/repo/root'),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

const { createFollowupTask } = await import('../createFollowupTask.js');
const { assertPolicyPasses } = await import('../policyValidation.js');
const { createDropboxTask } = await import('../createDropboxTask.js');
const { recordPlannedChildTask } = await import('../childTaskChainPlanning.js');
const { removeTask } = await import('../taskRegistry.js');
const { findRepoRoot } = await import('../../core/index.js');

const PMSE_OPTIONS = {
  title: 'Follow-up task',
  parentTaskId: 'TASK-001',
  parentQmdScope: 'qmd/context-packs/test-pack',
  followupReason: 'Continuing from parent task',
  carryForwardSummary: 'Parent completed auth module',
};

const cleanupRoots: string[] = [];

function branchChain(overrides: Partial<{
  rootTaskId: string;
  parentTaskId: string;
}> = {}) {
  return {
    schemaVersion: 1 as const,
    mode: 'continuation' as const,
    rootTaskId: overrides.rootTaskId ?? 'TASK-001',
    parentTaskId: overrides.parentTaskId ?? 'TASK-001',
    depth: 1,
    repos: [{
      repoRoot: '/repo',
      repoLabel: 'Repo',
      chainSourceBranch: 'parent',
      parentSourceBranch: 'parent',
      parentBranchHead: 'abc',
      targetBranch: null,
    }],
  };
}

function childExecutionScope() {
  return {
    contextPackDir: '/packs/test',
    contextPackId: 'test',
    scopeMode: 'repo-selection',
    primaryRepoId: 'repo',
    primaryFocusId: null,
    selectedRepoIds: ['repo'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  };
}

describe('createFollowupTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPolicyPasses).mockResolvedValue(undefined);
    vi.mocked(createDropboxTask).mockResolvedValue('/tmp/dropbox/task.md');
    vi.mocked(recordPlannedChildTask).mockResolvedValue({ schemaVersion: 1 } as never);
    vi.mocked(removeTask).mockResolvedValue(undefined);
    vi.mocked(findRepoRoot).mockReturnValue('/resolved/repo/root');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of cleanupRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
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

  it('does not fall back to process.cwd when repoRoot is omitted', async () => {
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

  it('forwards requirement sections to createDropboxTask', async () => {
    await createFollowupTask({
      ...PMSE_OPTIONS,
      criticalRequirements: '- CR-001: Preserve parent behavior.',
      compatibilityRequirements: '- COMP-001: Keep archive lookup compatible.',
      requiredValidation: '- VAL-001: $ pnpm run lint',
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      criticalRequirements: '- CR-001: Preserve parent behavior.',
      compatibilityRequirements: '- COMP-001: Keep archive lookup compatible.',
      requiredValidation: '- VAL-001: $ pnpm run lint',
    }));
  });

  it('forwards standard selection roles to createDropboxTask', async () => {
    await createFollowupTask({
      ...PMSE_OPTIONS,
      selectedRepoIds: ['platform', 'tools'],
      repositoryTypes: { platform: 'primary', tools: 'primary' },
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      repositoryTypes: { platform: 'primary', tools: 'primary' },
    }));
  });

  it('defaults omitted requirement sections to exact None', async () => {
    await createFollowupTask(PMSE_OPTIONS);

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
    }));
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
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: 'api',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: 'api',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    }));
  });

  it('forwards branchChain and records planned child state', async () => {
    const chain = branchChain();
    const scope = childExecutionScope();

    await createFollowupTask({
      ...PMSE_OPTIONS,
      repoRoot: '/tmp',
      branchChain: chain,
      childExecutionScope: scope,
      parentContextSnapshot: scope,
      parentArchivePath: '/archive/parent.md',
      parentArchiveArtifactDir: '/archive/parent',
    });

    expect(createDropboxTask).toHaveBeenCalledWith(expect.objectContaining({ branchChain: chain }));
    expect(recordPlannedChildTask).toHaveBeenCalledWith('/tmp', expect.objectContaining({
      taskId: 'task',
      branchChain: chain,
      childExecutionScope: scope,
    }));
  });

  it('rejects force and lineage mismatch before creating branch-chain children', async () => {
    await expect(createFollowupTask({
      ...PMSE_OPTIONS,
      force: true,
      branchChain: branchChain(),
      childExecutionScope: childExecutionScope(),
    })).rejects.toThrow('Branch-chain child creation does not support --force.');

    await expect(createFollowupTask({
      ...PMSE_OPTIONS,
      branchChain: branchChain({ rootTaskId: 'OTHER-ROOT' }),
      childExecutionScope: childExecutionScope(),
    })).rejects.toThrow('Branch-chain metadata does not match child lineage.');

    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(recordPlannedChildTask).not.toHaveBeenCalled();
  });

  it('requires childExecutionScope before writing branch-chain children', async () => {
    await expect(createFollowupTask({
      ...PMSE_OPTIONS,
      branchChain: branchChain(),
    })).rejects.toThrow('Branch-chain child creation requires childExecutionScope.');

    expect(createDropboxTask).not.toHaveBeenCalled();
    expect(recordPlannedChildTask).not.toHaveBeenCalled();
  });

  it('cleans up a newly created dropbox file and registry row when planned state recording fails', async () => {
    const repoRoot = path.join(tmpdir(), `followup-chain-${Date.now()}`);
    cleanupRoots.push(repoRoot);
    const dropboxDir = path.join(repoRoot, 'AgentWorkSpace', 'dropbox');
    mkdirSync(dropboxDir, { recursive: true });
    const createdPath = path.join(dropboxDir, 'new-child.md');
    writeFileSync(createdPath, '# New child\n');
    vi.mocked(createDropboxTask).mockResolvedValueOnce(createdPath);
    vi.mocked(recordPlannedChildTask).mockRejectedValueOnce(new Error('child-task-chain-parent-not-current-tip'));

    await expect(createFollowupTask({
      ...PMSE_OPTIONS,
      repoRoot,
      branchChain: branchChain(),
      childExecutionScope: childExecutionScope(),
    })).rejects.toThrow('child-task-chain-parent-not-current-tip');

    expect(existsSync(createdPath)).toBe(false);
    expect(removeTask).toHaveBeenCalledWith(repoRoot, 'new-child');
  });

  it('preserves legacy behavior when branchChain is absent', async () => {
    await createFollowupTask({ ...PMSE_OPTIONS, repoRoot: '/tmp' });

    expect(recordPlannedChildTask).not.toHaveBeenCalled();
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
