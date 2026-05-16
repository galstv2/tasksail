import {
  CURRENT_SCHEMA_VERSION,
  loadExternalMcpRegistryWithFallback,
  type ExternalMcpRegistry,
} from '../../external-mcp-registry/index.js';
import { createLogger } from '../../core/index.js';
import type { ExternalMcpRegistryHealth } from '../types.js';

const log = createLogger('platform/agent-runner/pipeline/externalMcpRegistryCache');

// Exempt: read-only shared config, not per-task runtime state (§2.6 audit).
// SAFE: header env resolution is process-global; per-task header values are not supported.
// Adding per-task headers requires re-keying this cache by (repoRoot, headerEnvDigest).
const externalMcpRegistryCache = new Map<string, ExternalMcpRegistry>();
const externalMcpRegistryLoads = new Map<string, Promise<ExternalMcpRegistry>>();
const externalMcpRegistryHealthCache = new Map<string, ExternalMcpRegistryHealth>();

function emptyExternalMcpRegistry(): ExternalMcpRegistry {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    external_servers: [],
  };
}

export function getCachedExternalMcpRegistry(repoRoot: string): ExternalMcpRegistry | undefined {
  return externalMcpRegistryCache.get(repoRoot);
}

export function getCachedExternalMcpRegistryHealth(repoRoot: string): ExternalMcpRegistryHealth {
  return externalMcpRegistryHealthCache.get(repoRoot) ?? {
    status: 'degraded',
    reason: 'registry not prewarmed',
    serverCount: 0,
  };
}

export async function prewarmExternalMcpRegistry(repoRoot: string): Promise<ExternalMcpRegistry> {
  const cached = externalMcpRegistryCache.get(repoRoot);
  if (cached) {
    return cached;
  }

  const pending = externalMcpRegistryLoads.get(repoRoot);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    try {
      const registry = await loadExternalMcpRegistryWithFallback(repoRoot);
      externalMcpRegistryCache.set(repoRoot, registry);
      externalMcpRegistryHealthCache.set(repoRoot, {
        status: 'available',
        reason: `loaded ${registry.external_servers.length} external MCP server(s)`,
        serverCount: registry.external_servers.length,
      });
      return registry;
    } catch (error) {
      const registry = emptyExternalMcpRegistry();
      externalMcpRegistryCache.set(repoRoot, registry);
      externalMcpRegistryHealthCache.set(repoRoot, {
        status: 'degraded',
        reason: error instanceof Error ? error.message : String(error),
        serverCount: 0,
      });
      log.warn('external_mcp_registry.prewarm.failed', {
        repoRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return registry;
    } finally {
      externalMcpRegistryLoads.delete(repoRoot);
    }
  })();

  // CRITICAL: set map entry before any await to preserve dedup under concurrent callers.
  // The IIFE above creates the Promise synchronously; the first await is inside the IIFE
  // (deferred as a microtask). This line runs synchronously so a second concurrent caller
  // entering prewarmExternalMcpRegistry in the same event-loop tick will hit the
  // `if (pending) return pending` branch above and share the same Promise.
  externalMcpRegistryLoads.set(repoRoot, loadPromise);
  return loadPromise;
}

export function clearExternalMcpRegistryCache(repoRoot?: string): void {
  if (repoRoot) {
    externalMcpRegistryCache.delete(repoRoot);
    externalMcpRegistryLoads.delete(repoRoot);
    externalMcpRegistryHealthCache.delete(repoRoot);
    return;
  }

  externalMcpRegistryCache.clear();
  externalMcpRegistryLoads.clear();
  externalMcpRegistryHealthCache.clear();
}
