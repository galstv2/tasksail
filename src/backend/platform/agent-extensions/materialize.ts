import { createHash } from 'node:crypto';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, readTextFile, writeTextFileAtomic } from '../core/io.js';
import { rm, rename } from 'node:fs/promises';
import { canonicalRoot, isPathWithinBoundary } from '../core/paths.js';
import { inspectAgentExtensionMetadata } from './metadata.js';
import {
  extensionError,
  importReceiptPath,
  runtimeCopyDir,
  tempDirForId,
} from './ids.js';
import type {
  AgentExtensionFsAdapter,
  AgentExtensionImportReceipt,
  AgentExtensionKind,
  AgentExtensionMutationSeams,
  AgentExtensionProviderId,
  AgentExtensionRuntimeCatalogEntry,
  AgentExtensionSourceManifestEntry,
  ExtensionExecFile,
} from './types.js';

const execFileAsync = promisify(nodeExecFile);

export function buildDefaultFs(): AgentExtensionFsAdapter {
  return {
    readTextFile: async (filePath) => {
      const result = await readTextFile(filePath);
      return result ?? null;
    },
    writeTextFileAtomic,
    ensureDir,
    rm: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    rename,
    pathExists: async (targetPath) => {
      try {
        await stat(targetPath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function buildDefaultExecFile(): ExtensionExecFile {
  return async (file, args, options) => {
    const result = await execFileAsync(file, args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
    });
    return { stdout: result.stdout, stderr: result.stderr };
  };
}

function platformStateDir(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state');
}

async function computeSourceDigest(dirPath: string): Promise<string> {
  const hash = createHash('sha256');

  async function collectFiles(dir: string, base: string): Promise<{ relPath: string; fullPath: string }[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: { relPath: string; fullPath: string }[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Use forward-slash concat for cross-platform digest stability
      const relPath = base ? base + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        const sub = await collectFiles(fullPath, relPath);
        results.push(...sub);
      } else if (entry.isFile()) {
        results.push({ relPath, fullPath });
      }
    }
    return results;
  }

  const files = await collectFiles(dirPath, '');
  // Deterministic byte-order sort (not locale-dependent)
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  for (const { relPath, fullPath } of files) {
    const bytes = await readFile(fullPath);
    hash.update(relPath);
    hash.update('\0');
    hash.update(bytes);
  }

  return hash.digest('hex');
}

async function cloneGitSource(
  url: string,
  ref: string,
  cloneDir: string,
  execFile: ExtensionExecFile,
): Promise<string> {
  try {
    await execFile('git', ['clone', '--depth', '1', '--branch', ref, '--', url, cloneDir], {
      cwd: path.dirname(cloneDir),
    });
  } catch {
    throw extensionError('git-clone-failed', 'git clone failed. Verify the git URL and ref.');
  }
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: cloneDir });
  return stdout.trim();
}

// Clone git source to targetDir, honoring source_subpath with containment check.
// Returns the resolved commit_sha.
async function materializeGitSource(
  url: string,
  ref: string,
  subpath: string | undefined,
  targetDir: string,
  execFile: ExtensionExecFile,
  psDir: string,
  id: string,
): Promise<string> {
  if (!subpath) {
    return cloneGitSource(url, ref, targetDir, execFile);
  }

  // Clone into a sub-temp dir, then copy only subpath into targetDir
  const cloneTmp = `${psDir}/agent-extensions/.tmp-clone-${id}-${process.pid}`;
  await rm(cloneTmp, { recursive: true, force: true });
  await ensureDir(cloneTmp);
  let commitSha: string;
  try {
    commitSha = await cloneGitSource(url, ref, cloneTmp, execFile);

    // Containment check: subpath must stay within clone dir
    const cloneReal = canonicalRoot(cloneTmp);
    const candidateReal = canonicalRoot(path.join(cloneTmp, subpath));
    if (!isPathWithinBoundary(cloneReal, candidateReal)) {
      throw extensionError('source-subpath-escape', 'source_subpath escapes the source root.');
    }

    const subpathSrc = path.join(cloneTmp, subpath);
    await cp(subpathSrc, targetDir, { recursive: true });
  } finally {
    await rm(cloneTmp, { recursive: true, force: true }).catch(() => undefined);
  }
  return commitSha;
}

async function copyLocalSource(
  sourcePath: string,
  subpath: string | undefined,
  targetDir: string,
): Promise<void> {
  let src: string;
  if (subpath) {
    // Containment check: subpath must stay within source root
    const sourceReal = canonicalRoot(sourcePath);
    const candidateReal = canonicalRoot(path.join(sourcePath, subpath));
    if (!isPathWithinBoundary(sourceReal, candidateReal)) {
      throw extensionError('source-subpath-escape', 'source_subpath escapes the source root.');
    }
    src = path.join(sourcePath, subpath);
  } else {
    src = sourcePath;
  }
  if (!existsSync(src)) {
    throw extensionError('local-path-missing', 'Local source path does not exist. Verify the path in the extension manifest.');
  }
  await cp(src, targetDir, { recursive: true });
}

async function validateRuntimeCopy(
  kind: AgentExtensionKind,
  runtimePath: string,
  providerId: AgentExtensionProviderId,
): Promise<Pick<AgentExtensionRuntimeCatalogEntry, 'display_name' | 'description' | 'metadata'>> {
  return inspectAgentExtensionMetadata({ providerId, kind, runtimePath });
}

// Crash-safe cross-platform dir replacement: materialize → validate → rm existing → rename temp in.
async function safeDirReplace(
  tempDir: string,
  targetDir: string,
  fs: AgentExtensionFsAdapter,
): Promise<void> {
  // Ensure parent directory exists (e.g. .platform-state/skills/)
  await fs.ensureDir(path.dirname(targetDir));
  const targetExists = await fs.pathExists(targetDir);
  if (targetExists) {
    await fs.rm(targetDir);
  }
  await fs.rename(tempDir, targetDir);
}

export async function materializeExtension(
  repoRoot: string,
  entry: AgentExtensionSourceManifestEntry,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentExtensionRuntimeCatalogEntry> {
  const fs = seams?.fs ?? buildDefaultFs();
  const execFile = seams?.execFile ?? buildDefaultExecFile();
  const now = seams?.now ?? (() => new Date().toISOString());
  const psDir = platformStateDir(repoRoot);
  const targetDir = runtimeCopyDir(psDir, entry.kind, entry.id);
  const tempDir = tempDirForId(psDir, entry.id);

  // Ensure temp dir parent exists
  await fs.ensureDir(path.dirname(tempDir));
  // Remove any stale temp from prior crash
  await fs.rm(tempDir);

  let commitSha: string | undefined;

  try {
    await fs.ensureDir(tempDir);

    if (entry.source.type === 'git') {
      commitSha = await materializeGitSource(
        entry.source.url,
        entry.source.ref,
        entry.source.source_subpath,
        tempDir,
        execFile,
        psDir,
        entry.id,
      );
    } else if (entry.source.type === 'local') {
      await copyLocalSource(entry.source.path, entry.source.source_subpath, tempDir);
    } else {
      // direct-attachment: SKILL.md is at config_path already materialized
      const configPath = entry.source.config_path;
      // Containment check: config_path must stay within repoRoot
      const repoReal = canonicalRoot(repoRoot);
      const skillMdReal = canonicalRoot(path.join(repoRoot, configPath));
      if (!isPathWithinBoundary(repoReal, skillMdReal)) {
        throw extensionError('config-path-escape', 'config_path escapes the repository root.');
      }
      const skillMdSrc = path.join(repoRoot, configPath);
      const skillMdDst = path.join(tempDir, 'SKILL.md');
      await fs.ensureDir(path.dirname(skillMdDst));
      await cp(skillMdSrc, skillMdDst);
    }

    const meta = await validateRuntimeCopy(entry.kind, tempDir, entry.provider_id);
    const sourceDigest = await computeSourceDigest(tempDir);

    await safeDirReplace(tempDir, targetDir, fs);

    const importedAt = now();
    const receipt: AgentExtensionImportReceipt = {
      schema_version: 1,
      id: entry.id,
      kind: entry.kind,
      provider_id: entry.provider_id,
      source_type: entry.source.type,
      source_digest: sourceDigest,
      ...(commitSha ? { commit_sha: commitSha } : {}),
      runtime_path: targetDir,
      imported_at: importedAt,
    };

    const receiptPath = importReceiptPath(psDir, entry.kind, entry.id);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeTextFileAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    // Catalog mutation events are emitted by the add/reseed orchestrators in index.ts,
    // never here — reconciliation also calls materializeExtension and must not log a user add.
    return {
      ...entry,
      runtime_path: targetDir,
      imported_at: importedAt,
      metadata: meta.metadata,
    };
  } catch (err) {
    // Best-effort cleanup of temp dir on failure
    await fs.rm(tempDir).catch(() => undefined);
    throw err;
  }
}

export async function reseedExtension(
  repoRoot: string,
  entry: AgentExtensionSourceManifestEntry,
  existingReceipt: AgentExtensionImportReceipt,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentExtensionRuntimeCatalogEntry> {
  const fs = seams?.fs ?? buildDefaultFs();
  const execFile = seams?.execFile ?? buildDefaultExecFile();
  const now = seams?.now ?? (() => new Date().toISOString());
  const psDir = platformStateDir(repoRoot);
  const targetDir = runtimeCopyDir(psDir, entry.kind, entry.id);
  const tempDir = tempDirForId(psDir, entry.id);

  await fs.ensureDir(path.dirname(tempDir));
  await fs.rm(tempDir);

  let commitSha: string | undefined;

  try {
    await fs.ensureDir(tempDir);

    if (entry.source.type === 'git') {
      commitSha = await materializeGitSource(
        entry.source.url,
        entry.source.ref,
        entry.source.source_subpath,
        tempDir,
        execFile,
        psDir,
        entry.id,
      );
    } else if (entry.source.type === 'local') {
      await copyLocalSource(entry.source.path, entry.source.source_subpath, tempDir);
    } else {
      const configPath = entry.source.config_path;
      // Containment check: config_path must stay within repoRoot
      const repoReal = canonicalRoot(repoRoot);
      const skillMdReal = canonicalRoot(path.join(repoRoot, configPath));
      if (!isPathWithinBoundary(repoReal, skillMdReal)) {
        throw extensionError('config-path-escape', 'config_path escapes the repository root.');
      }
      const skillMdSrc = path.join(repoRoot, configPath);
      const skillMdDst = path.join(tempDir, 'SKILL.md');
      await fs.ensureDir(path.dirname(skillMdDst));
      await cp(skillMdSrc, skillMdDst);
    }

    const meta = await validateRuntimeCopy(entry.kind, tempDir, entry.provider_id);
    const sourceDigest = await computeSourceDigest(tempDir);

    await safeDirReplace(tempDir, targetDir, fs);

    const reseededAt = now();
    const receipt: AgentExtensionImportReceipt = {
      schema_version: 1,
      id: entry.id,
      kind: entry.kind,
      provider_id: entry.provider_id,
      source_type: entry.source.type,
      source_digest: sourceDigest,
      ...(commitSha ? { commit_sha: commitSha } : {}),
      runtime_path: targetDir,
      imported_at: existingReceipt.imported_at,
      reseeded_at: reseededAt,
    };

    const receiptPath = importReceiptPath(psDir, entry.kind, entry.id);
    await fs.ensureDir(path.dirname(receiptPath));
    await fs.writeTextFileAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    // Catalog mutation events are emitted by the reseed orchestrator in index.ts, not here.
    return {
      ...entry,
      runtime_path: targetDir,
      imported_at: existingReceipt.imported_at,
      reseeded_at: reseededAt,
      metadata: meta.metadata,
    };
  } catch (err) {
    await fs.rm(tempDir).catch(() => undefined);
    throw err;
  }
}

export async function readImportReceipt(
  repoRoot: string,
  kind: AgentExtensionKind,
  id: string,
  fs: AgentExtensionFsAdapter,
): Promise<AgentExtensionImportReceipt | null> {
  const psDir = platformStateDir(repoRoot);
  const receiptPath = importReceiptPath(psDir, kind, id);
  const raw = await fs.readTextFile(receiptPath);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    // A valid receipt is schema_version 1, identifies the same id+kind it is filed under,
    // and carries the provider/source/runtime/timestamp identity fields. A receipt that
    // does not identify itself for this id+kind is treated as missing.
    if (
      r.schema_version === 1 &&
      r.id === id &&
      r.kind === kind &&
      typeof r.provider_id === 'string' &&
      typeof r.source_type === 'string' &&
      typeof r.source_digest === 'string' &&
      r.source_digest.length > 0 &&
      typeof r.runtime_path === 'string' &&
      typeof r.imported_at === 'string'
    ) {
      return parsed as AgentExtensionImportReceipt;
    }
    return null;
  } catch {
    return null;
  }
}

// A receipt is consistent with a catalog entry only when its identity, provider, source
// type, and runtime path all match. Used by both renderer status derivation and
// reconciliation so a stale/corrupt receipt cannot make an entry appear available or
// suppress repair.
export function isReceiptConsistentWithEntry(
  receipt: AgentExtensionImportReceipt,
  entry: AgentExtensionSourceManifestEntry,
  expectedRuntimePath: string,
): boolean {
  return (
    receipt.id === entry.id &&
    receipt.kind === entry.kind &&
    receipt.provider_id === entry.provider_id &&
    receipt.source_type === entry.source.type &&
    receipt.runtime_path === expectedRuntimePath
  );
}

export async function computeRuntimeCopyDigest(
  runtimePath: string,
  fs: AgentExtensionFsAdapter,
): Promise<string | null> {
  const exists = await fs.pathExists(runtimePath);
  if (!exists) return null;
  try {
    return await computeSourceDigest(runtimePath);
  } catch {
    return null;
  }
}
