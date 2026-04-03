import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  EnvironmentStatusResponse,
  ObservabilitySnapshotResponse,
  QueueStatusResponse,
} from '../../shared/desktopContract';
import { useObservedState } from './useObservedState';
import type { DesktopShellClient } from '../services/desktopShellClient';
import {
  createMockClient,
  createQueueStatus,
  createEnvironmentStatus,
  createObservabilitySnapshot,
} from '../../test';

afterEach(() => {
  cleanup();
});

function createQueueResponse(message: string): QueueStatusResponse {
  return createQueueStatus({ message });
}

function createEnvironmentResponse(validationSummary: string): EnvironmentStatusResponse {
  return createEnvironmentStatus({
    message: `${validationSummary} environment snapshot.`,
    validationSummary,
    repoRoot: '/repo/root',
    packageOutputDir: 'src/frontend/desktop/release/mac-arm64',
    packageArtifactName: 'TaskSail.app',
    launchPolicy: 'Host native.',
    contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack',
    contextPackWritePlanHint: 'Use --write-plan.',
    bootstrapFlowHint: 'Use bootstrap flags.',
  });
}

function createObservabilityResponse(
  currentState: ObservabilitySnapshotResponse['currentState'],
  message: string,
): ObservabilitySnapshotResponse {
  return createObservabilitySnapshot({
    currentState,
    message,
    policyBoundary: 'Repo artifacts remain authoritative.',
  });
}

function createClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    getQueueStatus: vi.fn().mockResolvedValue({
      ok: true,
      response: createQueueResponse('Initial queue snapshot.'),
    }),
    getEnvironmentStatus: vi.fn().mockResolvedValue({
      ok: true,
      response: createEnvironmentResponse('Initial helpers available.'),
    }),
    getObservabilitySnapshot: vi.fn().mockResolvedValue({
      ok: true,
      response: createObservabilityResponse('active', 'Initial observability snapshot.'),
    }),
    ...overrides,
  });
}

function ObservedStateHarness({
  refreshKey = 'active',
  client,
}: {
  refreshKey?: string;
  client: DesktopShellClient;
}): JSX.Element {
  const {
    queueStatusMessage,
    environmentStatus,
    observability,
    contractError,
    refreshObservedState,
  } = useObservedState(refreshKey, client);

  return (
    <section>
      <div data-testid="queue-status">{queueStatusMessage}</div>
      <div data-testid="environment-summary">{environmentStatus?.validationSummary ?? 'no-environment'}</div>
      <div data-testid="observability-state">{observability?.currentState ?? 'no-observability'}</div>
      <div data-testid="error-message">{contractError || 'no-error'}</div>
      <button type="button" onClick={() => void refreshObservedState()}>
        Refresh observed state
      </button>
    </section>
  );
}

