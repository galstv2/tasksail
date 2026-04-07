import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { findRepoRoot } from '../core/index.js';

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

// ── JSON helpers ───────────────────────────────────────────────────────────

export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type JsonRecord = Record<string, unknown>;

export function reinforcementDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'reinforcement');
}

function agentRewardsDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'agent-rewards');
}

// ── Read functions ─────────────────────────────────────────────────────────

const SETTLEMENT_STREAK_THRESHOLD = 10;

export async function readReinforcementOverview(
  repoRoot: string = findRepoRoot(),
): Promise<ReinforcementOverview> {
  const rDir = reinforcementDir(repoRoot);

  const [ledgerData, settlementsData, agents] = await Promise.all([
    readJsonSafe<JsonRecord>(path.join(rDir, 'task-ledger.json')),
    readJsonSafe<JsonRecord>(path.join(rDir, 'settlements.json')),
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
  const aDir = agentRewardsDir(repoRoot);
  const files = await readdir(aDir).catch(() => [] as string[]);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const loaded = await Promise.all(
    jsonFiles.map((file) => readJsonSafe<JsonRecord>(path.join(aDir, file))),
  );
  return loaded.filter((d): d is JsonRecord => d !== null).map(mapAgentReward);
}

function mapAgentReward(e: JsonRecord): AgentRewardSummary {
  return {
    agentId: String(e.agent_id ?? ''),
    role: String(e.role ?? ''),
    multiplier: typeof e.multiplier === 'number' ? e.multiplier : 0,
    lifetimeReward: typeof e.lifetime_reward === 'number' ? e.lifetime_reward : 0,
    unrewardedTaskCount: typeof e.unrewarded_task_count === 'number' ? e.unrewarded_task_count : 0,
    unrewardedRewardTotal: typeof e.unrewarded_reward_total === 'number' ? e.unrewarded_reward_total : 0,
  };
}

/**
 * List completed tasks from the active context pack's QMD archive tree.
 *
 * Source: ``AgentWorkSpace/qmd/context-packs/<contextPackName>/archive/tasks/<year>/*.json``
 *
 * Each JSON sidecar contains task metadata including difficulty and reward
 * fields set during archival.  The task ledger
 * (``AgentWorkSpace/qmd/reinforcement/task-ledger.json``) is consulted for
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
  const rDir = reinforcementDir(repoRoot);
  const ledgerData = await readJsonSafe<JsonRecord>(path.join(rDir, 'task-ledger.json'));
  const ledgerEntries = Array.isArray(ledgerData?.entries) ? ledgerData.entries as JsonRecord[] : [];
  const ledgerMap = new Map<string, { status: string; reward: number }>();
  for (const le of ledgerEntries) {
    ledgerMap.set(String(le.task_id ?? ''), {
      status: String(le.settlement_status ?? 'unrewarded'),
      reward: typeof le.effective_reward === 'number' ? le.effective_reward : 0,
    });
  }

  const tasks: TaskLedgerEntry[] = [];
  for (const yr of targetYears) {
    const yearPath = path.join(archiveRoot, yr);
    let files: string[];
    try {
      files = (await readdir(yearPath)).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      const data = await readJsonSafe<JsonRecord>(path.join(yearPath, file));
      if (!data) continue;
      const taskId = String(data.task_id ?? '');
      const ledgerEntry = ledgerMap.get(taskId);
      tasks.push({
        taskId,
        title: String(data.task_title ?? taskId),
        difficulty: String(data.difficulty_level ?? '').toLowerCase(),
        effectiveReward: ledgerEntry?.reward ?? 0,
        settlementStatus: ledgerEntry?.status === 'rewarded' ? 'rewarded' : 'unrewarded',
        qualityOutcome: String(data.workflow_status ?? ''),
        year: yr,
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
  const rDir = reinforcementDir(repoRoot);
  const sessionsDir = path.join(rDir, 'realignment');
  const data = await readJsonSafe<JsonRecord>(path.join(sessionsDir, 'sessions.json'));
  if (!data || !Array.isArray(data.entries)) return [];
  const sessions = (data.entries as JsonRecord[]).map((e) => ({
    realignmentId: String(e.realignment_id ?? ''),
    triggerTaskId: String(e.trigger_task_id ?? ''),
    triggerFeedbackId: String(e.trigger_feedback_id ?? ''),
    participatingAgents: Array.isArray(e.participating_agents) ? e.participating_agents as string[] : [],
    failureAnalysis: String(e.failure_analysis ?? ''),
    rootCause: String(e.root_cause ?? ''),
    correctiveActions: Array.isArray(e.corrective_actions) ? e.corrective_actions as string[] : [],
    status: String(e.status ?? ''),
    meetingNotes: String(e.meeting_notes ?? ''),
    createdAt: String(e.created_at ?? ''),
  }));
  // Most recent first.
  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sessions;
}

export async function readGlobalRealignmentDoc(
  repoRoot: string = findRepoRoot(),
): Promise<GlobalRealignmentDocData> {
  const rDir = reinforcementDir(repoRoot);
  const data = await readJsonSafe<JsonRecord>(path.join(rDir, 'global-realignment-doc.json'));
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
