import http from 'node:http';
import type { ServiceHealthSpec, HealthResult } from './types.js';

/**
 * Perform a single HTTP GET request.
 * Resolves true if the response status is 2xx, false otherwise.
 */
function httpGet(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      // Drain response body to avoid memory leaks
      res.resume();
      const status = res.statusCode ?? 0;
      resolve(status >= 200 && status < 300);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Delay helper that returns a promise resolving after the given ms.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check the health of a single service by polling its HTTP endpoint.
 *
 * The checkFn parameter allows injection of a custom check function
 * for testing without real sockets.
 */
export async function checkServiceHealth(
  spec: ServiceHealthSpec,
  checkFn: (url: string) => Promise<boolean> = httpGet,
): Promise<HealthResult> {
  const maxRetries = spec.maxRetries ?? 10;
  const retryIntervalMs = spec.retryIntervalMs ?? 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ok = await checkFn(spec.url);
      if (ok) {
        return {
          service: spec.name,
          healthy: true,
          attempts: attempt,
        };
      }
    } catch {
      // Fall through to retry
    }

    if (attempt < maxRetries) {
      await delay(retryIntervalMs);
    }
  }

  return {
    service: spec.name,
    healthy: false,
    attempts: maxRetries,
    error: `Service ${spec.name} at ${spec.url} did not become healthy after ${maxRetries} attempts`,
  };
}

/**
 * Check health of multiple services in parallel.
 */
export async function checkAllServices(
  specs: ServiceHealthSpec[],
  checkFn?: (url: string) => Promise<boolean>,
): Promise<HealthResult[]> {
  return Promise.all(specs.map((spec) => checkServiceHealth(spec, checkFn)));
}

export function assertHealthSpecsConfigured(
  specs: ServiceHealthSpec[],
  context: 'bootstrap' | 'healthcheck',
): void {
  if (specs.length === 0) {
    throw new Error(
      `No enabled container services are configured for ${context}. ` +
      'Enable at least one MCP registry service before starting or checking containers.',
    );
  }
}
