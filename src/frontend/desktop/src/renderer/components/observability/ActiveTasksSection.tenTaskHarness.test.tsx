/**
 * ActiveTasksSection 10-task deterministic harness.
 *
 * Covers: System Details shows all 10 active tasks with grouped lifecycle,
 * artifacts, and sessions, with named React Profiler thresholds.
 *
 * No real agents, sockets, containers, or spawns.
 * Every interleaving is forced deterministically via prop changes.
 */

// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback, act } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentTerminalSession,
  ArtifactReference,
  TaskLifecycleFeed,
} from '../../../shared/desktopContract';
import ActiveTasksSection from './ActiveTasksSection';

// --- Profiler budget constants ---
// Generous to avoid CI flakiness on slower machines while catching 5× regressions.
const MAX_COMMIT_COUNT = 30;
const MAX_DURATION_MS = 2000;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- helpers ---

function makeTask(
  index: number,
  overrides: Partial<TaskLifecycleFeed> = {},
): TaskLifecycleFeed {
  return {
    taskId: `TASK-${String(index).padStart(3, '0')}`,
    taskTitle: `Task ${index}`,
    taskKind: 'standard',
    workflowStage: 'active',
    activePath: null,
    parallelizationEnabled: false,
    startedAt: `2026-05-${String(20 + index).padStart(2, '0')}T10:00:00Z`,
    lastUpdatedAt: `2026-05-${String(20 + index).padStart(2, '0')}T11:00:00Z`,
    sourceArtifact: null,
    ...overrides,
  };
}

function makeSession(
  taskIndex: number,
  sessionSuffix: string = 'a',
): AgentTerminalSession {
  const taskId = `TASK-${String(taskIndex).padStart(3, '0')}`;
  return {
    taskId,
    agentId: 'dalton',
    agentLabel: 'Dalton (Software Engineer)',
    sessionId: `role:dalton:${taskId}-${sessionSuffix}`,
    instanceId: null,
    launchPid: null,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    sliceId: null,
    slicePath: null,
    launchState: 'started',
    terminalState: 'running',
    lastUpdatedAt: '2026-05-29T11:00:00Z',
    latestOutputLines: [],
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: 'info',
  };
}

function makeArtifact(
  taskIndex: number,
  label: string,
): ArtifactReference & { taskId: string } {
  const taskId = `TASK-${String(taskIndex).padStart(3, '0')}`;
  return {
    label,
    path: `AgentWorkSpace/tasks/${taskId}/handoffs/${label}`,
    kind: 'file',
    status: 'present',
    detail: `${label} for task ${taskIndex}`,
    taskId,
  };
}

function make10Tasks(): TaskLifecycleFeed[] {
  return [
    makeTask(1, { workflowStage: 'active' }),
    makeTask(2, { workflowStage: 'active' }),
    makeTask(3, { workflowStage: 'queued' }),
    makeTask(4, { workflowStage: 'active' }),
    makeTask(5, { workflowStage: 'blocked' }),
    makeTask(6, { workflowStage: 'active' }),
    makeTask(7, { workflowStage: 'active' }),
    makeTask(8, { workflowStage: 'queued' }),
    makeTask(9, { workflowStage: 'active' }),
    makeTask(10, { workflowStage: 'complete' }),
  ];
}

function make10Sessions(): AgentTerminalSession[] {
  return Array.from({ length: 10 }, (_, i) => makeSession(i + 1));
}

function make10Artifacts(): Array<ArtifactReference & { taskId?: string | null }> {
  return Array.from({ length: 10 }, (_, i) =>
    makeArtifact(i + 1, `professional-task.md`),
  );
}

interface ProfileResult {
  commitCount: number;
  totalActualDuration: number;
}

