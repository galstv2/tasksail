import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  ensureEnvFile,
  upsertEnvVar,
  resolvePath,
  findRepoRoot,
  runPython,
  createLogger,
} from '../core/index.js';
import {
  type ActivateOptions,
  type ValidationResult,
} from './types.js';
import { rebuildAgentMirror } from './rebuildAgentMirror.js';

const log = createLogger('platform/context-pack/activate');

/** Env var key for the active context pack directory. */
export const ACTIVE_CONTEXT_PACK_DIR_KEY = 'ACTIVE_CONTEXT_PACK_DIR';

/**
 * UI-only: Set or clear the ACTIVE_CONTEXT_PACK_DIR env var in the repo .env
 * file and update `.platform-state/workspace-context-sync.json` (UI state only).
 *
 * Pass an empty string to clear.
 *
 * @ui-only This function writes UI state (`.env` + `workspace-context-sync.json`)
 * and MUST NOT be called from task activation. Task activation writes the
 * per-task `.task.json` sidecar instead (§3.1). Callers in the `queue/` module
 * MUST NOT invoke this function.
 */
export async function setActiveContextPackEnv(
  repoRoot: string,
  contextPackDir: string,
): Promise<void> {
  await ensureEnvFile(repoRoot);
  const envPath = path.join(repoRoot, '.env');
  await upsertEnvVar(envPath, ACTIVE_CONTEXT_PACK_DIR_KEY, contextPackDir);
}

/**
 * Validate that a context pack directory has the expected structure.
 *
 * Checks for the qmd/repo-sources.json manifest.
 * Returns a ValidationResult with errors and warnings.
 */
export function validatePackStructure(
  contextPackDir: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(contextPackDir)) {
    errors.push(`Context pack directory does not exist: ${contextPackDir}`);
    return { valid: false, errors, warnings };
  }

  let supportedInputs = 0;

  const qmdManifest = path.join(contextPackDir, 'qmd', 'repo-sources.json');
  if (existsSync(qmdManifest)) {
    supportedInputs++;
  } else {
    warnings.push(
      'Missing qmd/repo-sources.json. Dry-run seeding cannot be prepared.',
    );
  }

  if (supportedInputs === 0) {
    errors.push(
      'Context pack contains no qmd/repo-sources.json.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Full activation flow: validate pack, update .env with active context pack dir.
 */
export async function activateContextPack(
  options: ActivateOptions,
): Promise<{
  validation: ValidationResult;
  contextPackDir?: string;
}> {
  const repoRoot = findRepoRoot();
  const contextPackDir = resolvePath(repoRoot, options.contextPackDir);

  const validation = validatePackStructure(contextPackDir);
  if (!validation.valid) {
    return { validation };
  }

  if (!options.dryRun) {
    // Lazy v1→v2 manifest upgrade (idempotent for v2 packs).
    // Runs before setActiveContextPackEnv so the agent mirror is rebuilt
    // from the upgraded manifest, not the old v1 one.
    const upgradeScript = path.join(
      repoRoot,
      'src',
      'backend',
      'scripts',
      'python',
      'upgrade-pack-on-activate.py',
    );
    await runPython(
      upgradeScript,
      ['--context-pack-dir', contextPackDir, '--repo-root', repoRoot],
      { cwd: repoRoot },
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Context pack manifest upgrade failed: ${msg}`);
    });

    await setActiveContextPackEnv(repoRoot, contextPackDir);

    // Activation is the moment when agents start reading from this pack, so
    // ensure the agent-facing mirror under AgentWorkSpace/qmd/context-packs/
    // matches the canonical archive. Best-effort: a copy failure must not
    // block activation — the mirror is forensic data, not on the critical
    // path. Failures are surfaced via stderr for operator visibility.
    try {
      await rebuildAgentMirror(repoRoot, contextPackDir);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('agent_mirror.rebuild.failed', { contextPackDir, error: message });
    }
  }

  return { validation, contextPackDir };
}
