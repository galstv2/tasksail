import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { CliProvider } from './types.js';
import { copilotProvider } from './providers/copilot/index.js';

const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';
export const DEFAULT_CLI_PROVIDER_ID = copilotProvider.id;

const providers: Record<string, CliProvider> = {
  [copilotProvider.id]: copilotProvider,
};

const cache = new Map<string, CliProvider>();

function registeredProviderList(): string {
  return Object.keys(providers).sort().join(', ');
}

function normalizeProviderId(id: string | undefined | null, source: string): string | null {
  if (id === undefined || id === null) {
    return null;
  }
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error(`${source} must be a non-empty string when set.`);
  }
  return trimmed;
}

function readRuntimeProviderId(repoRoot: string): string | null {
  const configPath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);
  if (!existsSync(configPath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid platform config at ${configPath}: ${detail}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid platform config at ${configPath}: root must be a JSON object.`);
  }

  const value = (parsed as Record<string, unknown>)['cli_provider'];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid platform config at ${configPath}: cli_provider must be a string.`);
  }
  return normalizeProviderId(value, `cli_provider in ${configPath}`);
}

export function resolveCliProviderId(repoRoot: string, id?: string): string {
  const resolvedId =
    normalizeProviderId(id, 'CLI provider id')
    ?? normalizeProviderId(process.env['TASKSAIL_CLI_PROVIDER'], 'TASKSAIL_CLI_PROVIDER')
    ?? readRuntimeProviderId(repoRoot)
    ?? DEFAULT_CLI_PROVIDER_ID;

  if (!providers[resolvedId]) {
    throw new Error(
      `Unknown CLI provider "${resolvedId}". Registered providers: ${registeredProviderList()}.`,
    );
  }

  return resolvedId;
}

export function loadCliProvider(repoRoot: string, id?: string): CliProvider {
  const providerId = resolveCliProviderId(repoRoot, id);
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unknown CLI provider "${providerId}". Registered providers: ${registeredProviderList()}.`);
  }
  return provider;
}

export function getActiveProvider(repoRoot: string): CliProvider {
  const repoKey = path.resolve(repoRoot);
  const activeKey = `${repoKey}\0active`;
  const activeCached = cache.get(activeKey);
  if (activeCached) {
    return activeCached;
  }

  const providerId = resolveCliProviderId(repoRoot);
  const key = `${repoKey}\0${providerId}`;
  const cached = cache.get(key);
  if (cached) {
    cache.set(activeKey, cached);
    return cached;
  }

  const provider = loadCliProvider(repoRoot, providerId);
  cache.set(key, provider);
  cache.set(activeKey, provider);
  return provider;
}

export function resetProvider(repoRoot?: string): void {
  if (repoRoot === undefined) {
    cache.clear();
    return;
  }
  const prefix = `${path.resolve(repoRoot)}\0`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
