import path from 'node:path';
import { isRecord } from '../core/guards.js';
import { safeJsonParse } from '../core/io.js';
import type {
  AgentExtensionFsAdapter,
  AgentExtensionKind,
  AgentExtensionSource,
  AgentExtensionSourceManifestEntry,
  AgentExtensionsSourceManifest,
} from './types.js';
import { ID_PATTERN, isValidExtensionId, validatePluginDirectAttachment } from './ids.js';

function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== 'string') return false;
  if (path.isAbsolute(p)) return false;
  if (p.split(/[/\\]/).includes('..')) return false;
  return true;
}

const SOURCE_MANIFEST_RELATIVE = 'config/agent-extensions.default.json';

export function sourceManifestPath(repoRoot: string): string {
  return path.join(repoRoot, SOURCE_MANIFEST_RELATIVE);
}

function validateSource(source: unknown): source is AgentExtensionSource {
  if (!isRecord(source)) return false;
  const t = source.type;
  if (t === 'git') {
    if (typeof source.url !== 'string' || typeof source.ref !== 'string') return false;
    // source_subpath must be a safe relative path if present
    if (source.source_subpath !== undefined && !isSafeRelativePath(source.source_subpath)) return false;
    return true;
  }
  if (t === 'local') {
    if (typeof source.path !== 'string') return false;
    if (source.source_subpath !== undefined && !isSafeRelativePath(source.source_subpath)) return false;
    return true;
  }
  if (t === 'direct-attachment') {
    if (typeof source.config_path !== 'string') return false;
    // config_path must be a safe relative path
    if (!isSafeRelativePath(source.config_path)) return false;
    return true;
  }
  return false;
}

function validateEntry(value: unknown, index: number): AgentExtensionSourceManifestEntry {
  if (!isRecord(value)) {
    throw new Error(`Extension entry at index ${index} must be an object.`);
  }
  const { id, kind, provider_id, display_name, description, enabled, source } = value;

  if (typeof id !== 'string' || !isValidExtensionId(id)) {
    throw new Error(
      `Extension entry at index ${index} has invalid id "${String(id)}". ` +
      `Must match ${ID_PATTERN.toString()}.`,
    );
  }
  if (kind !== 'skill' && kind !== 'plugin') {
    throw new Error(`Extension entry "${id}" has invalid kind "${String(kind)}".`);
  }
  if (provider_id !== 'copilot') {
    throw new Error(`Extension entry "${id}" has unsupported provider_id "${String(provider_id)}".`);
  }
  if (typeof display_name !== 'string' || display_name.trim() === '') {
    throw new Error(`Extension entry "${id}" is missing a valid display_name.`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`Extension entry "${id}" is missing a valid description.`);
  }
  if (typeof enabled !== 'boolean') {
    throw new Error(`Extension entry "${id}" must have a boolean enabled field.`);
  }
  if (!validateSource(source)) {
    throw new Error(`Extension entry "${id}" has an invalid or missing source.`);
  }

  if (kind === 'plugin') {
    const pluginSourceError = validatePluginDirectAttachment(source as AgentExtensionSource);
    if (pluginSourceError) {
      throw new Error(`Extension entry "${id}": ${pluginSourceError}`);
    }
  }

  return {
    id,
    kind: kind as AgentExtensionKind,
    provider_id: 'copilot',
    display_name: display_name.trim(),
    description: description.trim(),
    enabled,
    source: source as AgentExtensionSource,
  };
}

export function parseSourceManifest(raw: string, context: string): AgentExtensionsSourceManifest {
  const parsed = safeJsonParse<unknown>(raw, context);
  if (!isRecord(parsed)) {
    throw new Error(`Source manifest in ${context} must be a JSON object.`);
  }
  if (parsed.schema_version !== 1) {
    throw new Error(
      `Source manifest schema_version must be 1, got ${String(parsed.schema_version)}.`,
    );
  }
  if (!Array.isArray(parsed.extensions)) {
    throw new Error('Source manifest must have an extensions array.');
  }

  const entries = parsed.extensions.map((entry, i) => validateEntry(entry, i));

  // Validate global ID namespace: no duplicate IDs across skill+plugin
  const seen = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const { id } = entries[i];
    if (seen.has(id)) {
      throw new Error(
        `Duplicate extension ID "${id}" at indices ${seen.get(id)} and ${i}. ` +
        'IDs are global across skills and plugins.',
      );
    }
    seen.set(id, i);
  }

  return { schema_version: 1, extensions: entries };
}

export function serializeSourceManifest(manifest: AgentExtensionsSourceManifest): string {
  const sorted = [...manifest.extensions].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ schema_version: manifest.schema_version, extensions: sorted }, null, 2)}\n`;
}

export async function readSourceManifest(
  repoRoot: string,
  fs: AgentExtensionFsAdapter,
): Promise<AgentExtensionsSourceManifest> {
  const filePath = sourceManifestPath(repoRoot);
  const raw = await fs.readTextFile(filePath);
  if (raw === null) {
    return { schema_version: 1, extensions: [] };
  }
  return parseSourceManifest(raw, SOURCE_MANIFEST_RELATIVE);
}

export async function writeSourceManifest(
  repoRoot: string,
  manifest: AgentExtensionsSourceManifest,
  fs: AgentExtensionFsAdapter,
): Promise<void> {
  const filePath = sourceManifestPath(repoRoot);
  await fs.writeTextFileAtomic(filePath, serializeSourceManifest(manifest));
}
