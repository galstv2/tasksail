import path from 'node:path';
import { createLogger } from '../core/logger.js';
import {
  buildDefaultFs,
  materializeExtension,
  readImportReceipt,
  computeRuntimeCopyDigest,
  isReceiptConsistentWithEntry,
} from './materialize.js';
import { readSourceManifest } from './sourceManifest.js';
import { runtimeCopyDir } from './ids.js';
import { withAgentExtensionsLock } from './lock.js';
import type {
  AgentExtensionFsAdapter,
  AgentExtensionMutationSeams,
  AgentExtensionReconcileOptions,
  AgentExtensionReconcileResult,
  AgentExtensionSourceManifestEntry,
} from './types.js';

const log = createLogger('platform/agent-extensions/reconcile');

function platformStateDir(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state');
}

async function reconcileEntry(
  repoRoot: string,
  entry: AgentExtensionSourceManifestEntry,
  fs: AgentExtensionFsAdapter,
  seams: AgentExtensionMutationSeams,
): Promise<'ok' | 'materialized' | 'repaired' | 'unavailable'> {
  const psDir = platformStateDir(repoRoot);
  const runtimePath = runtimeCopyDir(psDir, entry.kind, entry.id);

  const receipt = await readImportReceipt(repoRoot, entry.kind, entry.id, fs);
  const runtimeExists = await fs.pathExists(runtimePath);

  // A receipt counts as valid only when it is present, identifies this entry, and (for
  // git) has a resolved commit_sha. A missing copy or invalid receipt triggers repair.
  const receiptValid =
    receipt !== null &&
    isReceiptConsistentWithEntry(receipt, entry, runtimePath) &&
    !(entry.source.type === 'git' && !receipt.commit_sha);

  if (!runtimeExists || !receiptValid) {
    // Missing copy or invalid/mismatched receipt — re-materialize.
    try {
      await materializeExtension(repoRoot, entry, seams);
      // A present-but-invalid copy is a repair; a wholly missing copy is a fresh materialize.
      return runtimeExists ? 'repaired' : 'materialized';
    } catch (err) {
      const reasonCode = (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') ? (err as unknown as { code: string }).code : 'materialize-failed';
      log.progress({
        level: 'warn',
        event: 'agent_extensions.reconcile.entry_unavailable',
        extra: { id: entry.id, kind: entry.kind, providerId: entry.provider_id, sourceType: entry.source.type, reasonCode },
        text: `[agent-extensions] reconcile.entry_unavailable: "${entry.id}" could not be materialized`,
      });
      return 'unavailable';
    }
  }

  // Check for drift via source_digest (receipt is valid and non-null here).
  if (receipt !== null && receipt.source_digest) {
    const currentDigest = await computeRuntimeCopyDigest(runtimePath, fs);
    if (currentDigest !== null && currentDigest !== receipt.source_digest) {
      // Drift detected — re-materialize to repair
      try {
        await materializeExtension(repoRoot, entry, {
          ...seams,
          now: seams.now,
        });
        return 'repaired';
      } catch (err) {
        const reasonCode = (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') ? (err as unknown as { code: string }).code : 'repair-failed';
        log.progress({
          level: 'warn',
          event: 'agent_extensions.reconcile.entry_unavailable',
          extra: { id: entry.id, kind: entry.kind, providerId: entry.provider_id, sourceType: entry.source.type, reasonCode },
          text: `[agent-extensions] reconcile.entry_unavailable: "${entry.id}" drift repair failed`,
        });
        return 'unavailable';
      }
    }
  }

  return 'ok';
}

export async function reconcileAgentExtensions(
  repoRoot: string,
  options?: AgentExtensionReconcileOptions,
): Promise<AgentExtensionReconcileResult> {
  const fs = options?.fs ?? buildDefaultFs();
  const seams: AgentExtensionMutationSeams = {
    fs,
    execFile: options?.execFile,
    now: options?.now,
  };

  log.progress({
    level: 'info',
    event: 'agent_extensions.reconcile.started',
    extra: {},
    text: '[agent-extensions] reconcile.started',
  });

  const result: AgentExtensionReconcileResult = {
    materialized: 0,
    repaired: 0,
    unavailable: 0,
  };

  // Acquire lock first; read manifest while holding the lock (spec single-writer rule)
  try {
    await withAgentExtensionsLock(repoRoot, 'reconcileAgentExtensions', async () => {
      let manifest;
      try {
        manifest = await readSourceManifest(repoRoot, fs);
      } catch (err) {
        const reasonCode = (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') ? (err as unknown as { code: string }).code : 'manifest-read-failed';
        log.progress({
          level: 'warn',
          event: 'agent_extensions.reconcile.entry_unavailable',
          extra: { reasonCode },
          text: '[agent-extensions] reconcile: source manifest could not be read',
        });
        log.progress({
          level: 'info',
          event: 'agent_extensions.reconcile.completed',
          extra: { materialized: 0, repaired: 0, unavailable: 0 },
          text: '[agent-extensions] reconcile.completed (manifest unreadable)',
        });
        return;
      }
      for (const entry of manifest.extensions) {
        const outcome = await reconcileEntry(repoRoot, entry, fs, seams);
        if (outcome === 'materialized') result.materialized++;
        else if (outcome === 'repaired') result.repaired++;
        else if (outcome === 'unavailable') result.unavailable++;
      }
    });
  } catch (err) {
    // Lock busy or unexpected error — log and return zero counts
    const reasonCode =
      err instanceof Error && err.message.includes('blocked')
        ? 'mutex-busy'
        : (err instanceof Error && typeof (err as { code?: unknown }).code === 'string')
          ? (err as unknown as { code: string }).code
          : 'reconcile-unexpected-error';
    log.progress({
      level: 'warn',
      event: 'agent_extensions.reconcile.entry_unavailable',
      extra: { reasonCode },
      text: `[agent-extensions] reconcile skipped: ${reasonCode}`,
    });
    // Return zero — manifest count is unknown when lock is busy; reconcile is idempotent
    return { materialized: 0, repaired: 0, unavailable: 0 };
  }

  log.progress({
    level: 'info',
    event: 'agent_extensions.reconcile.completed',
    extra: { ...result },
    text: `[agent-extensions] reconcile.completed (materialized=${result.materialized} repaired=${result.repaired} unavailable=${result.unavailable})`,
  });

  return result;
}