describe('useObservedState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('populates all read-side state on successful initial load', async () => {
    const client = createClient();

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-status')).toHaveTextContent('Initial queue snapshot.');
    });
    expect(screen.getByTestId('environment-summary')).toHaveTextContent('Initial helpers available.');
    expect(screen.getByTestId('observability-state')).toHaveTextContent('active');
    expect(screen.getByTestId('error-message')).toHaveTextContent('no-error');
  });

  it('applies successful environment and observability updates even when queue fails', async () => {
    const client = createClient({
      getQueueStatus: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Queue refresh failed.',
        action: 'queue.readStatus',
      }),
      getEnvironmentStatus: vi.fn().mockResolvedValue({
        ok: true,
        response: createEnvironmentResponse('Environment still updated.'),
      }),
      getObservabilitySnapshot: vi.fn().mockResolvedValue({
        ok: true,
        response: createObservabilityResponse('idle', 'Observability still updated.'),
      }),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Queue refresh failed.');
    });
    expect(screen.getByTestId('environment-summary')).toHaveTextContent('Environment still updated.');
    expect(screen.getByTestId('observability-state')).toHaveTextContent('idle');
    expect(screen.getByTestId('queue-status')).toHaveTextContent('Loading queue status…');
  });

  it('surfaces observability result failures', async () => {
    const client = createClient({
      getObservabilitySnapshot: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Observability refresh failed.',
        action: 'observability.readSnapshot',
      }),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Observability refresh failed.');
    });
  });

  it('surfaces environment result failures', async () => {
    const client = createClient({
      getEnvironmentStatus: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Environment refresh failed.',
        action: 'environment.readStatus',
      }),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Environment refresh failed.');
    });
  });

  it('normalizes thrown refresh failures to the current fallback message', async () => {
    const client = createClient({
      getQueueStatus: vi.fn().mockRejectedValueOnce('boom'),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Queue status unavailable.');
    });
    expect(screen.getByTestId('environment-summary')).toHaveTextContent('Initial helpers available.');
    expect(screen.getByTestId('observability-state')).toHaveTextContent('active');
  });

  it('partial failure: one throw, two succeed', async () => {
    const client = createClient({
      getObservabilitySnapshot: vi.fn().mockRejectedValueOnce(new Error('snapshot exploded')),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('snapshot exploded');
    });
    expect(screen.getByTestId('queue-status')).toHaveTextContent('Initial queue snapshot.');
    expect(screen.getByTestId('environment-summary')).toHaveTextContent('Initial helpers available.');
    expect(screen.getByTestId('observability-state')).toHaveTextContent('no-observability');
  });

  it('aggregates multiple errors with semicolon separator', async () => {
    const client = createClient({
      getQueueStatus: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Queue broke.',
        action: 'queue.readStatus',
      }),
      getEnvironmentStatus: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Environment broke.',
        action: 'environment.readStatus',
      }),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Queue broke.; Environment broke.');
    });
    expect(screen.getByTestId('observability-state')).toHaveTextContent('active');
  });

  it('stale call is skipped when refreshKey changes before resolution', async () => {
    let resolveStaleQueue!: (v: unknown) => void;
    const staleQueuePromise = new Promise((resolve) => { resolveStaleQueue = resolve; });

    const freshQueueResponse = { ok: true as const, response: createQueueResponse('Fresh queue.') };
    const staleClient = createClient({
      getQueueStatus: vi.fn()
        .mockReturnValueOnce(staleQueuePromise)
        .mockResolvedValueOnce(freshQueueResponse),
    });

    const { rerender } = render(<ObservedStateHarness refreshKey="a" client={staleClient} />);

    // Trigger a new generation before the first resolves.
    rerender(<ObservedStateHarness refreshKey="b" client={staleClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-status')).toHaveTextContent('Fresh queue.');
    });

    // Now resolve the stale call — it should be ignored.
    await act(async () => {
      resolveStaleQueue({ ok: true, response: createQueueResponse('Stale queue.') });
    });

    expect(screen.getByTestId('queue-status')).toHaveTextContent('Fresh queue.');
    expect(screen.getByTestId('environment-summary')).toHaveTextContent('Initial helpers available.');
    expect(screen.getByTestId('observability-state')).toHaveTextContent('active');
  });

  it('updates state on a repeated refresh call', async () => {
    const client = createClient({
      getQueueStatus: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, response: createQueueResponse('Initial queue snapshot.') })
        .mockResolvedValueOnce({ ok: true, response: createQueueResponse('Refreshed queue snapshot.') }),
      getEnvironmentStatus: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, response: createEnvironmentResponse('Initial helpers available.') })
        .mockResolvedValueOnce({ ok: true, response: createEnvironmentResponse('Refreshed helpers available.') }),
      getObservabilitySnapshot: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, response: createObservabilityResponse('active', 'Initial observability snapshot.') })
        .mockResolvedValueOnce({ ok: true, response: createObservabilityResponse('idle', 'Refreshed observability snapshot.') }),
    });

    render(<ObservedStateHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-status')).toHaveTextContent('Initial queue snapshot.');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh observed state' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-status')).toHaveTextContent('Refreshed queue snapshot.');
    });
    expect(screen.getByTestId('environment-summary')).toHaveTextContent('Refreshed helpers available.');
    expect(screen.getByTestId('observability-state')).toHaveTextContent('idle');
  });

});
