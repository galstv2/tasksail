import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { findRepoRoot } from '../core/index.js';
import { getActiveProvider } from '../cli-provider/index.js';
import {
  agentRewardsDir,
  legacyAgentRewardsDir,
  readJsonSafe,
  readStoreJsonSafe,
} from './reinforcementPaths.js';

export interface ReinforcementOverview {
  totalTasks: number;
  totalReward: number;
  unrewardedCount: number;
  streakProgress: number;
  streakThreshold: number;
  lastSettlementId: string | null;
  agents: AgentRewardSummary[];
}

export interface AgentRewardSummary {
  agentId: string;
  role: string;
  multiplier: number;
  lifetimeReward: number;
  unrewardedTaskCount: number;
  unrewardedRewardTotal: number;
}

export interface TaskLedgerEntry {
  taskId: string;
  title: string;
  difficulty: string;
  effectiveReward: number;
  settlementStatus: 'unrewarded' | 'rewarded';
  qualityOutcome: string;
  year: string;
  reviewStatus: 'unreviewed' | 'reviewed';
  feedbackCount: number;
  archivePath: string;
  archiveMarkdown: string;
}

export interface RealignmentSessionEntry {
  realignmentId: string;
  triggerTaskId: string;
  triggerFeedbackId: string;
  participatingAgents: string[];
  failureAnalysis: string;
  rootCause: string;
  correctiveActions: string[];
  status: string;
  meetingNotes: string;
  createdAt: string;
}

export interface GlobalRealignmentDocData {
  standingExpectations: string[];
  behavioralGuidance?: string[];
  lessonsLearned?: string[];
  fairnessFraming?: string[];
  version: number;
  updatedAt: string;
}

type JsonRecord = Record<string, unknown>;
type ArchiveCandidate = {
  fallbackName: string;
  jsonPath: string;
  markdownPath: string;
};
type RealignmentJobReceipt = {
  status?: string;
  reason?: string;
};

const SETTLEMENT_STREAK_THRESHOLD = 10;

export async function readReinforcementOverview(
  repoRoot: string = findRepoRoot(),
): Promise<ReinforcementOverview> {
  const [ledgerData, settlementsData, agents] = await Promise.all([
    readStoreJsonSafe<JsonRecord>(repoRoot, 'task-ledger.json'),
    readStoreJsonSafe<JsonRecord>(repoRoot, 'settlements.json'),
    readAgentRewards(repoRoot),
  ]);

  const entries = Array.isArray(ledgerData?.entries) ? ledgerData.entries as JsonRecord[] : [];
  const totalTasks = entries.length;
  const totalReward = entries.reduce(
    (sum, e) => sum + (typeof e.effective_reward === 'number' ? e.effective_reward : 0),
    0,
  );
  const unrewardedCount = entries.filter(
    (e) => e.settlement_status === 'unrewarded' && e.quality_outcome === 'success',
  ).length;

  let streakProgress = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as JsonRecord;
    if (e.settlement_status === 'unrewarded' && e.quality_outcome === 'success') {
      streakProgress++;
    } else {
      break;
    }
  }

  const settlements = Array.isArray(settlementsData?.entries) ? settlementsData.entries as JsonRecord[] : [];
  const lastSettlementId = settlements.length > 0
    ? String((settlements[settlements.length - 1] as JsonRecord).settlement_id ?? '')
    : null;

  return {
    totalTasks,
    totalReward,
    unrewardedCount,
    streakProgress,
    streakThreshold: SETTLEMENT_STREAK_THRESHOLD,
    lastSettlementId,
    agents,
  };
}

/**
 * Read per-agent reward summaries from private per-agent JSON sidecars.
 * Never falls back to shared agent-rewards.json to maintain agent privacy.
 */
export async function readAgentRewards(
  repoRoot: string = findRepoRoot(),
): Promise<AgentRewardSummary[]> {
  const registryPath = path.join(repoRoot, getActiveProvider(repoRoot).agentConfigPaths().registry);
  const multiplierMap = await buildMultiplierMap(registryPath);

  const canonicalDir = agentRewardsDir(repoRoot);
  let aDir = canonicalDir;
  let files = await readdir(canonicalDir).catch(() => [] as string[]);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    const legacyDir = legacyAgentRewardsDir(repoRoot);
    const legacyFiles = await readdir(legacyDir).catch(() => [] as string[]);
    const legacyJsonFiles = legacyFiles.filter((f) => f.endsWith('.json'));
    if (legacyJsonFiles.length > 0) {
      aDir = legacyDir;
      files = legacyFiles;
    }
  }
  const selectedJsonFiles = files.filter((f) => f.endsWith('.json'));
  const loaded = await Promise.all(
    selectedJsonFiles.map((file) => readJsonSafe<JsonRecord>(path.join(aDir, file))),
  );
  const getMultiplier = (agentId: string): number => multiplierMap.get(agentId) ?? 1.0;
  return loaded.filter((d): d is JsonRecord => d !== null).map((e) => mapAgentReward(e, getMultiplier));
}

