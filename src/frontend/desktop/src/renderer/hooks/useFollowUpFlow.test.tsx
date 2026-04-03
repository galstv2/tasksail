import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalDraft, type ComposerStage, type PlannerDraftModel } from '../plannerComposer';
import type { CompletedTaskEntry } from '../selectors/appViewModel';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { useFollowUpFlow } from './useFollowUpFlow';
import type { OperatorMode } from './usePlannerFlow';
import { createMockClient, createFollowUpResponse } from '../../test';

afterEach(() => {
  cleanup();
});

const testCompletedTasks: CompletedTaskEntry[] = [
  {
    id: 'CAP-CUSTOM-TERMINAL-06',
    title: 'Older completed task',
    owner: 'product-manager',
    status: 'completed',
    summary: 'Completed task without eligible follow-up.',
    followUpEligible: false,
    followUpBlockedReason: 'Archive lineage is unresolved for this older task, so follow-up creation remains unavailable.',
  },
  {
    id: 'CAP-CUSTOM-TERMINAL-08',
    title: 'Most recent completed task',
    owner: 'product-manager',
    status: 'completed',
    summary: 'Completed task with eligible follow-up.',
    followUpEligible: true,
    followUpContext: {
      parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
      parentTaskTitle: 'Most recent completed task',
      parentQmdRecordId: 'record-08',
      parentQmdScope: 'orders-api',
      rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
      followupReason: 'Live follow-up integration needed.',
      carryForwardSummary: 'Carry-forward summary.',
      childTitle: 'Create child-task intake for live follow-up integration',
      requestedAdjustment: 'Integrate remaining live follow-up items.',
      desiredOutcome: 'Live integration complete.',
      constraints: [],
      acceptanceSignals: [],
      planningNotes: '',
      suggestedPath: 'sequential',
    },
  },
];

function createFollowUpClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    initiateFollowUp: vi.fn().mockResolvedValue({
      ok: true,
      response: createFollowUpResponse({
        message:
          'Follow-up draft staged locally only. No child task has been created and the closed parent task remains unchanged.',
        sourceTaskId: 'CAP-CUSTOM-TERMINAL-08',
        parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
      }),
    }),
    ...overrides,
  });
}

function FollowUpFlowHarness({ client }: { client: DesktopShellClient }): JSX.Element {
  const completedTasks = testCompletedTasks;
  const [draft, setDraft] = useState<PlannerDraftModel>(() => createLocalDraft({
    title: 'Test draft',
    summary: '',
    desiredOutcome: '',
    constraints: [],
    acceptanceSignals: [],
    planningNotes: '',
    suggestedPath: 'sequential',
  }));
  const [composerStage, setComposerStage] = useState<ComposerStage>('compose');
  const [contractError, setContractError] = useState('');
  const [lastActionMessage, setLastActionMessage] = useState('');
  const [submissionPath, setSubmissionPath] = useState('');
  const [operatorMode, setOperatorMode] = useState<OperatorMode>('planning');

  const {
    followUpSourceTaskId,
    selectedFollowUpCandidateId,
    selectedFollowUpTask,
    followUpPromptState,
    selectFollowUpCandidate,
    startFollowUpPlanning,
    runFollowUpAction,
  } = useFollowUpFlow({
    completedTasks,
    setDraft,
    setComposerStage,
    setContractError,
    setLastActionMessage,
    setSubmissionPath,
    setOperatorMode,
    client,
  });

  return (
    <section>
      <div data-testid="draft-title">{draft.title}</div>
      <div data-testid="draft-kind">{draft.taskKind}</div>
      <div data-testid="composer-stage">{composerStage}</div>
      <div data-testid="follow-up-source-id">{followUpSourceTaskId ?? 'none'}</div>
      <div data-testid="selected-follow-up-candidate-id">{selectedFollowUpCandidateId ?? 'none'}</div>
      <div data-testid="selected-follow-up-id">{selectedFollowUpTask?.id ?? 'none'}</div>
      <div data-testid="follow-up-prompt-kind">{followUpPromptState.kind}</div>
      <div data-testid="contract-error">{contractError || 'no-error'}</div>
      <div data-testid="last-action-message">{lastActionMessage || 'no-action'}</div>
      <div data-testid="submission-path">{submissionPath || 'no-submission-path'}</div>
      <div data-testid="operator-mode">{operatorMode}</div>
      <button type="button" onClick={() => selectFollowUpCandidate('CAP-CUSTOM-TERMINAL-08')}>
        Select eligible follow-up
      </button>
      <button type="button" onClick={() => selectFollowUpCandidate('CAP-CUSTOM-TERMINAL-06')}>
        Select blocked follow-up
      </button>
      <button type="button" onClick={() => startFollowUpPlanning()}>
        Start eligible follow-up
      </button>
      <button type="button" onClick={() => void runFollowUpAction(draft, 'preview')}>
        Run follow-up preview
      </button>
      <button type="button" onClick={() => void runFollowUpAction(draft, 'confirm')}>
        Run follow-up confirm
      </button>
    </section>
  );
}

