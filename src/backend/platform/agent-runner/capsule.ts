import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Paths exposed by a Dalton capsule — CWD-only isolation.
 */
export interface DaltonCapsulePaths {
  /** Root of the temporary directory. */
  rootDir: string;
  /** Working directory for the agent process (same as rootDir). */
  cwd: string;
}

/**
 * Create a minimal Dalton capsule: an isolated tmpdir used as the agent CWD.
 * No artifact staging, no handoff seeding, no slice copying.
 */
export async function createDaltonCapsule(): Promise<DaltonCapsulePaths> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'dalton-capsule-'));
  return { rootDir, cwd: rootDir };
}

/**
 * Remove the capsule tmpdir. Safe to call even if the directory is already gone.
 */
export async function cleanupDaltonCapsule(capsule: DaltonCapsulePaths | undefined): Promise<void> {
  if (!capsule) return;
  await rm(capsule.rootDir, { recursive: true, force: true });
}
