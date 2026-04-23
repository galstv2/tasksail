import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ArtifactReference } from '../../../shared/desktopContract';
import ArtifactReferencesSection from './ArtifactReferencesSection';

afterEach(() => {
  cleanup();
});

const TEST_TASK_ID = 'task-test-001';

function makeArtifact(overrides: Partial<ArtifactReference> = {}): ArtifactReference {
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
});
