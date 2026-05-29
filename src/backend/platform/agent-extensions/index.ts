import path from 'node:path';
import { createLogger } from '../core/logger.js';
import {
  buildDefaultFs,
  materializeExtension,
  readImportReceipt,
  reseedExtension,
  isReceiptConsistentWithEntry,
} from './materialize.js';
import { readSourceManifest, writeSourceManifest } from './sourceManifest.js';
import { inspectAgentExtensionMetadata } from './metadata.js';
import {
  loadAgentLaunchExtensionAssignments,
  saveAgentLaunchExtensionAssignments,
  loadAssignments,
  persistAssignments,
  removeExtensionFromAssignments,
} from './assignment.js';
import { reconcileAgentExtensions } from './reconcile.js';
import { withAgentExtensionsLock } from './lock.js';
import {
  extensionError,
  runtimeCopyDir,
  importReceiptPath,
  isValidExtensionId,
  validatePluginDirectAttachment,
} from './ids.js';
import type {
  AgentExtensionAddRequest,
  AgentExtensionAddSource,
  AgentExtensionDeleteOptions,
  AgentExtensionFsAdapter,
  AgentExtensionMutationSeams,
  AgentExtensionRendererCatalogEntry,
  AgentExtensionRuntimeCatalogEntry,
  AgentExtensionSource,
  AgentExtensionSourceManifestEntry,
  AgentExtensionsSourceManifest,
} from './types.js';

export type {
  AgentExtensionKind,
  AgentExtensionSourceType,
  AgentExtensionProviderId,
  AgentExtensionAgentId,
  AgentExtensionSource,
  AgentExtensionSourceManifestEntry,
  AgentExtensionRuntimeCatalogEntry,
  AgentExtensionRendererCatalogEntry,
  AgentExtensionImportReceipt,
  AgentExtensionsSourceManifest,
  AgentLaunchExtensionAssignments,
  AgentExtensionCatalogListResponse,
  AgentExtensionAssignmentListResponse,
  AgentExtensionAddRequest,
  AgentExtensionReconcileResult,
  AgentExtensionFsAdapter,
  ExtensionExecFile,
  AgentExtensionMutationSeams,
  AgentExtensionReconcileOptions,
  AgentExtensionStageStatus,
  AgentExtensionStageEntry,
  AgentExtensionStageManifest,
  AgentExtensionAvailabilityEntry,
  ResolvedAgentExtensionStage,
  CreateAgentExtensionStageOptions,
} from './types.js';

export {
  reconcileAgentExtensions,
  loadAgentLaunchExtensionAssignments,
  saveAgentLaunchExtensionAssignments,
  inspectAgentExtensionMetadata,
};

export {
  createAgentExtensionStage,
  cleanupAgentExtensionStage,
  recoverAgentExtensionStagesOnStartup,
  loadAgentExtensionRuntimeCatalogForStaging,
  resolveAgentExtensionStageRoot,
  resolveAgentExtensionStageDir,
  assertValidAgentExtensionLaunchId,
  stageCopyDirectory,
} from './stage.js';

const log = createLogger('platform/agent-extensions');

function platformStateDir(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state');
}

// Resolve an add-request source into a durable manifest source. For direct attachment
// this writes config/skill-authored/<id>/SKILL.md atomically; the caller invokes this
// while holding withAgentExtensionsLock and after id+duplicate validation, so the
// authored write stays inside the single-writer transaction (never orphaned by a
// duplicate-id rejection). config_path is derived from the already-validated id slug,
// so it cannot escape the repository.
async function resolveAddSource(
  repoRoot: string,
  id: string,
  source: AgentExtensionAddSource,
  fs: AgentExtensionFsAdapter,
): Promise<AgentExtensionSource> {
  if (source.type === 'direct-attachment') {
    const configPath = `config/skill-authored/${id}/SKILL.md`;
    const absPath = path.join(repoRoot, configPath);
    try {
      await fs.ensureDir(path.dirname(absPath));
      await fs.writeTextFileAtomic(absPath, source.skill_markdown);
    } catch {
      throw extensionError('direct-attachment-write-failed', 'Failed to write the authored skill file.');
    }
    return { type: 'direct-attachment', config_path: configPath };
  }
  return source;
}

