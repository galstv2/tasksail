import { describe, it, expect } from 'vitest';
import {
  assertHealthSpecsConfigured,
  checkServiceHealth,
  checkAllServices,
} from '../healthcheck.js';
import type { ServiceHealthSpec } from '../types.js';

describe('checkServiceHealth', () => {
  const pmseSpec: ServiceHealthSpec = {
    name: 'test-service',
    url: 'http://localhost:9999/health',
    maxRetries: 3,
    retryIntervalMs: 10, // fast for tests
  };

  it('returns healthy on first successful check', async () => {
    const checkFn = async (_url: string): Promise<boolean> => true;

    const result = await checkServiceHealth(pmseSpec, checkFn);
    expect(result.healthy).toBe(true);
    expect(result.service).toBe('test-service');
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('retries and succeeds on later attempt', async () => {
    let callCount = 0;
    const checkFn = async (_url: string): Promise<boolean> => {
      callCount++;
      return callCount >= 2;
    };

    const result = await checkServiceHealth(pmseSpec, checkFn);
    expect(result.healthy).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('reports failure after exhausting retries', async () => {
    const checkFn = async (_url: string): Promise<boolean> => false;

    const result = await checkServiceHealth(pmseSpec, checkFn);
    expect(result.healthy).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toContain('did not become healthy');
  });

  it('handles checkFn throwing errors', async () => {
    let callCount = 0;
    const checkFn = async (_url: string): Promise<boolean> => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Connection refused');
      }
      return true;
    };

    const result = await checkServiceHealth(pmseSpec, checkFn);
    expect(result.healthy).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('uses default retries when not specified', async () => {
    const spec: ServiceHealthSpec = {
      name: 'default-retries',
      url: 'http://localhost:9999/health',
    };

    // Should use default maxRetries (10) - we just verify it does not throw
    const checkFn = async (_url: string): Promise<boolean> => true;
    const result = await checkServiceHealth(spec, checkFn);
    expect(result.healthy).toBe(true);
  });
});

describe('checkAllServices', () => {
  it('checks multiple services in parallel', async () => {
    const specs: ServiceHealthSpec[] = [
      { name: 'svc-a', url: 'http://localhost:8811/health', maxRetries: 1, retryIntervalMs: 10 },
      { name: 'svc-b', url: 'http://localhost:9999', maxRetries: 1, retryIntervalMs: 10 },
    ];

    const checkFn = async (url: string): Promise<boolean> => url.includes('8811');

    const results = await checkAllServices(specs, checkFn);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.service === 'svc-a')?.healthy).toBe(true);
    expect(results.find((r) => r.service === 'svc-b')?.healthy).toBe(false);
  });
});

describe('assertHealthSpecsConfigured', () => {
  it('throws when no enabled services are configured', () => {
    expect(() => assertHealthSpecsConfigured([], 'bootstrap')).toThrow(
      'No enabled container services are configured for bootstrap.',
    );
  });

  it('accepts a non-empty service list', () => {
    expect(() => assertHealthSpecsConfigured([{
      name: 'svc-a',
      url: 'http://localhost:8811/health',
    }], 'healthcheck')).not.toThrow();
  });
});
