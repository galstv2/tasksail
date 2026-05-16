import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const { mockReadFile, mockReaddir, mockStat, mockMkdir, mockCopyFile, mockCp } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockMkdir: vi.fn(),
  mockCopyFile: vi.fn(),
  mockCp: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  readdir: mockReaddir,
  stat: mockStat,
  mkdir: mockMkdir,
  copyFile: mockCopyFile,
  cp: mockCp,
}));

vi.mock('../../core/index.js', () => ({
  findRepoRoot: () => '/fake/repo',
}));

import {
  listReinforcementTasks,
  listRealignmentSessions,
  readAgentRewards,
  readGlobalRealignmentDoc,
  readReinforcementOverview,
} from '../reinforcementRead.js';

const repoRoot = '/fake/repo';
const canonicalStore = path.join(
  repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'reinforcement', 'store',
);
const canonicalSidecars = path.join(
  repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'reinforcement', 'agent-rewards',
);
const legacyStore = path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'reinforcement');
const legacySidecars = path.join(
  repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'agent-rewards',
);

type MockDirEntry = string | {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

function installFiles(files: Map<string, unknown>, dirs = new Map<string, MockDirEntry[]>()) {
  mockReadFile.mockImplementation(async (filePath: string) => {
    if (!files.has(filePath)) throw new Error(`missing ${filePath}`);
    const value = files.get(filePath);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
  mockReaddir.mockImplementation(async (dirPath: string) => {
    if (!dirs.has(dirPath)) throw new Error(`missing ${dirPath}`);
    return dirs.get(dirPath);
  });
}

function dirEntry(name: string) {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  };
}

function fileEntry(name: string) {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  };
}

describe('reinforcementRead canonical paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads overview data from canonical store and canonical sidecars', async () => {
    const files = new Map<string, unknown>([
      [path.join(canonicalStore, 'task-ledger.json'), {
        entries: [
          {
            task_id: 'T-1',
            effective_reward: 2000,
            settlement_status: 'unrewarded',
            quality_outcome: 'success',
          },
        ],
      }],
      [path.join(canonicalStore, 'settlements.json'), {
        entries: [{ settlement_id: 'SETTLE-1' }],
      }],
      [path.join(canonicalSidecars, 'software-engineer.json'), {
        agent_id: 'software-engineer',
        role: 'Software Engineer',
        multiplier: 1.5,
        lifetime_reward: 45000,
        unrewarded_task_count: 1,
        unrewarded_reward_total: 2000,
      }],
    ]);
    installFiles(files, new Map([[canonicalSidecars, ['software-engineer.json']]]));

    const overview = await readReinforcementOverview(repoRoot);

    expect(overview.totalTasks).toBe(1);
    expect(overview.totalReward).toBe(2000);
    expect(overview.lastSettlementId).toBe('SETTLE-1');
    expect(overview.agents[0]?.agentId).toBe('software-engineer');
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join(canonicalStore, 'task-ledger.json'), 'utf-8',
    );
  });

  it('falls back to legacy structured store when canonical file is absent', async () => {
    installFiles(new Map<string, unknown>([
      [path.join(legacyStore, 'global-realignment-doc.json'), {
        standing_expectations: ['legacy expectation'],
        version: 3,
        updated_at: '2026-01-01T00:00:00Z',
      }],
    ]));

    const doc = await readGlobalRealignmentDoc(repoRoot);

    expect(doc.standingExpectations).toEqual(['legacy expectation']);
    expect(doc.version).toBe(3);
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join(canonicalStore, 'global-realignment-doc.json'), 'utf-8',
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join(legacyStore, 'global-realignment-doc.json'), 'utf-8',
    );
  });

  it('does not read legacy structured store when canonical file exists', async () => {
    installFiles(new Map<string, unknown>([
      [path.join(canonicalStore, 'realignment', 'sessions.json'), {
        entries: [{
          realignment_id: 'RA-CANONICAL',
          trigger_task_id: 'T-1',
          trigger_feedback_id: 'FB-1',
          participating_agents: ['software-engineer'],
          failure_analysis: '',
          root_cause: '',
          corrective_actions: [],
          status: 'open',
          meeting_notes: '',
          created_at: '2026-01-01T00:00:00Z',
        }],
      }],
      [path.join(legacyStore, 'realignment', 'sessions.json'), {
        entries: [{ realignment_id: 'RA-LEGACY' }],
      }],
    ]));

    const sessions = await listRealignmentSessions(repoRoot);

    expect(sessions[0]?.realignmentId).toBe('RA-CANONICAL');
    expect(mockReadFile).not.toHaveBeenCalledWith(
      path.join(legacyStore, 'realignment', 'sessions.json'), 'utf-8',
    );
  });

  it('overlays running realignment job receipts on session status', async () => {
    installFiles(new Map<string, unknown>([
      [path.join(canonicalStore, 'realignment', 'sessions.json'), {
        entries: [{
          realignment_id: 'RA-RUNNING',
          trigger_task_id: 'T-1',
          trigger_feedback_id: 'FB-1',
          participating_agents: ['software-engineer'],
          failure_analysis: '',
          root_cause: '',
          corrective_actions: [],
          status: 'open',
          meeting_notes: '',
          created_at: '2026-01-01T00:00:00Z',
        }],
      }],
      [path.join(repoRoot, '.platform-state', 'runtime', 'realignment', 'RA-RUNNING', 'job.json'), {
        status: 'running',
      }],
    ]));

    const sessions = await listRealignmentSessions(repoRoot);

    expect(sessions[0]?.status).toBe('running');
  });

  it('falls back to legacy sidecars only when canonical sidecars are absent', async () => {
    installFiles(
      new Map<string, unknown>([
        [path.join(legacySidecars, 'software-engineer.json'), {
          agent_id: 'software-engineer',
          role: 'Software Engineer',
          multiplier: 1.5,
          lifetime_reward: 77000,
          unrewarded_task_count: 0,
          unrewarded_reward_total: 0,
        }],
      ]),
      new Map([
        [canonicalSidecars, []],
        [legacySidecars, ['software-engineer.json']],
      ]),
    );

    const agents = await readAgentRewards(repoRoot);

    expect(agents[0]?.lifetimeReward).toBe(77000);
    expect(mockReaddir).toHaveBeenCalledWith(canonicalSidecars);
    expect(mockReaddir).toHaveBeenCalledWith(legacySidecars);
  });

  it('normalizes stale stored multipliers to the current role multipliers', async () => {
    installFiles(
      new Map<string, unknown>([
        [path.join(canonicalSidecars, 'planning-agent.json'), {
          agent_id: 'planning-agent',
          role: 'Planning Specialist',
          multiplier: 0.5,
          lifetime_reward: 7500,
          unrewarded_task_count: 0,
          unrewarded_reward_total: 0,
        }],
        [path.join(canonicalSidecars, 'product-manager.json'), {
          agent_id: 'product-manager',
          role: 'Product Manager',
          multiplier: 1.0,
          lifetime_reward: 15000,
          unrewarded_task_count: 0,
          unrewarded_reward_total: 0,
        }],
      ]),
      new Map([[canonicalSidecars, ['planning-agent.json', 'product-manager.json']]]),
    );

    const agents = await readAgentRewards(repoRoot);

    expect(agents.find((agent) => agent.agentId === 'planning-agent')?.multiplier).toBe(1.0);
    expect(agents.find((agent) => agent.agentId === 'product-manager')?.multiplier).toBe(1.5);
  });

  it('lists tasks from the nested context-pack archive layout', async () => {
    const contextPackName = 'sample-pack';
    const archiveRoot = path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      'context-packs',
      contextPackName,
      'archive',
      'tasks',
    );
    const yearPath = path.join(archiveRoot, '2026');
    installFiles(
      new Map<string, unknown>([
        [path.join(canonicalStore, 'task-ledger.json'), {
          entries: [{
            task_id: 'task-nested',
            settlement_status: 'rewarded',
            effective_reward: 1500,
          }],
        }],
        [path.join(canonicalStore, 'feedback-events.json'), {
          entries: [{
            task_id: 'task-nested',
            feedback_id: 'FB-1',
          }],
        }],
        [path.join(yearPath, 'task-nested', 'archive.json'), {
          task_id: 'task-nested',
          task_title: 'Nested archived task',
          difficulty_level: 'Medium',
          workflow_status: 'completed',
        }],
        [path.join(yearPath, 'task-nested', 'archive.md'), '# Nested archived task\n'],
      ]),
      new Map([
        [archiveRoot, [dirEntry('2026')]],
        [yearPath, [
          dirEntry('task-nested'),
          fileEntry('task-nested.planner-focus-snapshot.json'),
        ]],
      ]),
    );

    const result = await listReinforcementTasks(repoRoot, contextPackName, '2026');

    expect(result.availableYears).toEqual(['2026']);
    expect(result.tasks).toEqual([{
      taskId: 'task-nested',
      title: 'Nested archived task',
      difficulty: 'medium',
      effectiveReward: 1500,
      settlementStatus: 'rewarded',
      qualityOutcome: 'completed',
      year: '2026',
      reviewStatus: 'reviewed',
      feedbackCount: 1,
      archivePath: path.join(yearPath, 'task-nested', 'archive.md'),
      archiveMarkdown: '# Nested archived task\n',
    }]);
  });

  it('keeps legacy flat JSON task archives readable', async () => {
    const contextPackName = 'sample-pack';
    const archiveRoot = path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      'context-packs',
      contextPackName,
      'archive',
      'tasks',
    );
    const yearPath = path.join(archiveRoot, '2026');
    installFiles(
      new Map<string, unknown>([
        [path.join(canonicalStore, 'task-ledger.json'), { entries: [] }],
        [path.join(canonicalStore, 'feedback-events.json'), { entries: [] }],
        [path.join(yearPath, 'legacy-task.json'), {
          task_id: 'legacy-task',
          task_title: 'Legacy archived task',
          difficulty_level: 'Small',
          workflow_status: 'completed',
        }],
        [path.join(yearPath, 'legacy-task.md'), '# Legacy archived task\n'],
      ]),
      new Map([
        [archiveRoot, [dirEntry('2026')]],
        [yearPath, [
          fileEntry('legacy-task.json'),
          fileEntry('legacy-task.planner-focus-snapshot.json'),
        ]],
      ]),
    );

    const result = await listReinforcementTasks(repoRoot, contextPackName, '2026');

    expect(result.tasks.map((task) => task.taskId)).toEqual(['legacy-task']);
  });
});
