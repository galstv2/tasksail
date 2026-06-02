import {
  CURRENT_SCHEMA_VERSION,
  EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION,
  loadExternalMcpAgentAssignments,
  loadExternalMcpRegistryWithFallback,
  type ExternalMcpAgentAssignmentsDocument,
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
const externalMcpAssignmentsCache = new Map<string, ExternalMcpAgentAssignmentsDocument>();
const externalMcpAssignmentsLoads = new Map<string, Promise<ExternalMcpAgentAssignmentsDocument>>();

function emptyExternalMcpRegistry(): ExternalMcpRegistry {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    external_servers: [],
  };
}

function emptyAssignmentsDocument(): ExternalMcpAgentAssignmentsDocument {
  return {
    schema_version: EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION,
    assignments: [],
  };
}

export function getCachedExternalMcpRegistry(repoRoot: string): ExternalMcpRegistry | undefined {
  return externalMcpRegistryCache.get(repoRoot);
}

export function getCachedExternalMcpAssignments(
  repoRoot: string,
): ExternalMcpAgentAssignmentsDocument | undefined {
  return externalMcpAssignmentsCache.get(repoRoot);
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

export async function prewarmExternalMcpAssignments(
  repoRoot: string,
): Promise<ExternalMcpAgentAssignmentsDocument> {
  const cached = externalMcpAssignmentsCache.get(repoRoot);
  if (cached) {
    return cached;
  }

  const pending = externalMcpAssignmentsLoads.get(repoRoot);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    try {
      const result = await loadExternalMcpAgentAssignments(repoRoot);
      // Fail closed: an invalid assignment file yields no assignments (and thus
      // no external servers), never a crash and never the wrong servers.
      const document = result.ok ? result.document : emptyAssignmentsDocument();
      if (!result.ok) {
        log.warn('external_mcp_assignments.prewarm.invalid', {
          repoRoot,
          errors: result.errors,
        });
      }
      externalMcpAssignmentsCache.set(repoRoot, document);
      return document;
    } catch (error) {
      const document = emptyAssignmentsDocument();
      externalMcpAssignmentsCache.set(repoRoot, document);
      log.warn('external_mcp_assignments.prewarm.failed', {
        repoRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return document;
    } finally {
      externalMcpAssignmentsLoads.delete(repoRoot);
    }
  })();

  // Same synchronous-set-before-await dedup contract as prewarmExternalMcpRegistry.
  externalMcpAssignmentsLoads.set(repoRoot, loadPromise);
  return loadPromise;
}

export function clearExternalMcpRegistryCache(repoRoot?: string): void {
  if (repoRoot) {
    externalMcpRegistryCache.delete(repoRoot);
    externalMcpRegistryLoads.delete(repoRoot);
    externalMcpRegistryHealthCache.delete(repoRoot);
    externalMcpAssignmentsCache.delete(repoRoot);
    externalMcpAssignmentsLoads.delete(repoRoot);
    return;
  }

  externalMcpRegistryCache.clear();
  externalMcpRegistryLoads.clear();
  externalMcpRegistryHealthCache.clear();
  externalMcpAssignmentsCache.clear();
  externalMcpAssignmentsLoads.clear();
}
