import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParentArchivePreviewModal } from './ParentArchivePreviewModal';

afterEach(() => cleanup());

describe('ParentArchivePreviewModal', () => {
  it('renders MarkdownView content with provenance', () => {
    render(
      <ParentArchivePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        archive={{
          action: 'planner.readParentArchiveMarkdown',
          mode: 'loaded',
          accepted: true,
          message: 'Loaded.',
          taskId: 'parent-1',
          title: 'Parent Task',
          archivePath: '/tmp/archive.md',
          archivedAt: '2026-05-17T08:42:11Z',
          content: '# Parent Archive\n\nBody',
          sizeBytes: 21,
        }}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Parent archive preview' })).toHaveClass('modal-shell--terminal');
    expect(screen.getByText('Parent Archive')).toBeInTheDocument();
    expect(screen.getByText('/tmp/archive.md')).toBeInTheDocument();
    expect(screen.getByText('ESC to close')).toBeInTheDocument();
  });

  it('renders loading and retryable error states', () => {
    const { rerender } = render(
      <ParentArchivePreviewModal isOpen={true} onClose={vi.fn()} loading={true} error={null} archive={null} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading parent archive...');
    rerender(<ParentArchivePreviewModal isOpen={true} onClose={vi.fn()} loading={false} error="Failed" archive={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