function profileRender(
  activeTasks: TaskLifecycleFeed[],
  artifactReferences: Array<ArtifactReference & { taskId?: string | null }> = [],
  agentTerminalSessions: AgentTerminalSession[] = [],
  updater?: () => {
    activeTasks: TaskLifecycleFeed[];
    artifactReferences?: Array<ArtifactReference & { taskId?: string | null }>;
    agentTerminalSessions?: AgentTerminalSession[];
  },
): ProfileResult {
  const commits: Array<{ actualDuration: number }> = [];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    commits.push({ actualDuration });
  };

  let currentActiveTasks = activeTasks;
  let currentArtifacts = artifactReferences;
  let currentSessions = agentTerminalSessions;
  let rerender: ReturnType<typeof render>['rerender'];

  act(() => {
    const result = render(
      <Profiler id="ActiveTasksSection" onRender={onRender}>
        <ActiveTasksSection
          activeTasks={currentActiveTasks}
          artifactReferences={currentArtifacts}
          agentTerminalSessions={currentSessions}
        />
      </Profiler>,
    );
    rerender = result.rerender;
  });

  if (updater) {
    act(() => {
      const updated = updater();
      currentActiveTasks = updated.activeTasks;
      currentArtifacts = updated.artifactReferences ?? currentArtifacts;
      currentSessions = updated.agentTerminalSessions ?? currentSessions;
      rerender(
        <Profiler id="ActiveTasksSection" onRender={onRender}>
          <ActiveTasksSection
            activeTasks={currentActiveTasks}
            artifactReferences={currentArtifacts}
            agentTerminalSessions={currentSessions}
          />
        </Profiler>,
      );
    });
  }

  return {
    commitCount: commits.length,
    totalActualDuration: commits.reduce((sum, c) => sum + c.actualDuration, 0),
  };
}

// --- tests ---

describe('ActiveTasksSection 10-task deterministic harness', () => {
  it('initial render of 10 tasks stays within Profiler budget', () => {
    const result = profileRender(make10Tasks(), make10Artifacts(), make10Sessions());

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('update when a task transitions lifecycle stage stays within Profiler budget', () => {
    const tasks = make10Tasks();
    const result = profileRender(tasks, [], [], () => ({
      activeTasks: tasks.map((t) =>
        t.taskId === 'TASK-005'
          ? { ...t, workflowStage: 'active' as const }
          : t,
      ),
    }));

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('update adding sessions to all 10 tasks stays within Profiler budget', () => {
    const tasks = make10Tasks();
    const result = profileRender(tasks, [], [], () => ({
      activeTasks: tasks,
      agentTerminalSessions: make10Sessions(),
    }));

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('sessions are scoped to their own task and do not bleed across tasks', () => {
    const tasks = make10Tasks();
    const sessions = make10Sessions();

    render(
      <ActiveTasksSection activeTasks={tasks} agentTerminalSessions={sessions} />,
    );

    // Each task should have exactly 1 session (one session per task)
    for (let i = 1; i <= 10; i++) {
      const taskId = `TASK-${String(i).padStart(3, '0')}`;
      const taskEl = screen.getByLabelText(`Active task ${taskId}`);
      expect(within(taskEl).getByText('1 session')).toBeInTheDocument();
    }
  });

  it('artifacts are scoped to their own task and do not bleed across tasks', () => {
    const tasks = make10Tasks();
    // Give each task a uniquely-labeled artifact
    const artifacts: Array<ArtifactReference & { taskId?: string | null }> =
      Array.from({ length: 10 }, (_, i) => ({
        label: `artifact-task-${i + 1}.md`,
        path: `path/to/task-${i + 1}/artifact.md`,
        kind: 'file' as const,
        status: 'present' as const,
        detail: `Artifact for task ${i + 1}`,
        taskId: `TASK-${String(i + 1).padStart(3, '0')}`,
      }));

    render(
      <ActiveTasksSection activeTasks={tasks} artifactReferences={artifacts} />,
    );

    for (let i = 1; i <= 10; i++) {
      const taskId = `TASK-${String(i).padStart(3, '0')}`;
      const taskEl = screen.getByLabelText(`Active task ${taskId}`);
      // Own artifact is present
      expect(within(taskEl).getByText(`artifact-task-${i}.md`)).toBeInTheDocument();
      // Neighbor artifact is absent (spot-check neighbor)
      const neighbor = i === 1 ? 2 : 1;
      expect(
        within(taskEl).queryByText(`artifact-task-${neighbor}.md`),
      ).not.toBeInTheDocument();
    }
  });

  it('per-task lifecycle chips are visually grouped per task row', () => {
    const tasks = make10Tasks();
    render(<ActiveTasksSection activeTasks={tasks} />);

    // Check that lifecycle chips exist for each task in their own container
    for (let i = 1; i <= 10; i++) {
      const taskId = `TASK-${String(i).padStart(3, '0')}`;
      const taskEl = screen.getByLabelText(`Active task ${taskId}`);
      const chipsArea = within(taskEl).getByLabelText(`Task ${taskId} status chips`);
      expect(chipsArea).toBeInTheDocument();
    }
  });
});
