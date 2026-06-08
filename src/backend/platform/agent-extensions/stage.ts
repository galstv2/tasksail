import path from 'node:path';
import type { Dirent } from 'node:fs';
import { cp, lstat, readdir } from 'node:fs/promises';
import { createLogger } from '../core/logger.js';
import { isMissingPathError } from '../core/index.js';
import { canonicalRoot, isPathWithinBoundary } from '../core/paths.js';
import { getActiveProvider } from '../cli-provider/index.js';
import { buildDefaultFs, readImportReceipt } from './materialize.js';
import { readSourceManifest } from './sourceManifest.js';
import { loadAssignments } from './assignment.js';
import { inspectAgentExtensionMetadata } from './metadata.js';
import { withAgentExtensionsLock } from './lock.js';
import { AgentExtensionError, extensionError, runtimeCopyDir } from './ids.js';
import type {
  AgentExtensionAvailabilityEntry,
  AgentExtensionFsAdapter,
  AgentExtensionRuntimeCatalogEntry,
  AgentExtensionStageEntry,
  AgentExtensionStageManifest,
  CreateAgentExtensionStageOptions,
  ResolvedAgentExtensionStage,
} from './types.js';

// Stage events are logged through the plain logger channel (not the typed
// progress<E> union) to keep this module independent of core/logger's event
// schema. The event name is the message; structured fields go in `extra`.
const log = createLogger('platform/agent-extensions/stage');

const STAGE_ROOT_SEGMENTS = ['.platform-state', 'runtime', 'agent-extension-stage'] as const;
const LAUNCH_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function platformStateDir(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state');
}

export function resolveAgentExtensionStageRoot(repoRoot: string): string {
  return path.join(repoRoot, ...STAGE_ROOT_SEGMENTS);
}

export function resolveAgentExtensionStageDir(repoRoot: string, launchId: string): string {
  return path.join(resolveAgentExtensionStageRoot(repoRoot), launchId);
}

// Launch IDs are also used as the on-disk stage directory name. The pattern
// excludes path separators; `.` and `..` are rejected explicitly because they
// pass the character class but would resolve to the stage root or its parent.
export function assertValidAgentExtensionLaunchId(launchId: string): void {
  if (
    typeof launchId !== 'string' ||
    !LAUNCH_ID_PATTERN.test(launchId) ||
    launchId === '.' ||
    launchId === '..'
  ) {
    throw extensionError('invalid-launch-id', 'Invalid launch ID for extension staging.');
  }
}

