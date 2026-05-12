/**
 * Minimal pack schema runtime guard for the backend platform build context.
 * The full interfaces live in src/frontend/desktop/src/shared/packSchemas.ts.
 * These match RepoSourcesManifest — when the Python dataclasses change, update both.
 */

/** Required top-level fields for a repo-sources.json manifest. */
const MANIFEST_REQUIRED_FIELDS = [
  'manifest_version',
  'manifest_status',
  'estate_type',
  'context_pack_id',
  'qmd_scope_root',
  'primary_working_repo_ids',
  'primary_focus_area_ids',
] as const;

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

/**
 * Assert that a parsed JSON value is a valid RepoSourcesManifest.
 * Throws PackSchemaError on schema violation.
 */
export function assertManifest(
  value: unknown,
  path?: string,
): void {
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
  if (errors.length > 0) throw new PackSchemaError('RepoSourcesManifest', errors, path);
}
