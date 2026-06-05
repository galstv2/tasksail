import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ArtifactReference } from '../../../shared/desktopContract';
import ArtifactReferencesSection from './ArtifactReferencesSection';

afterEach(() => {
  cleanup();
});

const TEST_TASK_ID = 'task-test-001';

function makeArtifact(overrides: Partial<ArtifactReference> & { taskId?: string | null } = {}): ArtifactReference & { taskId?: string | null } {
  return {
    label: 'professional-task.md',
    path: `AgentWorkSpace/tasks/${TEST_TASK_ID}/handoffs/professional-task.md`,
    kind: 'file',
    status: 'present',
    detail: 'Main task workspace',
    ...overrides,
  };
}

describe('ArtifactReferencesSection', () => {
  it('shows empty state when no artifacts', () => {
    render(<ArtifactReferencesSection artifactReferences={[]} />);
    expect(screen.getByText('No files have been created yet. They will appear here as the task progresses.')).toBeInTheDocument();
  });

  it('renders artifact label and Available status', () => {
    render(<ArtifactReferencesSection artifactReferences={[makeArtifact()]} />);
    expect(screen.getByText('professional-task.md')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('renders Empty status for empty artifacts', () => {
    render(
      <ArtifactReferencesSection
        artifactReferences={[makeArtifact({ status: 'empty', label: 'spec.md' })]}
      />,
    );
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('renders Not found status for missing artifacts', () => {
    render(
      <ArtifactReferencesSection
        artifactReferences={[makeArtifact({ status: 'missing', label: 'missing.md' })]}
      />,
    );
    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('renders detail text when provided', () => {
    render(
      <ArtifactReferencesSection
        artifactReferences={[makeArtifact({ detail: 'Contains task definition' })]}
      />,
    );
    expect(screen.getByText('Contains task definition')).toBeInTheDocument();
  });

  it('renders section title', () => {
    render(<ArtifactReferencesSection artifactReferences={[]} />);
    expect(screen.getByText('Task Files')).toBeInTheDocument();
  });

  it('groups task-tagged artifacts by taskId and shows task labels', () => {
    const artifacts = [
      makeArtifact({ taskId: 'TASK-A', label: 'handoff-a.md', path: 'a/handoff.md' }),
      makeArtifact({ taskId: 'TASK-B', label: 'handoff-b.md', path: 'b/handoff.md' }),
    ];
    render(<ArtifactReferencesSection artifactReferences={artifacts} />);

    // Both labels are visible
    expect(screen.getByText('handoff-a.md')).toBeInTheDocument();
    expect(screen.getByText('handoff-b.md')).toBeInTheDocument();

    // Task group labels are shown
    expect(screen.getByLabelText('Artifacts for task TASK-A')).toBeInTheDocument();
    expect(screen.getByLabelText('Artifacts for task TASK-B')).toBeInTheDocument();
  });

  it('repeated handoff labels across tasks remain distinguishable via task group labels', () => {
    const artifacts = [
      makeArtifact({ taskId: 'TASK-A', label: 'professional-task.md', path: 'a/handoff.md' }),
      makeArtifact({ taskId: 'TASK-B', label: 'professional-task.md', path: 'b/handoff.md' }),
    ];
    render(<ArtifactReferencesSection artifactReferences={artifacts} />);

    // Both groups exist even though the labels are the same
    expect(screen.getByLabelText('Artifacts for task TASK-A')).toBeInTheDocument();
    expect(screen.getByLabelText('Artifacts for task TASK-B')).toBeInTheDocument();

    // Two instances of the same label are present
    const labels = screen.getAllByText('professional-task.md');
    expect(labels).toHaveLength(2);
  });

  it('does not show task group label when only one unscoped (no taskId) artifact group', () => {
    const artifacts = [makeArtifact({ taskId: undefined, label: 'handoff.md', path: 'handoff.md' })];
    render(<ArtifactReferencesSection artifactReferences={artifacts} />);
    expect(screen.getByText('handoff.md')).toBeInTheDocument();
    // No group label for unscoped single-task scenario
    expect(screen.queryByLabelText(/Artifacts for task/)).not.toBeInTheDocument();
  });
});