// Best-effort removal of every artifact an add could have created (authored file, runtime
// copy, receipt), invoked on any failure after id+duplicate validation. The duplicate-id
// check guarantees no live catalog entry references these paths, so a failed add — including
// one that fails at the final manifest write — leaves no orphaned artifact. Idempotent: each
// rm tolerates a missing target.
async function cleanupFailedAdd(
  repoRoot: string,
  request: AgentExtensionAddRequest,
  fs: AgentExtensionFsAdapter,
): Promise<void> {
  const psDir = platformStateDir(repoRoot);
  await fs.rm(runtimeCopyDir(psDir, request.kind, request.id)).catch(() => undefined);
  await fs.rm(importReceiptPath(psDir, request.kind, request.id)).catch(() => undefined);
  if (request.source.type === 'direct-attachment') {
    await fs.rm(path.join(repoRoot, 'config', 'skill-authored', request.id)).catch(() => undefined);
  }
}

function toRendererEntry(
  entry: AgentExtensionSourceManifestEntry,
  runtimeCatalog: AgentExtensionRuntimeCatalogEntry | null,
  status: 'available' | 'unavailable',
): AgentExtensionRendererCatalogEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    provider_id: entry.provider_id,
    display_name: entry.display_name,
    description: entry.description,
    enabled: entry.enabled,
    source_type: entry.source.type,
    imported_at: runtimeCatalog?.imported_at,
    reseeded_at: runtimeCatalog?.reseeded_at,
    status,
    metadata: runtimeCatalog?.metadata ?? {},
  };
}

async function deriveRendererEntry(
  repoRoot: string,
  entry: AgentExtensionSourceManifestEntry,
  fs: AgentExtensionFsAdapter,
): Promise<AgentExtensionRendererCatalogEntry> {
  const psDir = platformStateDir(repoRoot);
  const runtimePath = runtimeCopyDir(psDir, entry.kind, entry.id);
  const receipt = await readImportReceipt(repoRoot, entry.kind, entry.id, fs);
  const runtimeExists = await fs.pathExists(runtimePath);

  if (!runtimeExists || receipt === null) {
    return toRendererEntry(entry, null, 'unavailable');
  }

  // A receipt that does not match this entry's identity/source/runtime path is treated
  // as missing — a stale or corrupt receipt must not make an entry appear available.
  if (!isReceiptConsistentWithEntry(receipt, entry, runtimePath)) {
    return toRendererEntry(entry, null, 'unavailable');
  }

  if (entry.source.type === 'git' && !receipt.commit_sha) {
    return toRendererEntry(entry, null, 'unavailable');
  }

  const runtimeEntry: AgentExtensionRuntimeCatalogEntry = {
    ...entry,
    runtime_path: runtimePath,
    imported_at: receipt.imported_at,
    reseeded_at: receipt.reseeded_at,
    metadata: {},
  };

  // Best-effort metadata read from runtime copy
  try {
    const meta = await inspectAgentExtensionMetadata({
      providerId: entry.provider_id,
      kind: entry.kind,
      runtimePath,
    });
    runtimeEntry.metadata = meta.metadata;
  } catch {
    // Metadata unavailable — still available as long as receipt+copy are present
  }

  return toRendererEntry(entry, runtimeEntry, 'available');
}

