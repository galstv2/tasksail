import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArchivedTaskEntry, TaskBoardReadChildChainBranchInventoryResponse } from '../../../shared/desktopContract';
import { formatLocalTimeShort, formatRelativeDay } from '../../utils/localTimestamp';
import type { TaskBoardState } from '../../hooks/useTaskBoard';
import TaskBoard from './TaskBoard';

function archivedTask(taskId: string, title: string, archivedAt: string | null): ArchivedTaskEntry {
  return {
    taskId,
    title,
    summary: '',
    rootTaskId: taskId,
    qmdRecordId: `task:pack:${taskId}`,
    followupReason: '',
    year: '2026',
    archivePath: `/archive/${taskId}/archive.md`,
    archivedAt,
    contextPackName: 'pack',
  };
}

function childChainMetadata(
  taskId: string,
  rootTaskId: string,
  isCurrentTip: boolean,
): NonNullable<ArchivedTaskEntry['childChain']> {
  return {
    rootTaskId,
    parentTaskId: taskId === rootTaskId ? null : rootTaskId,
    previousTaskId: taskId === rootTaskId ? null : rootTaskId,
    depth: taskId === rootTaskId ? 0 : 1,
    state: 'completed',
    currentTipTaskId: isCurrentTip ? taskId : 'CHAIN-TIP',
    isCurrentTip,
    archivePath: `/archive/${taskId}/archive.md`,
    archiveArtifactDir: `/archive/${taskId}`,
    parentArchivePath: null,
    parentArchiveArtifactDir: null,
  };
}

function board(completedItems: ArchivedTaskEntry[]): TaskBoardState {
  return {
    dropboxItems: [],
    pendingItems: [],
    errorItems: [],
    completedItems,
  };
}

