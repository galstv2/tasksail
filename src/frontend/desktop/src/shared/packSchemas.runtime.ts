import type {
  RepoSourcesManifest,
  BootstrapAnswers,
  SeedPlan,
  PackSeedStateRecord,
} from './packSchemas';
import {
  MANIFEST_REQUIRED_FIELDS,
  ANSWERS_REQUIRED_FIELDS,
  PLAN_REQUIRED_FIELDS,
} from './packSchemas';

function normalizeLocalPathEntry(value: unknown): { host: string; container?: string | null } | null {
  if (typeof value === 'string') return { host: value.replace(/\\/g, '/') };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.host !== 'string') return null;
  if (obj.container !== undefined && obj.container !== null && typeof obj.container !== 'string') {
    return null;
  }
  return {
    host: obj.host.replace(/\\/g, '/'),
    ...(typeof obj.container === 'string'
      ? { container: obj.container.replace(/\\/g, '/') }
      : obj.container === null
        ? { container: null }
        : {}),
  };
}

function normalizeManifestLocalPaths(obj: Record<string, unknown>, errors: string[]): void {
  const version = obj.manifest_version;
  if (version !== 'qmd-repo-sources/v2') return;
  const normalizeRepo = (repo: unknown, label: string): void => {
    if (typeof repo !== 'object' || repo === null || Array.isArray(repo)) return;
    const repoObj = repo as Record<string, unknown>;
    const rawLocalPaths = repoObj.local_paths;
    if (rawLocalPaths === undefined) return;
    if (!Array.isArray(rawLocalPaths)) {
      errors.push(`${label}.local_paths must be an array`);
      return;
    }
    const normalized = rawLocalPaths.map(normalizeLocalPathEntry);
    if (normalized.some((entry) => entry === null)) {
      errors.push(`${label}.local_paths entries must be strings or objects with host`);
      return;
    }
    repoObj.local_paths = normalized;
  };
  if (Array.isArray(obj.repositories)) {
    obj.repositories.forEach((repo, index) => normalizeRepo(repo, `repositories[${index}]`));
  }
  normalizeRepo(obj.repository, 'repository');
}

export class PackSchemaError extends Error {
  constructor(
    public readonly model: string,
    public readonly validationErrors: string[],
    public readonly path?: string,
  ) {
    const location = path ? ` (path=${JSON.stringify(path)})` : '';
    super(`Schema validation failed for ${model}${location}: ${validationErrors.join('; ')}`);
    this.name = 'PackSchemaError';
  }
}

export function assertManifest(
  value: unknown,
  path?: string,
): asserts value is RepoSourcesManifest {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackSchemaError('RepoSourcesManifest', ['Expected a JSON object'], path);
  }
  const obj = value as Record<string, unknown>;
  for (const field of MANIFEST_REQUIRED_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  normalizeManifestLocalPaths(obj, errors);
  if (errors.length > 0) throw new PackSchemaError('RepoSourcesManifest', errors, path);
}

export function assertAnswers(
  value: unknown,
  path?: string,
): asserts value is BootstrapAnswers {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackSchemaError('BootstrapAnswers', ['Expected a JSON object'], path);
  }
  const obj = value as Record<string, unknown>;
  for (const field of ANSWERS_REQUIRED_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (errors.length > 0) throw new PackSchemaError('BootstrapAnswers', errors, path);
}

export function assertPlan(
  value: unknown,
  path?: string,
): asserts value is SeedPlan {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackSchemaError('SeedPlan', ['Expected a JSON object'], path);
  }
  const obj = value as Record<string, unknown>;
  for (const field of PLAN_REQUIRED_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (errors.length > 0) throw new PackSchemaError('SeedPlan', errors, path);
}

const PACK_SEED_STATE_VALUES = new Set<string>(['seeded', 'bootstrap-empty']);

/**
 * Parse a raw JSON value loaded from ``seed-state.json`` into a
 * {@link PackSeedStateRecord}.
 *
 * Returns ``null`` on any structural failure (not an object, missing/unknown
 * ``state``) so the caller can default to ``"seeded"`` without showing a false
 * "needs population" badge on healthy packs.
 *
 * Unknown top-level keys are silently ignored (forward-compat).
 */
export function parsePackSeedStateRecord(value: unknown): PackSeedStateRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const rawState = obj.state;
  if (typeof rawState !== 'string' || !PACK_SEED_STATE_VALUES.has(rawState)) {
    return null;
  }
  const record: PackSeedStateRecord = { state: rawState as PackSeedStateRecord['state'] };
  for (const key of [
    'created_at',
    'reason',
    'last_seed_at',
    'last_seed_run_id',
    'last_failure_at',
    'last_failure_reason',
    'last_failure_run_id',
  ] as const) {
    const v = obj[key];
    if (typeof v === 'string') record[key] = v;
  }
  if (typeof obj.details === 'object' && obj.details !== null && !Array.isArray(obj.details)) {
    record.details = obj.details as Record<string, unknown>;
  }
  return record;
}