export async function listAgentExtensions(
  repoRoot: string,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentExtensionRendererCatalogEntry[]> {
  const fs = seams?.fs ?? buildDefaultFs();
  const manifest = await readSourceManifest(repoRoot, fs);
  const results = await Promise.all(
    manifest.extensions.map((entry) => deriveRendererEntry(repoRoot, entry, fs)),
  );
  return results;
}

export async function addAgentExtension(
  repoRoot: string,
  request: AgentExtensionAddRequest,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentExtensionRendererCatalogEntry> {
  const fs = seams?.fs ?? buildDefaultFs();

  // Reject plugin direct-attachment before any IO
  if (request.kind === 'plugin') {
    const err = validatePluginDirectAttachment(request.source);
    if (err) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.add.failed',
        extra: { kind: request.kind, providerId: request.provider_id, sourceType: request.source.type, reasonCode: 'plugin-direct-attachment-rejected' },
        text: '[agent-extensions] catalog.add.failed: plugin direct-attachment rejected',
      });
      throw new Error(err);
    }
  }

  return withAgentExtensionsLock(repoRoot, 'addAgentExtension', async () => {
    const manifest = await readSourceManifest(repoRoot, fs);

    // The operator supplies a stable ID slug up front; display_name is filled
    // from materialized metadata below. Validate the slug before any IO.
    const tentativeId = request.id;

    if (!isValidExtensionId(tentativeId)) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.add.failed',
        extra: { id: tentativeId, kind: request.kind, providerId: request.provider_id, sourceType: request.source.type, reasonCode: 'invalid-id' },
        text: `[agent-extensions] catalog.add.failed: invalid id "${tentativeId}"`,
      });
      throw new Error(`Extension ID "${tentativeId}" does not match the required pattern.`);
    }

    if (manifest.extensions.some((e) => e.id === tentativeId)) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.add.failed',
        extra: { id: tentativeId, kind: request.kind, providerId: request.provider_id, sourceType: request.source.type, reasonCode: 'duplicate-id' },
        text: `[agent-extensions] catalog.add.failed: duplicate id "${tentativeId}"`,
      });
      throw new Error(`Extension ID "${tentativeId}" already exists in the catalog.`);
    }

    // Resolve the durable manifest source (writing the authored SKILL.md for
    // direct attachment) and materialize the runtime copy. Both run under the lock,
    // after id+duplicate validation, so a rejected add never writes authored content.
    let manifestSource: AgentExtensionSource;
    let runtimeEntry: AgentExtensionRuntimeCatalogEntry;
    try {
      manifestSource = await resolveAddSource(repoRoot, tentativeId, request.source, fs);
      const tempEntry: AgentExtensionSourceManifestEntry = {
        id: tentativeId,
        kind: request.kind,
        provider_id: request.provider_id,
        display_name: tentativeId,
        description: 'pending',
        enabled: true,
        source: manifestSource,
      };
      runtimeEntry = await materializeExtension(repoRoot, tempEntry, seams);
    } catch (err) {
      // A failed add must leave no orphaned artifact (authored file, runtime copy, receipt).
      await cleanupFailedAdd(repoRoot, request, fs);
      const reasonCode = (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') ? (err as unknown as { code: string }).code : 'materialize-failed';
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.add.failed',
        extra: { id: tentativeId, kind: request.kind, providerId: request.provider_id, sourceType: request.source.type, reasonCode },
        text: `[agent-extensions] catalog.add.failed: materialize failed for "${tentativeId}"`,
      });
      throw err;
    }

    // Inspect metadata from materialized copy
    let meta: Pick<AgentExtensionRuntimeCatalogEntry, 'display_name' | 'description' | 'metadata'>;
    try {
      meta = await inspectAgentExtensionMetadata({
        providerId: request.provider_id,
        kind: request.kind,
        runtimePath: runtimeEntry.runtime_path,
      });
    } catch (err) {
      // Runtime copy + receipt already exist here; remove them so the failed add is inert.
      await cleanupFailedAdd(repoRoot, request, fs);
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.add.failed',
        extra: { id: tentativeId, kind: request.kind, providerId: request.provider_id, sourceType: request.source.type, reasonCode: 'metadata-inspection-failed' },
        text: `[agent-extensions] catalog.add.failed: metadata inspection failed for "${tentativeId}"`,
      });
      throw err;
    }

    const finalEntry: AgentExtensionSourceManifestEntry = {
      id: tentativeId,
      kind: request.kind,
      provider_id: request.provider_id,
      display_name: meta.display_name,
      description: meta.description,
      enabled: true,
      source: manifestSource,
    };

    const nextManifest: AgentExtensionsSourceManifest = {
      schema_version: 1,
      extensions: [...manifest.extensions, finalEntry],
    };
    // Manifest write is the final durable step. If it fails after materialization,
    // clean up the runtime copy/receipt/authored file so no inert residue is left behind.
    try {
      await writeSourceManifest(repoRoot, nextManifest, fs);
    } catch (err) {
      await cleanupFailedAdd(repoRoot, request, fs);
      const reasonCode = (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') ? (err as unknown as { code: string }).code : 'manifest-write-failed';
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.add.failed',
        extra: { id: tentativeId, kind: request.kind, providerId: request.provider_id, sourceType: request.source.type, reasonCode },
        text: `[agent-extensions] catalog.add.failed: manifest write failed for "${tentativeId}"`,
      });
      throw err;
    }

    // Emit the catalog-add event here (not in materializeExtension), so startup
    // reconciliation — which also calls materializeExtension — never logs a user add.
    log.progress({
      level: 'info',
      event: 'agent_extensions.catalog.added',
      extra: { id: finalEntry.id, kind: finalEntry.kind, providerId: finalEntry.provider_id, sourceType: finalEntry.source.type },
      text: `[agent-extensions] catalog.added ${finalEntry.kind} "${finalEntry.id}"`,
    });

    return {
      id: finalEntry.id,
      kind: finalEntry.kind,
      provider_id: finalEntry.provider_id,
      display_name: finalEntry.display_name,
      description: finalEntry.description,
      enabled: finalEntry.enabled,
      source_type: finalEntry.source.type,
      imported_at: runtimeEntry.imported_at,
      reseeded_at: undefined,
      status: 'available' as const,
      metadata: meta.metadata,
    };
  });
}