// Default snapshot copy: recursive and non-dereferencing (verbatimSymlinks),
// so a symlink introduced between the lstat walk and the copy is reproduced as
// a symlink rather than having its target contents pulled into the stage.
export async function stageCopyDirectory(source: string, destination: string): Promise<void> {
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

// Backend-only catalog projection: every source-manifest entry enriched with its
// deterministic canonical runtime path and (best-effort) metadata. Lock-free —
// callers invoke it while already holding withAgentExtensionsLock. It does NOT
// gate on runtime existence; staging performs the existence/containment/symlink
// checks so it can distinguish unknown vs disabled vs missing-runtime.
export async function loadAgentExtensionRuntimeCatalogForStaging(
  repoRoot: string,
): Promise<AgentExtensionRuntimeCatalogEntry[]> {
  const fs = buildDefaultFs();
  const provider = getActiveProvider(repoRoot);
  const manifest = await readSourceManifest(repoRoot, fs, provider.id);
  const psDir = platformStateDir(repoRoot);

  const entries: AgentExtensionRuntimeCatalogEntry[] = [];
  for (const entry of manifest.extensions) {
    const runtimePath = runtimeCopyDir(psDir, entry.kind, entry.id);
    const receipt = await readImportReceipt(repoRoot, entry.kind, entry.id, fs);
    let metadata: AgentExtensionRuntimeCatalogEntry['metadata'] = {};
    if (await fs.pathExists(runtimePath)) {
      try {
        const meta = await inspectAgentExtensionMetadata({
          kind: entry.kind,
          runtimePath,
          inspectPluginMetadata: (pluginRuntimePath) => provider.inspectPluginMetadata(pluginRuntimePath),
        });
        metadata = meta.metadata;
      } catch {
        // Metadata is best-effort; absence does not block staging.
      }
    }
    entries.push({
      ...entry,
      runtime_path: runtimePath,
      imported_at: receipt?.imported_at ?? '',
      reseeded_at: receipt?.reseeded_at,
      metadata,
    });
  }
  return entries;
}

async function assertNoSymlinksInTree(root: string): Promise<void> {
  // The root itself is part of the tree. A runtime copy that is a symlink — even one
  // resolving to a sibling inside the kind root, which passes the containment check — would
  // be reproduced verbatim by the non-dereferencing copy, leaving the "snapshot" pointing at
  // mutable canonical content. Reject a symlink or non-directory root before walking children.
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw extensionError(
      'symlink-in-runtime',
      'A symlink was found inside a canonical runtime copy; staging is refused.',
    );
  }
  if (!rootStat.isDirectory()) {
    throw extensionError(
      'runtime-not-directory',
      'A canonical runtime copy is not a directory; staging is refused.',
    );
  }
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const names = await readdir(dir);
    for (const name of names) {
      const full = path.join(dir, name);
      const st = await lstat(full);
      if (st.isSymbolicLink()) {
        throw extensionError(
          'symlink-in-runtime',
          'A symlink was found inside a canonical runtime copy; staging is refused.',
        );
      }
      if (st.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

function assertRuntimePathInKindRoot(
  psDir: string,
  entry: AgentExtensionRuntimeCatalogEntry,
): void {
  const kindRoot = path.join(psDir, entry.kind === 'skill' ? 'skills' : 'plugins');
  // canonicalRoot follows symlinks, so a runtime dir that is itself a symlink
  // escaping the kind-specific root is rejected here before any copy.
  if (!isPathWithinBoundary(canonicalRoot(kindRoot), canonicalRoot(entry.runtime_path))) {
    throw extensionError(
      'runtime-path-out-of-bounds',
      'Canonical runtime path escapes the expected platform-state root.',
    );
  }
}

async function writeStageManifest(
  stageDir: string,
  manifest: AgentExtensionStageManifest,
  fs: AgentExtensionFsAdapter,
): Promise<void> {
  await fs.ensureDir(stageDir);
  await fs.writeTextFileAtomic(
    path.join(stageDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function stagedEntryPath(stageDir: string, entry: AgentExtensionRuntimeCatalogEntry): string {
  return entry.kind === 'skill'
    ? path.join(stageDir, 'skills', entry.id)
    : path.join(stageDir, 'plugins', entry.id);
}

function noopStage(
  launchId: string,
  agentId: ResolvedAgentExtensionStage['agentId'],
): ResolvedAgentExtensionStage {
  return {
    launchId,
    agentId,
    stageDir: null,
    launchExtensions: undefined,
    availabilityEntries: [],
    cleanup: async () => undefined,
  };
}

export async function createAgentExtensionStage(
  options: CreateAgentExtensionStageOptions,
): Promise<ResolvedAgentExtensionStage> {
  const { repoRoot, agentId, launchId } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const copyDirectory = options.copyDirectory ?? stageCopyDirectory;

  // Validate before any filesystem mutation (including the lock mkdir).
  assertValidAgentExtensionLaunchId(launchId);

  const fs = buildDefaultFs();
  const psDir = platformStateDir(repoRoot);
  const stageRoot = resolveAgentExtensionStageRoot(repoRoot);
  const stageDir = resolveAgentExtensionStageDir(repoRoot, launchId);

  // Single lock acquired once at the outer boundary, held from assignment/catalog
  // read through snapshot copy completion. Every helper called inside is lock-free
  // (withDirLock is non-reentrant), so there is no self-deadlock. The lock's inherited
  // retry/backoff budget (~51s before throwing) lets a concurrent staging, reseed, or
  // delete WAIT rather than fail, which is ample for local snapshot-copy duration.
  return withAgentExtensionsLock(repoRoot, 'createAgentExtensionStage', async () => {
    const assignments = await loadAssignments(repoRoot, fs);
    const assignedIds =
      assignments.assignments.find((a) => a.agent_id === agentId)?.extension_ids ?? [];

    if (assignedIds.length === 0) {
      // No enabled assignments: no stage directory, no create.* logs.
      return noopStage(launchId, agentId);
    }

    const startedAt = Date.now();
    log.info('[agent-extensions] stage.create.started', {
      event: 'agent_extensions.stage.create.started',
      launchId,
      agentId,
      requestedCount: assignedIds.length,
    });

    try {
      const catalog = await loadAgentExtensionRuntimeCatalogForStaging(repoRoot);
      const byId = new Map(catalog.map((e) => [e.id, e]));

      // Deterministic ID order for manifest entries and copy order.
      const sortedIds = [...assignedIds].sort();
      const resolved: AgentExtensionRuntimeCatalogEntry[] = [];
      for (const id of sortedIds) {
        const entry = byId.get(id);
        if (!entry) {
          throw extensionError('unknown-assignment-id', 'An assigned extension is not in the catalog.');
        }
        if (!entry.enabled) {
          throw extensionError('disabled-assignment-id', 'An assigned extension is disabled.');
        }
        if (entry.display_name.trim() === '' || entry.description.trim() === '') {
          throw extensionError('incomplete-catalog-entry', 'An assigned extension is missing cached metadata.');
        }
        assertRuntimePathInKindRoot(psDir, entry);
        if (!(await fs.pathExists(entry.runtime_path))) {
          throw extensionError('missing-canonical-runtime', 'A canonical runtime copy is missing.');
        }
        await assertNoSymlinksInTree(entry.runtime_path);
        resolved.push(entry);
      }

      // Re-stage replaces: a pre-existing directory for this launch ID is a stale
      // prior attempt (role-agent retries reuse the launch ID). Remove it in full
      // under the lock after confirming containment; never merge.
      // Lexical containment (path.resolve, symlink-agnostic): the stage dir may not exist
      // yet, so realpath-based resolution would falsely diverge on platforms where the temp
      // root is itself a symlink. launchId validation already blocks traversal.
      if (!isPathWithinBoundary(stageRoot, stageDir)) {
        throw extensionError('stage-path-out-of-bounds', 'Resolved stage directory escapes the stage root.');
      }
      await fs.rm(stageDir);

      const skills = resolved.filter((e) => e.kind === 'skill');
      const plugins = resolved.filter((e) => e.kind === 'plugin');

      const entries: AgentExtensionStageEntry[] = resolved.map((e) => ({
        id: e.id,
        kind: e.kind,
        display_name: e.display_name,
        description: e.description,
        staged_path: stagedEntryPath(stageDir, e),
      }));

      // Manifest-first: write status `creating` before copying any entry.
      const manifest: AgentExtensionStageManifest = {
        schema_version: 1,
        launch_id: launchId,
        agent_id: agentId,
        created_at: now(),
        status: 'creating',
        entries,
      };
      await writeStageManifest(stageDir, manifest, fs);

      for (const e of resolved) {
        const dest = stagedEntryPath(stageDir, e);
        await fs.ensureDir(path.dirname(dest));
        try {
          await copyDirectory(e.runtime_path, dest);
        } catch {
          throw extensionError('stage-copy-failed', 'Failed to copy a runtime extension into the launch stage.');
        }
      }

      // Update to `created` only after every copy succeeds.
      await writeStageManifest(stageDir, { ...manifest, status: 'created' }, fs);

      const availabilityEntries: AgentExtensionAvailabilityEntry[] = resolved.map((e) => ({
        id: e.id,
        kind: e.kind,
        display_name: e.display_name,
        description: e.description,
        metadata: e.metadata,
      }));

      log.info('[agent-extensions] stage.create.completed', {
        event: 'agent_extensions.stage.create.completed',
        launchId,
        agentId,
        skillCount: skills.length,
        pluginCount: plugins.length,
        entryIds: resolved.map((e) => e.id),
        elapsedMs: Date.now() - startedAt,
      });

      return {
        launchId,
        agentId,
        stageDir,
        launchExtensions: {
          pluginDirs: plugins.map((p) => stagedEntryPath(stageDir, p)),
          skillDirs: skills.length > 0 ? [path.join(stageDir, 'skills')] : [],
        },
        availabilityEntries,
        cleanup: () => cleanupAgentExtensionStage({ repoRoot, launchId }),
      };
    } catch (err) {
      // Any failure removes the whole partial stage directory and rethrows a
      // content-safe error (the original error may carry a filesystem path).
      const reasonCode = err instanceof AgentExtensionError ? err.code : 'stage-create-failed';
      await fs.rm(stageDir).catch((rmErr: unknown) => {
        // "Removes the partial stage directory" is best-effort: if the rm itself fails
        // (e.g. Windows EBUSY), surface it for diagnosability instead of silently leaving
        // residue. Startup recovery sweeps any leftover stage dir at the next bootstrap.
        const rmReason = rmErr instanceof AgentExtensionError ? rmErr.code : 'stage-dir-rm-failed';
        log.warn('[agent-extensions] stage.create.partial-cleanup-failed', {
          event: 'agent_extensions.stage.create.failed',
          launchId,
          agentId,
          reasonCode: rmReason,
        });
      });
      log.warn('[agent-extensions] stage.create.failed', {
        event: 'agent_extensions.stage.create.failed',
        launchId,
        agentId,
        elapsedMs: Date.now() - startedAt,
        reasonCode,
      });
      throw err instanceof AgentExtensionError
        ? err
        : extensionError('stage-create-failed', 'Failed to create the launch extension stage.');
    }
  });
}

export async function cleanupAgentExtensionStage(args: {
  repoRoot: string;
  launchId: string;
}): Promise<void> {
  const { repoRoot, launchId } = args;
  const fs = buildDefaultFs();
  const stageRoot = resolveAgentExtensionStageRoot(repoRoot);
  const stageDir = resolveAgentExtensionStageDir(repoRoot, launchId);

  try {
    assertValidAgentExtensionLaunchId(launchId);
    // Refuse to remove anything that is not a strict child of the stage root. Lexical
    // resolution (not realpath) so an already-removed stage dir cleans up idempotently
    // even when the stage root is a symlinked temp path.
    const resolvedRoot = path.resolve(stageRoot);
    const resolvedDir = path.resolve(stageDir);
    if (resolvedDir === resolvedRoot || !isPathWithinBoundary(stageRoot, stageDir)) {
      throw extensionError('stage-cleanup-out-of-bounds', 'Refusing to remove a path outside the stage root.');
    }
  } catch (err) {
    const reasonCode = err instanceof AgentExtensionError ? err.code : 'stage-cleanup-rejected';
    log.warn('[agent-extensions] stage.cleanup.failed', {
      event: 'agent_extensions.stage.cleanup.failed',
      launchId,
      reasonCode,
    });
    throw err instanceof AgentExtensionError
      ? err
      : extensionError('stage-cleanup-rejected', 'Stage cleanup was refused.');
  }

  // Recursive force removal: a missing directory is a successful no-op.
  await fs.rm(stageDir);
  log.info('[agent-extensions] stage.cleanup.completed', {
    event: 'agent_extensions.stage.cleanup.completed',
    launchId,
  });
}

export async function recoverAgentExtensionStagesOnStartup(repoRoot: string): Promise<{
  removedStageCount: number;
  skippedEntryCount: number;
}> {
  const fs = buildDefaultFs();
  const stageRoot = resolveAgentExtensionStageRoot(repoRoot);

  // Acquire the same lock as stage creation so recovery is mutually exclusive
  // with an in-flight staging operation.
  return withAgentExtensionsLock(repoRoot, 'recoverAgentExtensionStagesOnStartup', async () => {
    let entries: Dirent[];
    try {
      entries = await readdir(stageRoot, { withFileTypes: true });
    } catch (err) {
      if (isMissingPathError(err)) {
        logStageRecoveryCompleted(0, 0);
        return { removedStageCount: 0, skippedEntryCount: 0 };
      }
      throw err;
    }

    let removedStageCount = 0;
    let skippedEntryCount = 0;
    for (const entry of entries) {
      // Only real directories are stale stage snapshots. Symlinks (isDirectory()
      // is false for a symlink Dirent) and files are skipped, never followed.
      if (!entry.isDirectory()) {
        skippedEntryCount++;
        continue;
      }
      const dir = path.join(stageRoot, entry.name);
      if (!isPathWithinBoundary(canonicalRoot(stageRoot), canonicalRoot(dir))) {
        skippedEntryCount++;
        continue;
      }
      await fs.rm(dir);
      removedStageCount++;
    }

    // One summary log per bootstrap, not one per stale directory.
    logStageRecoveryCompleted(removedStageCount, skippedEntryCount);
    return { removedStageCount, skippedEntryCount };
  });
}

function logStageRecoveryCompleted(removedStageCount: number, skippedEntryCount: number): void {
  const payload = {
    event: 'agent_extensions.stage.recovery.completed',
    removedStageCount,
    skippedEntryCount,
  };
  const method = removedStageCount === 0 && skippedEntryCount === 0 ? log.debug : log.info;
  method('[agent-extensions] stage.recovery.completed', payload);
}