describe('TaskBoard completed cards', () => {
  afterEach(() => cleanup());

  it('renders completed tasks newest first with local HH:MM and a relative day label', () => {
    const older = archivedTask('old', 'Older task', '2026-05-21T13:04:05Z');
    const newer = archivedTask('new', 'Newer task', '2026-05-23T03:58:37Z');

    const { container } = render(
      <TaskBoard
        board={board([older, newer])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    const completedTitles = Array.from(
      container.querySelectorAll('[data-column="completed"] .task-board-card__title'),
    ).map((node) => node.textContent);
    expect(completedTitles).toEqual(['Newer task', 'Older task']);
    const expectedMeta = `${formatLocalTimeShort(newer.archivedAt!)} · ${formatRelativeDay(newer.archivedAt!)}`;
    expect(screen.getByText(expectedMeta)).toBeInTheDocument();
  });

  it('labels completed child-chain cards without labeling standalone completed cards', () => {
    const root = archivedTask('ROOT', 'Root task', '2026-05-21T13:04:05Z');
    root.childChain = childChainMetadata('ROOT', 'ROOT', false);
    const child = archivedTask('CHILD', 'Child task', '2026-05-22T13:04:05Z');
    child.childChain = childChainMetadata('CHILD', 'ROOT', false);
    const tip = archivedTask('TIP', 'Tip task', '2026-05-23T13:04:05Z');
    tip.childChain = childChainMetadata('TIP', 'ROOT', true);
    const standalone = archivedTask('STANDALONE', 'Standalone task', '2026-05-24T13:04:05Z');

    const { container } = render(
      <TaskBoard
        board={board([root, child, tip, standalone])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    expect(screen.getByText('Chain root')).toBeInTheDocument();
    expect(screen.getByText('Chain tip')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('.task-board-card__badge')).map((node) => node.textContent)).toEqual([
      'Chain tip',
      'Child task',
      'Chain root',
    ]);
  });
});

describe('TaskBoard activation progress cards', () => {
  afterEach(() => cleanup());

  it('renders the compact activation phase label', () => {
    render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [{
            fileName: 'TASK-A.md',
            taskId: 'TASK-A',
            title: 'Task A',
            state: 'activating',
            activationPhase: 'materializing-worktree',
            activationStartedAt: '2026-05-23T10:00:00Z',
            activationUpdatedAt: '2026-05-23T10:00:05Z',
          }],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    // Phase label is now embedded in the meta line alongside the state word
    // and the activation start time.
    expect(screen.getByText(/Activating · Copying workspace files/)).toBeInTheDocument();
  });

  it('keeps activating cards non-draggable and non-deletable but clickable', () => {
    const readTaskContent = vi.fn(async () => ({ content: '# Task A' }));
    const onDeleteTask = vi.fn(async () => true);
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [{
            fileName: 'TASK-A.md',
            taskId: 'TASK-A',
            title: 'Task A',
            state: 'activating',
            activationPhase: 'claimed',
          }],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onDeleteTask={onDeleteTask}
        readTaskContent={readTaskContent}
      />,
    );

    const card = container.querySelector<HTMLElement>('[data-filename="TASK-A.md"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('draggable')).toBe('false');
    expect(screen.queryByRole('button', { name: /delete task a/i })).not.toBeInTheDocument();
    fireEvent.click(card!);
    expect(readTaskContent).toHaveBeenCalledWith('TASK-A.md', 'pending', undefined);
  });

  it('pins active and activating cards above plain pending cards', () => {
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
            { fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' },
            { fileName: 'ACTIVATING.md', taskId: 'ACTIVATING', title: 'Activating', state: 'activating' },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
      />,
    );

    const pendingTitles = Array.from(
      container.querySelectorAll('[data-column="pending"] .task-board-card__title'),
    ).map((node) => node.textContent);
    expect(pendingTitles).toEqual(['Active', 'Activating', 'Pending']);
  });

  it('closes the stop confirmation before kill task settles', async () => {
    let resolveStop!: () => void;
    const onKillTask = vi.fn(() => new Promise<void>((resolve) => {
      resolveStop = resolve;
    }));
    render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onKillTask={onKillTask}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /stop task active/i }));
    expect(screen.getByText('Stop this task?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop task' }));

    expect(onKillTask).toHaveBeenCalledWith('ACTIVE.md', 'ACTIVE');
    expect(screen.queryByText('Stop this task?')).not.toBeInTheDocument();
    resolveStop?.();
  });

  it('renders stopping cards as pinned, fixed, clickable status cards with no stop button', () => {
    const readTaskContent = vi.fn(async () => ({ content: '# Task' }));
    const onDeleteTask = vi.fn(async () => true);
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
            {
              fileName: 'STOPPING.md',
              taskId: 'STOPPING',
              title: 'Stopping',
              state: 'stopping',
              stopRequestedAt: '2026-05-23T10:00:00Z',
            },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onDeleteTask={onDeleteTask}
        onKillTask={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );

    const pendingTitles = Array.from(
      container.querySelectorAll('[data-column="pending"] .task-board-card__title'),
    ).map((node) => node.textContent);
    expect(pendingTitles).toEqual(['Stopping', 'Pending']);
    const card = container.querySelector<HTMLElement>('[data-filename="STOPPING.md"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('task-board-card--stopping')).toBe(true);
    expect(card?.getAttribute('draggable')).toBe('false');
    expect(screen.queryByRole('button', { name: /stop task stopping/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete stopping/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Stopping · Requested/)).toHaveAttribute('role', 'status');
    fireEvent.click(card!);
    expect(readTaskContent).toHaveBeenCalledWith('STOPPING.md', 'pending', undefined);
  });

  it('renders failed cleanup stopping cards with a single retry cleanup control', () => {
    const readTaskContent = vi.fn(async () => ({ content: '# Task' }));
    const onRetryKillCleanup = vi.fn(async () => undefined);
    const { container } = render(
      <TaskBoard
        board={{
          dropboxItems: [],
          pendingItems: [
            { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
            {
              fileName: 'STOPPING.md',
              taskId: 'STOPPING',
              title: 'Stopping',
              state: 'stopping',
              stopRequestedAt: '2026-05-23T10:00:00Z',
              stopCleanupStatus: 'failed',
              stopCleanupRetryable: true,
              stopCleanupErrorCode: 'failed-item-cleanup-failed',
            },
          ],
          errorItems: [],
          completedItems: [],
        }}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        onDeleteTask={vi.fn()}
        onKillTask={vi.fn()}
        onRetryKillCleanup={onRetryKillCleanup}
        readTaskContent={readTaskContent}
      />,
    );

    const card = container.querySelector<HTMLElement>('[data-filename="STOPPING.md"]');
    expect(card?.classList.contains('task-board-card--stopping')).toBe(true);
    expect(card?.classList.contains('task-board-card--cleanup-attention')).toBe(true);
    expect(card?.getAttribute('draggable')).toBe('false');
    expect(screen.getByText('Stopping · Cleanup needs attention')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: /stop task stopping/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete stopping/i })).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry cleanup for stopping/i });
    fireEvent.click(retry);
    expect(onRetryKillCleanup).toHaveBeenCalledWith('STOPPING.md', 'STOPPING');
  });
});

