import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider, useObservabilityContext } from './ObservabilityContext';
import {
  createMockClient,
  createQueueStatus,
  createEnvironmentStatus,
  createObservabilitySnapshot,
} from '../../test';

afterEach(() => {
  cleanup();
});

describe('ObservabilityContext', () => {
  it('throws when used outside ObservabilityProvider', () => {
    expect(() => {
      renderHook(() => useObservabilityContext());
    }).toThrow('useObservabilityContext must be used within an ObservabilityProvider');
  });

  it('exposes all expected fields from useObservedState', async () => {
    const client = createMockClient({
      getQueueStatus: vi.fn().mockResolvedValue({
        ok: true,
        response: createQueueStatus({ message: 'Queue ready.' }),
      }),
      getEnvironmentStatus: vi.fn().mockResolvedValue({
        ok: true,
        response: createEnvironmentStatus({ message: 'Env ready.' }),
      }),
      getObservabilitySnapshot: vi.fn().mockResolvedValue({
        ok: true,
        response: createObservabilitySnapshot({
          message: 'Snapshot ready.',
          currentState: 'active',
          policyBoundary: 'standard',
        }),
      }),
    });

    function wrapper({ children }: { children: React.ReactNode }) {
      return <ObservabilityProvider client={client}>{children}</ObservabilityProvider>;
    }

    const { result } = renderHook(() => useObservabilityContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.queueStatusMessage).toBe('Queue ready.');
    });

    expect(result.current.observability).not.toBeNull();
    expect(result.current.observability?.currentState).toBe('active');
    expect(result.current.environmentStatus).not.toBeNull();
    expect(result.current.contractError).toBe('');
    expect(typeof result.current.setContractError).toBe('function');
    expect(typeof result.current.refreshObservedState).toBe('function');
  });

});
