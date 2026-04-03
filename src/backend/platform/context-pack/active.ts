import path from 'node:path';
import { findRepoRoot, readEnvAssignment, resolvePath } from '../core/index.js';
import { ACTIVE_CONTEXT_PACK_DIR_KEY, validatePackStructure } from './activate.js';

export interface RequireAuthorizedActiveContextPackOptions {
  repoRoot?: string;
  requestedContextPackDir?: string;
}

export async function requireAuthorizedActiveContextPack(
  options: RequireAuthorizedActiveContextPackOptions = {},
): Promise<string> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const envPath = path.join(repoRoot, '.env');
  const configuredContextPackDir = (await readEnvAssignment(
    envPath,
    ACTIVE_CONTEXT_PACK_DIR_KEY,
  ))?.trim();

  if (!configuredContextPackDir) {
    throw new Error(
      'No active context pack is configured in repo .env. ' +
      'Activate a context pack before running write operations.',
    );
  }

  const authorizedContextPackDir = resolvePath(repoRoot, configuredContextPackDir);
  const validation = validatePackStructure(authorizedContextPackDir);
  if (!validation.valid) {
    throw new Error(
      `Active context pack validation failed: ${validation.errors.join('; ')}`,
    );
  }

  const envActiveContextPackDir = process.env[ACTIVE_CONTEXT_PACK_DIR_KEY]?.trim();
  if (
    envActiveContextPackDir &&
    resolvePath(repoRoot, envActiveContextPackDir) !== authorizedContextPackDir
  ) {
    throw new Error(
      'ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack. ' +
      'Refusing write operation.',
    );
  }

  if (
    options.requestedContextPackDir &&
    resolvePath(repoRoot, options.requestedContextPackDir) !== authorizedContextPackDir
  ) {
    throw new Error(
      'Write operations are limited to the active context pack configured in repo .env.',
    );
  }

  return authorizedContextPackDir;
}