describe('TaskBoard artifact explorer', () => {
  afterEach(() => cleanup());

  const MULTI_ARTIFACTS = [
    { relativePath: 'archive.md', label: 'archive.md', sizeBytes: 12 },
    { relativePath: 'ImplementationSteps/slice-1.md', label: 'ImplementationSteps/slice-1.md', sizeBytes: 32 },
    { relativePath: 'handoffs/final-summary.md', label: 'handoffs/final-summary.md', sizeBytes: 24 },
  ];

  function renderCompleted(readTaskContent: ReturnType<typeof vi.fn>) {
    return render(
      <TaskBoard
        board={board([archivedTask('DONE-A', 'Done A', '2026-05-23T03:58:37Z')])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );
  }

  it('opens a completed card with archive.md selected when multiple artifacts exist', async () => {
    const readTaskContent = vi.fn(async () => ({
      content: 'ARCHIVE_BODY_TEXT',
      artifactRelativePath: 'archive.md',
      artifacts: MULTI_ARTIFACTS,
    }));
    const { container } = renderCompleted(readTaskContent);

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);

    const trigger = await screen.findByRole('button', { name: 'Artifact Explorer' });
    expect(trigger).toHaveTextContent('archive.md');
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'ImplementationSteps/slice-1.md' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'archive.md',
      'ImplementationSteps/slice-1.md',
      'handoffs/final-summary.md',
    ]);
    expect(screen.getByText('ARCHIVE_BODY_TEXT')).toBeInTheDocument();
    expect(readTaskContent).toHaveBeenCalledWith('DONE-A.md', 'completed', undefined);
  });

  it('changes the selection and renders the chosen handoffs/final-summary.md markdown', async () => {
    const readTaskContent = vi.fn(async (_fileName: string, _column: string, rel?: string) =>
      rel === 'handoffs/final-summary.md'
        ? { content: 'FINAL_SUMMARY_TEXT', artifactRelativePath: 'handoffs/final-summary.md', artifacts: MULTI_ARTIFACTS }
        : { content: 'ARCHIVE_BODY_TEXT', artifactRelativePath: 'archive.md', artifacts: MULTI_ARTIFACTS });
    const { container } = renderCompleted(readTaskContent);

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Artifact Explorer' }));
    fireEvent.click(screen.getByRole('option', { name: 'handoffs/final-summary.md' }));

    expect(await screen.findByText('FINAL_SUMMARY_TEXT')).toBeInTheDocument();
    expect(readTaskContent).toHaveBeenCalledWith('DONE-A.md', 'completed', 'handoffs/final-summary.md');
  });

  it('changes the selection and renders the chosen ImplementationSteps markdown', async () => {
    const readTaskContent = vi.fn(async (_fileName: string, _column: string, rel?: string) =>
      rel === 'ImplementationSteps/slice-1.md'
        ? { content: 'IMPLEMENTATION_STEP_TEXT', artifactRelativePath: 'ImplementationSteps/slice-1.md', artifacts: MULTI_ARTIFACTS }
        : { content: 'ARCHIVE_BODY_TEXT', artifactRelativePath: 'archive.md', artifacts: MULTI_ARTIFACTS });
    const { container } = renderCompleted(readTaskContent);

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Artifact Explorer' }));
    fireEvent.click(screen.getByRole('option', { name: 'ImplementationSteps/slice-1.md' }));

    expect(await screen.findByText('IMPLEMENTATION_STEP_TEXT')).toBeInTheDocument();
    expect(readTaskContent).toHaveBeenCalledWith('DONE-A.md', 'completed', 'ImplementationSteps/slice-1.md');
  });

  it('Artifact Explorer is hidden for open, pending, failed, and single-artifact completed content', async () => {
    // Single-artifact completed content: the modal opens but exposes no explorer.
    const singleArtifact = vi.fn(async () => ({
      content: 'ONLY_ARCHIVE',
      artifactRelativePath: 'archive.md',
      artifacts: [{ relativePath: 'archive.md', label: 'archive.md', sizeBytes: 10 }],
    }));
    const single = renderCompleted(singleArtifact);
    fireEvent.click(single.container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);
    expect(await screen.findByText('ONLY_ARCHIVE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
    single.unmount();

    // Non-completed columns never receive artifact metadata, so the explorer is absent.
    const nonCompleted: Array<[string, TaskBoardState, string]> = [
      ['OPEN', { dropboxItems: [{ fileName: 'OPEN.md', taskId: 'OPEN', title: 'Open' }], pendingItems: [], errorItems: [], completedItems: [] }, 'OPEN_BODY'],
      ['PEND', { dropboxItems: [], pendingItems: [{ fileName: 'PEND.md', taskId: 'PEND', title: 'Pend', state: 'pending' }], errorItems: [], completedItems: [] }, 'PEND_BODY'],
      ['FAIL', { dropboxItems: [], pendingItems: [], errorItems: [{ fileName: 'FAIL.md', taskId: 'FAIL', title: 'Fail' }], completedItems: [] }, 'FAIL_BODY'],
    ];
    for (const [name, boardState, body] of nonCompleted) {
      const read = vi.fn(async () => ({ content: body }));
      const { container, unmount } = render(
        <TaskBoard
          board={boardState}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={read}
        />,
      );
      fireEvent.click(container.querySelector<HTMLElement>(`[data-filename="${name}.md"]`)!);
      expect(await screen.findByText(body)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Artifact Explorer' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('keeps the previous rendered markdown when a selected artifact read returns not-found', async () => {
    const readTaskContent = vi.fn(async (_fileName: string, _column: string, rel?: string) =>
      rel === 'handoffs/final-summary.md'
        ? null
        : { content: 'ARCHIVE_BODY_TEXT', artifactRelativePath: 'archive.md', artifacts: MULTI_ARTIFACTS });
    const { container } = renderCompleted(readTaskContent);

    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="DONE-A.md"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Artifact Explorer' }));
    fireEvent.click(screen.getByRole('option', { name: 'handoffs/final-summary.md' }));

    // The previous successful archive.md content stays; the modal does not blank.
    expect(await screen.findByText('ARCHIVE_BODY_TEXT')).toBeInTheDocument();
    expect(readTaskContent).toHaveBeenCalledWith('DONE-A.md', 'completed', 'handoffs/final-summary.md');
  });
});

describe('TaskBoard View Chain', () => {
  afterEach(() => cleanup());

  const VIEW_CHAIN_LABEL = 'View child chain repos and branches';

  const LOADED: TaskBoardReadChildChainBranchInventoryResponse = {
    action: 'taskBoard.readChildChainBranchInventory',
    mode: 'loaded',
    message: 'Loaded.',
    inventory: {
      schemaVersion: 1,
      rootTaskId: 'ROOT-1',
      selectedTaskId: 'CHILD-1',
      currentTipTaskId: 'CHILD-1',
      taskCount: 2,
      rows: [
        {
          repoRoot: '/repos/app',
          repoLabel: 'app-label',
          chainSourceBranch: 'feature/app',
          sourceKind: 'parent-handoff',
          introducedAtTaskId: 'ROOT-1',
          introducedAtDepth: 0,
          targetBranch: 'main',
        },
      ],
      generatedAt: '2026-05-30T00:00:00.000Z',
    },
  };

  type ReadInventory = (
    taskId: string,
    expectedRootTaskId?: string | null,
  ) => Promise<TaskBoardReadChildChainBranchInventoryResponse | null>;

  function childChainCompleted(): ArchivedTaskEntry {
    const entry = archivedTask('CHILD-1', 'Child One', '2026-05-23T03:58:37Z');
    entry.childChain = childChainMetadata('CHILD-1', 'ROOT-1', true);
    return entry;
  }

  function renderChild(readInv: ReadInventory) {
    return render(
      <TaskBoard
        board={board([childChainCompleted()])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={vi.fn(async () => ({ content: 'ARCHIVE_BODY' }))}
        readChildChainBranchInventory={readInv}
      />,
    );
  }

  async function openChild(container: HTMLElement) {
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="CHILD-1.md"]')!);
    await screen.findByText('ARCHIVE_BODY');
  }

  it('shows View Chain on completed child-chain modals and hides it for standalone and non-completed', async () => {
    const readInv = vi.fn(async () => LOADED);
    const child = renderChild(readInv);
    await openChild(child.container);
    expect(screen.getByRole('button', { name: VIEW_CHAIN_LABEL })).toBeInTheDocument();
    child.unmount();

    const standalone = render(
      <TaskBoard
        board={board([archivedTask('PLAIN', 'Plain', '2026-05-23T03:58:37Z')])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={vi.fn(async () => ({ content: 'PLAIN_BODY' }))}
        readChildChainBranchInventory={readInv}
      />,
    );
    fireEvent.click(standalone.container.querySelector<HTMLElement>('[data-filename="PLAIN.md"]')!);
    expect(await screen.findByText('PLAIN_BODY')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: VIEW_CHAIN_LABEL })).not.toBeInTheDocument();
    standalone.unmount();

    const nonCompleted: Array<[string, TaskBoardState]> = [
      ['OPEN', { dropboxItems: [{ fileName: 'OPEN.md', taskId: 'OPEN', title: 'Open' }], pendingItems: [], errorItems: [], completedItems: [] }],
      ['PEND', { dropboxItems: [], pendingItems: [{ fileName: 'PEND.md', taskId: 'PEND', title: 'Pend', state: 'pending' }], errorItems: [], completedItems: [] }],
      ['FAIL', { dropboxItems: [], pendingItems: [], errorItems: [{ fileName: 'FAIL.md', taskId: 'FAIL', title: 'Fail' }], completedItems: [] }],
    ];
    for (const [name, boardState] of nonCompleted) {
      const r = render(
        <TaskBoard
          board={boardState}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={vi.fn(async () => ({ content: `${name}_BODY` }))}
          readChildChainBranchInventory={readInv}
        />,
      );
      fireEvent.click(r.container.querySelector<HTMLElement>(`[data-filename="${name}.md"]`)!);
      expect(await screen.findByText(`${name}_BODY`)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: VIEW_CHAIN_LABEL })).not.toBeInTheDocument();
      r.unmount();
    }
  });

  it('loads the inventory with taskId and chain root, rendering every row field', async () => {
    const readInv = vi.fn(async () => LOADED);
    const { container } = renderChild(readInv);
    await openChild(container);
    fireEvent.click(screen.getByRole('button', { name: VIEW_CHAIN_LABEL }));

    expect(await screen.findByText('Child Chain Branches')).toBeInTheDocument();
    expect(readInv).toHaveBeenCalledWith('CHILD-1', 'ROOT-1');
    expect(screen.getByText('app-label')).toBeInTheDocument();
    expect(screen.getByText('/repos/app')).toBeInTheDocument();
    expect(screen.getByText('feature/app')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('Parent handoff')).toBeInTheDocument();
    expect(screen.getByText(/depth 0/)).toBeInTheDocument();
  });

  it('renders the empty message for a loaded inventory with zero rows', async () => {
    const empty: TaskBoardReadChildChainBranchInventoryResponse = {
      ...LOADED,
      inventory: { ...LOADED.inventory!, rows: [] },
    };
    const { container } = renderChild(vi.fn(async () => empty));
    await openChild(container);
    fireEvent.click(screen.getByRole('button', { name: VIEW_CHAIN_LABEL }));
    expect(await screen.findByText('No repos or branches are recorded for this chain.')).toBeInTheDocument();
  });

  it('renders safe messages for not-chain-task and invalid-state without inventory', async () => {
    const notChain: TaskBoardReadChildChainBranchInventoryResponse = {
      action: 'taskBoard.readChildChainBranchInventory',
      mode: 'not-chain-task',
      message: 'This completed task is not recorded as part of a child-task chain.',
    };
    const first = renderChild(vi.fn(async () => notChain));
    await openChild(first.container);
    fireEvent.click(screen.getByRole('button', { name: VIEW_CHAIN_LABEL }));
    expect(await screen.findByText('This completed task is not recorded as part of a child-task chain.')).toBeInTheDocument();
    first.unmount();

    const invalid: TaskBoardReadChildChainBranchInventoryResponse = {
      action: 'taskBoard.readChildChainBranchInventory',
      mode: 'invalid-state',
      message: 'Child-task chain state is unavailable or inconsistent.',
    };
    const second = renderChild(vi.fn(async () => invalid));
    await openChild(second.container);
    fireEvent.click(screen.getByRole('button', { name: VIEW_CHAIN_LABEL }));
    expect(await screen.findByText('Child-task chain state is unavailable or inconsistent.')).toBeInTheDocument();
  });

  it('exposes an accessible busy state on the View Chain button while loading', async () => {
    let resolveInv!: (value: TaskBoardReadChildChainBranchInventoryResponse | null) => void;
    const pending = new Promise<TaskBoardReadChildChainBranchInventoryResponse | null>((resolve) => {
      resolveInv = resolve;
    });
    const { container } = renderChild(vi.fn(() => pending));
    await openChild(container);
    const button = screen.getByRole('button', { name: VIEW_CHAIN_LABEL });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    resolveInv(LOADED);
    expect(await screen.findByText('Child Chain Branches')).toBeInTheDocument();
  });

  it('keeps View Chain available after switching artifacts (childChain retained)', async () => {
    const MULTI = [
      { relativePath: 'archive.md', label: 'archive.md', sizeBytes: 10 },
      { relativePath: 'handoffs/final-summary.md', label: 'handoffs/final-summary.md', sizeBytes: 20 },
    ];
    const readTaskContent = vi.fn(async (_fileName: string, _column: string, rel?: string) =>
      rel === 'handoffs/final-summary.md'
        ? { content: 'FINAL_SUMMARY', artifactRelativePath: 'handoffs/final-summary.md', artifacts: MULTI }
        : { content: 'ARCHIVE_BODY', artifactRelativePath: 'archive.md', artifacts: MULTI });
    const { container } = render(
      <TaskBoard
        board={board([childChainCompleted()])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
        readChildChainBranchInventory={vi.fn(async () => LOADED)}
      />,
    );
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="CHILD-1.md"]')!);
    expect(await screen.findByText('ARCHIVE_BODY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_CHAIN_LABEL })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Artifact Explorer' }));
    fireEvent.click(screen.getByRole('option', { name: 'handoffs/final-summary.md' }));
    expect(await screen.findByText('FINAL_SUMMARY')).toBeInTheDocument();
    // Artifact selection must not clear the retained childChain metadata.
    expect(screen.getByRole('button', { name: VIEW_CHAIN_LABEL })).toBeInTheDocument();
  });
});

