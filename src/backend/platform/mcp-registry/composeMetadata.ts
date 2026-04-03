/**
 * Registry-to-compose metadata mapper.
 *
 * Returns compose-facing service metadata for enabled services.
 * Consumers use this instead of hardcoding service names, ports,
 * or image references.
 */
import type { McpComposeMetadata, McpRegistry } from './types.js';

/** Compose metadata for a single enabled service, keyed by registry ID. */
export interface EnabledComposeService {
  id: string;
  displayName: string;
  compose: McpComposeMetadata;
}

/**
 * Return compose-facing metadata for all enabled services.
 * Disabled services are excluded.
 */
export function getEnabledComposeServices(registry: McpRegistry): EnabledComposeService[] {
  return registry.services
    .filter((svc) => svc.enabled)
    .map((svc) => ({
      id: svc.id,
      displayName: svc.displayName,
      compose: svc.compose,
    }));
}