async function buildMultiplierMap(registryPath: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const raw = await readFile(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as { agents?: JsonRecord[] };
    const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];
    for (const agent of agents) {
      const agentId = String(agent.agent_id ?? '');
      const val = agent.reward_multiplier;
      const multiplier = typeof val === 'number' && isFinite(val) ? val : 1.0;
      if (agentId) {
        map.set(agentId, multiplier);
      }
    }
  } catch {
    // Registry unreadable — all agents default to 1.0
  }
  return map;
}

function mapAgentReward(e: JsonRecord, getMultiplier: (agentId: string) => number): AgentRewardSummary {
  const agentId = String(e.agent_id ?? '');
  return {
    agentId,
    role: String(e.role ?? ''),
    multiplier: getMultiplier(agentId),
    lifetimeReward: typeof e.lifetime_reward === 'number' ? e.lifetime_reward : 0,
    unrewardedTaskCount: typeof e.unrewarded_task_count === 'number' ? e.unrewarded_task_count : 0,
    unrewardedRewardTotal: typeof e.unrewarded_reward_total === 'number' ? e.unrewarded_reward_total : 0,
  };
}

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * List completed tasks from the active context pack's QMD archive tree.
 *
 * Source: ``AgentWorkSpace/qmd/context-packs/<contextPackName>/archive/tasks/<year>/<task>/archive.json``
 *
 * Each JSON sidecar contains task metadata including difficulty and reward
 * fields set during archival.  The task ledger
 * (``AgentWorkSpace/qmd/global/reinforcement/store/task-ledger.json``) is consulted for
 * settlement status since the archive sidecar does not carry it.
 */
export async function listReinforcementTasks(
  repoRoot: string = findRepoRoot(),
  contextPackName?: string,
  year?: string,
): Promise<{ tasks: TaskLedgerEntry[]; availableYears: string[] }> {
  if (!contextPackName) {
    return { tasks: [], availableYears: [] };
  }

  const archiveRoot = path.join(
    repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs',
    contextPackName, 'archive', 'tasks',
  );

  let yearDirs: string[];
  try {
    const entries = await readdir(archiveRoot, { withFileTypes: true });
    yearDirs = entries
      .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return { tasks: [], availableYears: [] };
  }

  const availableYears = [...yearDirs].sort().reverse();
  const targetYears = year ? yearDirs.filter((y) => y === year) : yearDirs;

  // Load settlement status and effective reward from the task ledger.
  const ledgerData = await readStoreJsonSafe<JsonRecord>(repoRoot, 'task-ledger.json');
  const ledgerEntries = Array.isArray(ledgerData?.entries) ? ledgerData.entries as JsonRecord[] : [];
  const ledgerMap = new Map<string, { status: string; reward: number }>();
  for (const le of ledgerEntries) {
    ledgerMap.set(String(le.task_id ?? ''), {
      status: String(le.settlement_status ?? 'unrewarded'),
      reward: typeof le.effective_reward === 'number' ? le.effective_reward : 0,
    });
  }

  const feedbackData = await readStoreJsonSafe<JsonRecord>(repoRoot, 'feedback-events.json');
  const feedbackEntries = Array.isArray(feedbackData?.entries) ? feedbackData.entries as JsonRecord[] : [];
  const feedbackCountByTask = new Map<string, number>();
  for (const entry of feedbackEntries) {
    const taskId = String(entry.task_id ?? '');
    if (!taskId) continue;
    feedbackCountByTask.set(taskId, (feedbackCountByTask.get(taskId) ?? 0) + 1);
  }

  const tasks: TaskLedgerEntry[] = [];
  for (const yr of targetYears) {
    const yearPath = path.join(archiveRoot, yr);
    let candidates: ArchiveCandidate[];
    try {
      const entries = await readdir(yearPath, { withFileTypes: true });
      candidates = entries.flatMap((entry) => {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) {
            return [];
          }
          return [{
            fallbackName: entry.name,
            jsonPath: path.join(yearPath, entry.name, 'archive.json'),
            markdownPath: path.join(yearPath, entry.name, 'archive.md'),
          }];
        }
        if (
          !entry.isFile() ||
          !entry.name.endsWith('.json') ||
          entry.name.endsWith('.planner-focus-snapshot.json')
        ) {
          return [];
        }
        return [{
          fallbackName: path.basename(entry.name, '.json'),
          jsonPath: path.join(yearPath, entry.name),
          markdownPath: path.join(yearPath, `${path.basename(entry.name, '.json')}.md`),
        }];
      });
    } catch {
      continue;
    }
    for (const candidate of candidates) {
      const data = await readJsonSafe<JsonRecord>(candidate.jsonPath);
      if (!data) continue;
      const taskId = String(data.task_id ?? candidate.fallbackName);
      const ledgerEntry = ledgerMap.get(taskId);
      const feedbackCount = feedbackCountByTask.get(taskId) ?? 0;
      tasks.push({
        taskId,
        title: String(data.task_title ?? taskId),
        difficulty: String(data.difficulty_level ?? '').toLowerCase(),
        effectiveReward: ledgerEntry?.reward ?? 0,
        settlementStatus: ledgerEntry?.status === 'rewarded' ? 'rewarded' : 'unrewarded',
        qualityOutcome: String(data.workflow_status ?? ''),
        year: yr,
        reviewStatus: feedbackCount > 0 ? 'reviewed' : 'unreviewed',
        feedbackCount,
        archivePath: candidate.markdownPath,
        archiveMarkdown: await readTextSafe(candidate.markdownPath),
      });
    }
  }

  // Most recent first — enables prefill of the most relevant task.
  tasks.sort((a, b) => {
    if (a.year !== b.year) return b.year.localeCompare(a.year);
    return b.taskId.localeCompare(a.taskId);
  });

  return { tasks, availableYears };
}