describe('TaskBoard View Branches', () => {
  afterEach(() => cleanup());

  const VIEW_BRANCHES_LABEL = 'View task source branches and target repos';
  const VIEW_CHAIN_LABEL = 'View child chain repos and branches';

  type BranchHandoff = NonNullable<ArchivedTaskEntry['branchHandoffs']>[number];

  function branchHandoff(overrides: Partial<BranchHandoff> = {}): BranchHandoff {
    return {
      repoRoot: '/repos/platform',
      repoLabel: 'platform',
      branch: 'task/feature-1',
      baseCommitSha: 'base0000000000000000',
      headCommitSha: 'head1234567890abcdef',
      commitsAhead: 2,
      status: 'ready-for-operator-review',
      autoMerge: {
        enabled: false,
        status: 'disabled',
        targetBranch: 'main',
        detail: 'Auto-merge is disabled.',
      },
      ...overrides,
    };
  }

  function standaloneWithHandoffs(handoffs: BranchHandoff[]): ArchivedTaskEntry {
    const entry = archivedTask('REG-1', 'Regular One', '2026-05-23T03:58:37Z');
    entry.branchHandoffs = handoffs;
    return entry;
  }

  function renderRegular(entry: ArchivedTaskEntry, readChildChain?: ReturnType<typeof vi.fn>) {
    return render(
      <TaskBoard
        board={board([entry])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={vi.fn(async () => ({ content: 'ARCHIVE_BODY' }))}
        readChildChainBranchInventory={readChildChain}
      />,
    );
  }

  async function openCard(container: HTMLElement, fileName: string) {
    fireEvent.click(container.querySelector<HTMLElement>(`[data-filename="${fileName}"]`)!);
    await screen.findByText('ARCHIVE_BODY');
  }

  it('shows View Branches for a completed standalone task with branch handoffs', async () => {
    const { container } = renderRegular(standaloneWithHandoffs([branchHandoff()]));
    await openCard(container, 'REG-1.md');
    expect(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: VIEW_CHAIN_LABEL })).not.toBeInTheDocument();
  });

  it('shows View Chain not View Branches for a completed child-chain task that also has branch handoffs', async () => {
    const entry = archivedTask('CHILD-1', 'Child One', '2026-05-23T03:58:37Z');
    entry.childChain = childChainMetadata('CHILD-1', 'ROOT-1', true);
    entry.branchHandoffs = [branchHandoff()];
    const { container } = renderRegular(entry, vi.fn(async () => null));
    await openCard(container, 'CHILD-1.md');
    expect(screen.getByRole('button', { name: VIEW_CHAIN_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: VIEW_BRANCHES_LABEL })).not.toBeInTheDocument();
  });

  it('shows no branch footer action for a completed task without branch handoffs', async () => {
    const { container } = renderRegular(archivedTask('PLAIN', 'Plain', '2026-05-23T03:58:37Z'));
    await openCard(container, 'PLAIN.md');
    expect(screen.queryByRole('button', { name: VIEW_BRANCHES_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: VIEW_CHAIN_LABEL })).not.toBeInTheDocument();
  });

  it('does not show View Branches for open, pending, or failed task detail modals', async () => {
    const nonCompleted: Array<[string, TaskBoardState]> = [
      ['OPEN', { dropboxItems: [{ fileName: 'OPEN.md', taskId: 'OPEN', title: 'Open' }], pendingItems: [], errorItems: [], completedItems: [] }],
      ['PEND', { dropboxItems: [], pendingItems: [{ fileName: 'PEND.md', taskId: 'PEND', title: 'Pend', state: 'pending' }], errorItems: [], completedItems: [] }],
      ['FAIL', { dropboxItems: [], pendingItems: [], errorItems: [{ fileName: 'FAIL.md', taskId: 'FAIL', title: 'Fail' }], completedItems: [] }],
    ];
    for (const [name, boardState] of nonCompleted) {
      const r = render(
        <TaskBoard
          board={boardState}
          onReorderPending={vi.fn()}
          onRequeueErrorItem={vi.fn()}
          readTaskContent={vi.fn(async () => ({ content: `${name}_BODY` }))}
        />,
      );
      fireEvent.click(r.container.querySelector<HTMLElement>(`[data-filename="${name}.md"]`)!);
      expect(await screen.findByText(`${name}_BODY`)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: VIEW_BRANCHES_LABEL })).not.toBeInTheDocument();
      r.unmount();
    }
  });

  it('opens Task Branches and renders every row field without a git or IPC call', async () => {
    const readChildChain = vi.fn(async () => null);
    const { container } = renderRegular(standaloneWithHandoffs([branchHandoff()]), readChildChain);
    await openCard(container, 'REG-1.md');
    fireEvent.click(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL }));

    expect(await screen.findByText('Task Branches')).toBeInTheDocument();
    expect(screen.getByText('Archived branch handoff for this completed task.')).toBeInTheDocument();
    expect(screen.getByText('platform')).toBeInTheDocument();
    expect(screen.getByText('/repos/platform')).toBeInTheDocument();
    expect(screen.getByText('task/feature-1')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    const head = screen.getByText('head123');
    expect(head).toHaveAttribute('title', 'head1234567890abcdef');
    expect(screen.getByText('+2 ahead')).toBeInTheDocument();
    expect(screen.getByText('Manual review')).toBeInTheDocument();
    // The regular branch view is sourced from ArchivedTaskEntry.branchHandoffs only.
    expect(readChildChain).not.toHaveBeenCalled();
  });

  it('renders Not captured for a null target branch and makes no IPC call', async () => {
    const readChildChain = vi.fn(async () => null);
    const handoff = branchHandoff({
      autoMerge: { enabled: false, status: 'disabled', targetBranch: null, detail: 'Auto-merge is disabled.' },
    });
    const { container } = renderRegular(standaloneWithHandoffs([handoff]), readChildChain);
    await openCard(container, 'REG-1.md');
    fireEvent.click(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL }));
    expect(await screen.findByText('Not captured')).toBeInTheDocument();
    expect(readChildChain).not.toHaveBeenCalled();
  });

  it('maps archived auto-merge status into operator review language', async () => {
    const applied = standaloneWithHandoffs([branchHandoff({
      status: 'auto-merged-to-target',
      autoMerge: { enabled: true, status: 'applied', targetBranch: 'main', detail: 'Applied task branch patch to the target index.' },
    })]);
    const first = renderRegular(applied);
    await openCard(first.container, 'REG-1.md');
    fireEvent.click(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL }));
    expect(await screen.findByText('Staged into target')).toBeInTheDocument();
    expect(screen.getByText('Applied task branch patch to the target index.')).toBeInTheDocument();
    first.unmount();

    const skipped = standaloneWithHandoffs([branchHandoff({
      autoMerge: { enabled: true, status: 'skipped-source-missing', targetBranch: 'main', detail: 'Source branch was missing.' },
    })]);
    const second = renderRegular(skipped);
    await openCard(second.container, 'REG-1.md');
    fireEvent.click(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL }));
    expect(await screen.findByText('Auto-merge skipped')).toBeInTheDocument();
    second.unmount();

    const manual = standaloneWithHandoffs([branchHandoff({ autoMerge: undefined })]);
    const third = renderRegular(manual);
    await openCard(third.container, 'REG-1.md');
    fireEvent.click(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL }));
    expect(await screen.findByText('Manual review')).toBeInTheDocument();
  });

  it('renders multiple handoffs in deterministic repo label, repo root, source branch order', async () => {
    const entry = standaloneWithHandoffs([
      branchHandoff({ repoLabel: 'tools', repoRoot: '/repos/tools', branch: 'task/tools' }),
      branchHandoff({ repoLabel: 'platform', repoRoot: '/repos/platform', branch: 'task/feature-1' }),
    ]);
    const { container } = renderRegular(entry);
    await openCard(container, 'REG-1.md');
    fireEvent.click(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL }));
    await screen.findByText('Task Branches');
    // ModalShell renders through a portal, so query the whole document, not container.
    const labels = Array.from(document.querySelectorAll('.task-branch-inventory__repo-label')).map((n) => n.textContent);
    expect(labels).toEqual(['platform', 'tools']);
  });

  it('keeps View Branches available after switching artifacts (branchHandoffs retained)', async () => {
    const MULTI = [
      { relativePath: 'archive.md', label: 'archive.md', sizeBytes: 10 },
      { relativePath: 'handoffs/final-summary.md', label: 'handoffs/final-summary.md', sizeBytes: 20 },
    ];
    const readTaskContent = vi.fn(async (_fileName: string, _column: string, rel?: string) =>
      rel === 'handoffs/final-summary.md'
        ? { content: 'FINAL_SUMMARY', artifactRelativePath: 'handoffs/final-summary.md', artifacts: MULTI }
        : { content: 'ARCHIVE_BODY', artifactRelativePath: 'archive.md', artifacts: MULTI });
    const { container } = render(
      <TaskBoard
        board={board([standaloneWithHandoffs([branchHandoff()])])}
        onReorderPending={vi.fn()}
        onRequeueErrorItem={vi.fn()}
        readTaskContent={readTaskContent}
      />,
    );
    fireEvent.click(container.querySelector<HTMLElement>('[data-filename="REG-1.md"]')!);
    expect(await screen.findByText('ARCHIVE_BODY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Artifact Explorer' }));
    fireEvent.click(screen.getByRole('option', { name: 'handoffs/final-summary.md' }));
    expect(await screen.findByText('FINAL_SUMMARY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VIEW_BRANCHES_LABEL })).toBeInTheDocument();
  });
});