describe('useFollowUpFlow', () => {
  it('prefills a child-task draft when an eligible completed task is selected', async () => {
    render(<FollowUpFlowHarness client={createFollowUpClient()} />);

    expect(screen.getByTestId('selected-follow-up-candidate-id')).toHaveTextContent(
      'CAP-CUSTOM-TERMINAL-08',
    );
    expect(screen.getByTestId('follow-up-prompt-kind')).toHaveTextContent('ready');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('draft-title')).toHaveTextContent(
        'Create child-task intake for live follow-up integration',
      );
    });
    expect(screen.getByTestId('draft-kind')).toHaveTextContent('child-task');
    expect(screen.getByTestId('composer-stage')).toHaveTextContent('compose');
    expect(screen.getByTestId('follow-up-source-id')).toHaveTextContent('CAP-CUSTOM-TERMINAL-08');
    expect(screen.getByTestId('selected-follow-up-id')).toHaveTextContent('CAP-CUSTOM-TERMINAL-08');
    expect(screen.getByTestId('last-action-message')).toHaveTextContent(
      'Follow-up planner prefilled from completed task CAP-CUSTOM-TERMINAL-08.',
    );
  });

  it('surfaces the blocked reason for unresolved archive lineage', async () => {
    render(<FollowUpFlowHarness client={createFollowUpClient()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select blocked follow-up' }));
    });

    expect(screen.getByTestId('follow-up-prompt-kind')).toHaveTextContent('blocked');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('contract-error')).toHaveTextContent(
        'Archive lineage is unresolved for this older task, so follow-up creation remains unavailable.',
      );
    });
    expect(screen.getByTestId('selected-follow-up-id')).toHaveTextContent('none');
  });

  it('preserves non-reopened parent semantics on dry-run success', async () => {
    render(<FollowUpFlowHarness client={createFollowUpClient()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run follow-up preview' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('last-action-message')).toHaveTextContent(
        'Follow-up draft staged locally only. No child task has been created and the closed parent task remains unchanged.',
      );
    });
    expect(screen.getByTestId('submission-path')).toHaveTextContent('no-submission-path');
    expect(screen.getByTestId('operator-mode')).toHaveTextContent('planning');
  });

  it('sets observation mode and submitted path on confirm success', async () => {
    const client = createFollowUpClient({
      initiateFollowUp: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'followup.begin',
          mode: 'submitted',
          accepted: true,
          message:
            'Follow-up child task created via platform queue module. The closed parent task remains unchanged while queue automation can claim the new child-task intake from AgentWorkSpace/dropbox/.',
          suggestedTaskKind: 'child-task',
          sourceTaskId: 'CAP-CUSTOM-TERMINAL-08',
          parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
          rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
          submittedPath: 'AgentWorkSpace/dropbox/create-child-task-intake-for-live-follow-up-integration.md',
          reopenedTask: false,
        },
      }),
    });

    render(<FollowUpFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run follow-up confirm' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('submission-path')).toHaveTextContent(
        'AgentWorkSpace/dropbox/create-child-task-intake-for-live-follow-up-integration.md',
      );
    });
    expect(screen.getByTestId('operator-mode')).toHaveTextContent('observation');
  });

  it('surfaces follow-up failure details in a single message', async () => {
    const client = createFollowUpClient({
      initiateFollowUp: vi.fn().mockResolvedValue({
        ok: false,
        action: 'followup.begin',
        error: 'Follow-up validation failed.',
        details: ['Carry-forward summary must stay explicit.'],
      }),
    });

    render(<FollowUpFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run follow-up preview' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('contract-error')).toHaveTextContent(
        'Follow-up validation failed. Carry-forward summary must stay explicit.',
      );
    });
  });

  it('prevents follow-up activation when lineage cannot be resolved', async () => {
    const client = createFollowUpClient();

    render(<FollowUpFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select blocked follow-up' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-prompt-kind')).toHaveTextContent('blocked');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('follow-up-source-id')).toHaveTextContent('none');
    });
    expect(screen.getByTestId('draft-kind')).toHaveTextContent('standard');
  });

  it('surfaces rejected follow-up submissions instead of failing silently', async () => {
    const client = createFollowUpClient({
      initiateFollowUp: vi.fn().mockRejectedValue(new Error('IPC follow-up submission failed.')),
    });

    render(<FollowUpFlowHarness client={client} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start eligible follow-up' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run follow-up confirm' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('contract-error')).toHaveTextContent(
        'IPC follow-up submission failed.',
      );
    });
  });
});
