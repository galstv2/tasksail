import path from 'node:path';
import { copyFile, cp, mkdir, readFile, stat } from 'node:fs/promises';

const MIGRATABLE_STORE_FILES = [
  'task-ledger.json',
  'agent-rewards.json',
  'settlements.json',
  'feedback-events.json',
  'global-realignment-doc.json',
] as const;

export function reinforcementRoot(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'reinforcement');
}

export function reinforcementStoreDir(repoRoot: string): string {
  return path.join(reinforcementRoot(repoRoot), 'store');
}

export function agentRewardsDir(repoRoot: string): string {
  return path.join(reinforcementRoot(repoRoot), 'agent-rewards');
}

export function legacyReinforcementStoreDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'reinforcement');
}

export function legacyAgentRewardsDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'agent-rewards');
}

export function reinforcementStoreFile(repoRoot: string, ...parts: string[]): string {
  return path.join(reinforcementStoreDir(repoRoot), ...parts);
}

export function legacyReinforcementStoreFile(repoRoot: string, ...parts: string[]): string {
  return path.join(legacyReinforcementStoreDir(repoRoot), ...parts);
}

export function agentRewardFile(repoRoot: string, filename: string): string {
  return path.join(agentRewardsDir(repoRoot), filename);
}

export function legacyAgentRewardFile(repoRoot: string, filename: string): string {
  return path.join(legacyAgentRewardsDir(repoRoot), filename);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function migrateLegacyReinforcementStore(repoRoot: string): Promise<void> {
  const canonical = reinforcementStoreDir(repoRoot);
  const legacy = legacyReinforcementStoreDir(repoRoot);
  if (!(await pathExists(legacy))) {
    return;
  }
  await mkdir(canonical, { recursive: true });
  for (const fileName of MIGRATABLE_STORE_FILES) {
    const src = path.join(legacy, fileName);
    const dest = path.join(canonical, fileName);
    if (await pathExists(src) && !(await pathExists(dest))) {
      await copyFile(src, dest);
    }
  }
  const legacyRealignment = path.join(legacy, 'realignment');
  const canonicalRealignment = path.join(canonical, 'realignment');
  if (await pathExists(legacyRealignment) && !(await pathExists(canonicalRealignment))) {
    await cp(legacyRealignment, path.join(canonical, 'realignment'), {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }
}

export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    // Absent/unreadable file is "no data" (null). The JSON.parse below is
    // intentionally OUTSIDE this catch so a corrupt store surfaces an error
    // instead of being silently masked as empty (which blanked the
    // reinforcement dashboard while real data sat on disk).
    return null;
  }
  return JSON.parse(raw) as T;
}

export async function readStoreJsonSafe<T>(
  repoRoot: string,
  ...parts: string[]
): Promise<T | null> {
  const canonical = await readJsonSafe<T>(reinforcementStoreFile(repoRoot, ...parts));
  if (canonical !== null) return canonical;
  return readJsonSafe<T>(legacyReinforcementStoreFile(repoRoot, ...parts));
}

export async function resolveReinforcementStoreFileForRead(
  repoRoot: string,
  ...parts: string[]
): Promise<string> {
  await migrateLegacyReinforcementStore(repoRoot);
  const canonical = reinforcementStoreFile(repoRoot, ...parts);
  if (await pathExists(canonical)) {
    return canonical;
  }
  const legacy = legacyReinforcementStoreFile(repoRoot, ...parts);
  if (await pathExists(legacy)) {
    return legacy;
  }
  return canonical;
}