export async function reseedAgentExtension(
  repoRoot: string,
  id: string,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentExtensionRendererCatalogEntry> {
  const fs = seams?.fs ?? buildDefaultFs();

  return withAgentExtensionsLock(repoRoot, 'reseedAgentExtension', async () => {
    const manifest = await readSourceManifest(repoRoot, fs);
    const entry = manifest.extensions.find((e) => e.id === id);
    if (!entry) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.reseed.failed',
        extra: { id, reasonCode: 'not-found' },
        text: `[agent-extensions] catalog.reseed.failed: "${id}" not found`,
      });
      throw new Error(`Extension "${id}" not found in the catalog.`);
    }

    const existingReceipt = await readImportReceipt(repoRoot, entry.kind, id, fs);

    let runtimeEntry: AgentExtensionRuntimeCatalogEntry;
    try {
      if (existingReceipt) {
        runtimeEntry = await reseedExtension(repoRoot, entry, existingReceipt, seams);
      } else {
        runtimeEntry = await materializeExtension(repoRoot, entry, seams);
      }
    } catch (err) {
      const reasonCode = (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') ? (err as unknown as { code: string }).code : 'materialize-failed';
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.reseed.failed',
        extra: { id, kind: entry.kind, providerId: entry.provider_id, sourceType: entry.source.type, reasonCode },
        text: `[agent-extensions] catalog.reseed.failed for "${id}"`,
      });
      throw err;
    }

    let meta: Pick<AgentExtensionRuntimeCatalogEntry, 'display_name' | 'description' | 'metadata'>;
    try {
      meta = await inspectAgentExtensionMetadata({
        providerId: entry.provider_id,
        kind: entry.kind,
        runtimePath: runtimeEntry.runtime_path,
      });
    } catch (err) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.reseed.failed',
        extra: { id, kind: entry.kind, providerId: entry.provider_id, sourceType: entry.source.type, reasonCode: 'metadata-inspection-failed' },
        text: `[agent-extensions] catalog.reseed.failed: metadata inspection failed for "${id}"`,
      });
      throw err;
    }

    // Update manifest with refreshed metadata
    const updatedEntry: AgentExtensionSourceManifestEntry = {
      ...entry,
      display_name: meta.display_name,
      description: meta.description,
    };
    const nextManifest: AgentExtensionsSourceManifest = {
      schema_version: 1,
      extensions: manifest.extensions.map((e) => (e.id === id ? updatedEntry : e)),
    };
    await writeSourceManifest(repoRoot, nextManifest, fs);

    // Emit the reseed event from the orchestrator (not materialize/reseedExtension),
    // so a reseed of an entry whose receipt was missing still logs as reseeded.
    log.progress({
      level: 'info',
      event: 'agent_extensions.catalog.reseeded',
      extra: { id, kind: entry.kind, providerId: entry.provider_id, sourceType: entry.source.type },
      text: `[agent-extensions] catalog.reseeded ${entry.kind} "${id}"`,
    });

    return {
      id,
      kind: entry.kind,
      provider_id: entry.provider_id,
      display_name: meta.display_name,
      description: meta.description,
      enabled: entry.enabled,
      source_type: entry.source.type,
      imported_at: runtimeEntry.imported_at,
      reseeded_at: runtimeEntry.reseeded_at,
      status: 'available' as const,
      metadata: meta.metadata,
    };
  });
}

