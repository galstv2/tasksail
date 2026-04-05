import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalDraft } from '../plannerComposer';
import { usePlannerFlow } from './usePlannerFlow';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { createMockClient, createPlannerSubmitResponse } from '../../test';

afterEach(() => {
  cleanup();
});

function createPlannerClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    submitPlannerDraft: vi.fn().mockResolvedValue({
      ok: true,
      response: createPlannerSubmitResponse({
        message:
          'Planner draft accepted for local review only. No dropbox file or helper script was invoked.',
        draftTitle: 'Refine planner composer review flow',
      }),
    }),
    ...overrides,
  });
}

function PlannerFlowHarness({ client }: { client: DesktopShellClient }): JSX.Element {
  const [contractError, setContractError] = useState('');
  const draft = useMemo(
    () =>
      createLocalDraft(
        {
          title: 'Refine planner composer review flow',
          summary: 'Validate standard planner action orchestration.',
          desiredOutcome: 'Standard planner flow is moved behind a dedicated hook.',
          constraints: ['Keep dry-run semantics intact.'],
          acceptanceSignals: ['Planner response is reflected in hook state.'],
          planningNotes: 'Hook test harness only.',
          suggestedPath: 'sequential',
        },
      ),
    [],
  );
  const {
    lastActionMessage,
    submissionPath,
    operatorMode,
    runPlannerAction,
  } = usePlannerFlow(setContractError, client);

  return (
    <section>
      <div data-testid="last-action-message">{lastActionMessage}</div>
      <div data-testid="submission-path">{submissionPath || 'no-submission-path'}</div>
      <div data-testid="operator-mode">{operatorMode}</div>
      <div data-testid="contract-error">{contractError || 'no-error'}</div>
      <button type="button" onClick={() => void runPlannerAction(draft, 'compose')}>
        Run planner compose
      </button>
      <button type="button" onClick={() => void runPlannerAction(draft, 'confirm')}>
        Run planner confirm
      </button>
    </section>
  );
}

describe('usePlannerFlow', () => {
  it('keeps local-only semantics on dry-run success', async () => {
    const client = createPlannerClient();

    render(<PlannerFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run planner compose' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('last-action-message')).toHaveTextContent(
        'Planner draft accepted for local review only. No dropbox file or helper script was invoked.',
      );
    });
    expect(screen.getByTestId('submission-path')).toHaveTextContent('no-submission-path');
    expect(screen.getByTestId('operator-mode')).toHaveTextContent('planning');
    expect(screen.getByTestId('contract-error')).toHaveTextContent('no-error');
    expect(client.submitPlannerDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({
        title: expect.any(String),
      }),
      'compose',
    );
  });

  it('sets the submitted path on confirm success', async () => {
    const client = createPlannerClient({
      submitPlannerDraft: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.submitDraft',
          mode: 'submitted',
          accepted: true,
          message: 'Planner draft submitted via platform queue module.',
          draftTitle: 'Refine planner composer review flow',
          suggestedPath: 'sequential',
          submittedPath: 'AgentWorkSpace/dropbox/refine-planner-composer-review-flow.md',
          observationMode: false,
        },
      }),
    });

    render(<PlannerFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run planner confirm' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('submission-path')).toHaveTextContent(
        'AgentWorkSpace/dropbox/refine-planner-composer-review-flow.md',
      );
    });
  });

  it('switches operator mode when confirm requests observation mode', async () => {
    const client = createPlannerClient({
      submitPlannerDraft: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.submitDraft',
          mode: 'submitted',
          accepted: true,
          message: 'Planner draft submitted and observation mode is now active.',
          draftTitle: 'Refine planner composer review flow',
          suggestedPath: 'sequential',
          submittedPath: 'AgentWorkSpace/dropbox/refine-planner-composer-review-flow.md',
          observationMode: true,
        },
      }),
    });

    render(<PlannerFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run planner confirm' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('operator-mode')).toHaveTextContent('observation');
    });
  });

  it('concatenates validation details for error results', async () => {
    const client = createPlannerClient({
      submitPlannerDraft: vi.fn().mockResolvedValue({
        ok: false,
        action: 'planner.submitDraft',
        error: 'Planner draft validation failed before dropbox submission.',
        details: ['Request summary is required before submitting to dropbox.'],
      }),
    });

    render(<PlannerFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run planner compose' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('contract-error')).toHaveTextContent(
        'Planner draft validation failed before dropbox submission. Request summary is required before submitting to dropbox.',
      );
    });
  });

  it('surfaces the pmse message when error results have no details', async () => {
    const client = createPlannerClient({
      submitPlannerDraft: vi.fn().mockResolvedValue({
        ok: false,
        action: 'planner.submitDraft',
        error: 'Planner draft validation failed before dropbox submission.',
      }),
    });

    render(<PlannerFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run planner compose' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('contract-error')).toHaveTextContent(
        'Planner draft validation failed before dropbox submission.',
      );
    });
  });

  it('surfaces rejected planner submissions instead of failing silently', async () => {
    const client = createPlannerClient({
      submitPlannerDraft: vi.fn().mockRejectedValue(new Error('IPC planner submission failed.')),
    });

    render(<PlannerFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run planner confirm' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('contract-error')).toHaveTextContent(
        'IPC planner submission failed.',
      );
    });
  });
});