export async function listRealignmentSessions(
  repoRoot: string = findRepoRoot(),
): Promise<RealignmentSessionEntry[]> {
  const data = await readStoreJsonSafe<JsonRecord>(
    repoRoot, 'realignment', 'sessions.json',
  );
  if (!data || !Array.isArray(data.entries)) return [];
  const sessions = await Promise.all((data.entries as JsonRecord[]).map(async (e) => {
    const realignmentId = String(e.realignment_id ?? '');
    return {
      realignmentId,
      triggerTaskId: String(e.trigger_task_id ?? ''),
      triggerFeedbackId: String(e.trigger_feedback_id ?? ''),
      participatingAgents: Array.isArray(e.participating_agents) ? e.participating_agents as string[] : [],
      failureAnalysis: String(e.failure_analysis ?? ''),
      rootCause: String(e.root_cause ?? ''),
      correctiveActions: Array.isArray(e.corrective_actions) ? e.corrective_actions as string[] : [],
      status: await visibleRealignmentStatus(repoRoot, realignmentId, String(e.status ?? '')),
      meetingNotes: String(e.meeting_notes ?? ''),
      createdAt: String(e.created_at ?? ''),
    };
  }));
  // Most recent first.
  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sessions;
}

async function visibleRealignmentStatus(
  repoRoot: string,
  realignmentId: string,
  storedStatus: string,
): Promise<string> {
  if (!realignmentId || storedStatus === 'archived') {
    return storedStatus;
  }
  const receipt = await readJsonSafe<RealignmentJobReceipt>(path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'realignment',
    realignmentId,
    'job.json',
  ));
  if (receipt?.status === 'running') {
    return 'running';
  }
  if (receipt?.status === 'error' && storedStatus === 'open') {
    return 'error';
  }
  return storedStatus;
}

export async function readGlobalRealignmentDoc(
  repoRoot: string = findRepoRoot(),
): Promise<GlobalRealignmentDocData> {
  const data = await readStoreJsonSafe<JsonRecord>(
    repoRoot, 'global-realignment-doc.json',
  );
  if (!data) {
    return {
      standingExpectations: [],
      version: 0,
      updatedAt: '',
    };
  }
  return {
    standingExpectations: Array.isArray(data.standing_expectations) ? data.standing_expectations as string[] : [],
    behavioralGuidance: Array.isArray(data.behavioral_guidance) ? data.behavioral_guidance as string[] : undefined,
    lessonsLearned: Array.isArray(data.lessons_learned) ? data.lessons_learned as string[] : undefined,
    fairnessFraming: Array.isArray(data.fairness_framing) ? data.fairness_framing as string[] : undefined,
    version: typeof data.version === 'number' ? data.version : 0,
    updatedAt: String(data.updated_at ?? ''),
  };
}