export async function deleteAgentExtension(
  repoRoot: string,
  id: string,
  options?: AgentExtensionDeleteOptions,
  seams?: AgentExtensionMutationSeams,
): Promise<void> {
  const fs = seams?.fs ?? buildDefaultFs();
  const removeAssignments = options?.removeAssignments ?? false;

  return withAgentExtensionsLock(repoRoot, 'deleteAgentExtension', async () => {
    const manifest = await readSourceManifest(repoRoot, fs);
    const entry = manifest.extensions.find((e) => e.id === id);
    if (!entry) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.delete.failed',
        extra: { id, reasonCode: 'not-found' },
        text: `[agent-extensions] catalog.delete.failed: "${id}" not found`,
      });
      throw new Error(`Extension "${id}" not found in the catalog.`);
    }

    const psDir = platformStateDir(repoRoot);

    // Fail-closed unless the same request opts into clearing assignments.
    const currentAssignments = await loadAssignments(repoRoot, fs);
    const isAssigned = currentAssignments.assignments.some((a) => a.extension_ids.includes(id));
    if (isAssigned && !removeAssignments) {
      log.progress({
        level: 'warn',
        event: 'agent_extensions.catalog.delete.failed',
        extra: { id, reasonCode: 'delete-blocked-by-active-assignment' },
        text: `[agent-extensions] catalog.delete.failed: "${id}" is referenced by active assignments`,
      });
      throw extensionError(
        'delete-blocked-by-active-assignment',
        `Cannot delete "${id}" while it is assigned to one or more agents. Remove the assignment first, then delete.`,
      );
    }

    // Delete-transaction order: assignment write first (so the entry ID is gone from
    // every agent), then runtime copy → receipt → source manifest last. Manifest-last
    // means a mid-delete crash leaves an entry that reconciliation re-materializes.
    if (isAssigned) {
      const cleared = removeExtensionFromAssignments(currentAssignments, id);
      await persistAssignments(repoRoot, cleared, fs);
    }

    const runtimePath = runtimeCopyDir(psDir, entry.kind, id);
    await fs.rm(runtimePath);

    const receiptPath = importReceiptPath(psDir, entry.kind, id);
    await fs.rm(receiptPath);

    const nextManifest: AgentExtensionsSourceManifest = {
      schema_version: 1,
      extensions: manifest.extensions.filter((e) => e.id !== id),
    };
    await writeSourceManifest(repoRoot, nextManifest, fs);

    log.progress({
      level: 'info',
      event: 'agent_extensions.catalog.deleted',
      extra: { id, kind: entry.kind, providerId: entry.provider_id, sourceType: entry.source.type },
      text: `[agent-extensions] catalog.deleted "${id}"`,
    });
  });
}
