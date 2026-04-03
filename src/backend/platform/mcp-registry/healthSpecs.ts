/**
 * Registry-to-health-spec mapper.
 *
 * Replaces the hardcoded DEFAULT_SERVICES array in container/types.ts.
 * Only enabled services are included in the output.
 */
import type { ServiceHealthSpec } from '../container/types.js';
import type { McpRegistry } from './types.js';

/**
 * Derive ServiceHealthSpec[] from the registry.
 * Only includes services where enabled === true.
 */
export function toServiceHealthSpecs(registry: McpRegistry): ServiceHealthSpec[] {
  return registry.services
    .filter((svc) => svc.enabled)
    .map((svc) => ({
      name: svc.id,
      url: svc.health.url,
      maxRetries: svc.health.maxRetries,
      retryIntervalMs: svc.health.retryIntervalMs,
    }));
}
