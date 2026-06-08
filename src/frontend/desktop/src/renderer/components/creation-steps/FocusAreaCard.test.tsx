import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFocusAreaEntry } from '../../hooks/context-pack/useContextPackDraft';
import FocusAreaCard from './FocusAreaCard';

afterEach(() => {
  cleanup();
});

const focusArea = createFocusAreaEntry({
  key: 'f1',
  focusId: 'core',
  focusName: 'Core Module',
  primary: false,
  repositoryType: 'support',
});

const defaultProps = {
  focusArea,
  index: 0,
  busy: false,
  onFocusAreaFieldChange: vi.fn(),
  onRemoveFocusArea: vi.fn(),
};

describe('FocusAreaCard', () => {
  it('renders focus area heading with index', () => {
    render(<FocusAreaCard {...defaultProps} />);
    expect(screen.getByText('Focus area 1')).toBeInTheDocument();
  });

  it('remove button calls onRemoveFocusArea with key', () => {
    const onRemoveFocusArea = vi.fn();
    render(<FocusAreaCard {...defaultProps} onRemoveFocusArea={onRemoveFocusArea} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemoveFocusArea).toHaveBeenCalledWith('f1');
  });

  it('does not show a Primary/Support focus badge or toggle', () => {
    render(
      <FocusAreaCard
        {...defaultProps}
        focusArea={{ ...focusArea, primary: true, repositoryType: 'primary' }}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Primary|Support/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Primary')).not.toBeInTheDocument();
    expect(screen.queryByText('Support')).not.toBeInTheDocument();
  });

  it('renders a Category dropdown wired to focusCategory and hides Group/Focus type', () => {
    const onFocusAreaFieldChange = vi.fn();
    render(
      <FocusAreaCard
        {...defaultProps}
        focusArea={{ ...focusArea, focusCategory: 'service' }}
        onFocusAreaFieldChange={onFocusAreaFieldChange}
      />,
    );
    const categorySelect = screen.getByDisplayValue('Service');
    fireEvent.change(categorySelect, { target: { value: 'library' } });
    expect(onFocusAreaFieldChange).toHaveBeenCalledWith('f1', 'focusCategory', 'library');
    expect(screen.queryByText('Group')).not.toBeInTheDocument();
    expect(screen.queryByText('Focus type')).not.toBeInTheDocument();
  });

  it('field change calls onFocusAreaFieldChange', () => {
    const onFocusAreaFieldChange = vi.fn();
    render(<FocusAreaCard {...defaultProps} onFocusAreaFieldChange={onFocusAreaFieldChange} />);
    const focusIdInput = screen.getAllByRole('textbox').find(
      (i) => (i as HTMLInputElement).value === 'core',
    );
    fireEvent.change(focusIdInput!, { target: { value: 'new-id' } });
    expect(onFocusAreaFieldChange).toHaveBeenCalledWith('f1', 'focusId', 'new-id');
  });

  it('shows advisory warning for absolute relative paths', () => {
    render(
      <FocusAreaCard
        {...defaultProps}
        focusArea={{ ...focusArea, relativePath: '/services/core' }}
      />,
    );

    expect(
      screen.getByText('Relative path should not start with "/".'),
    ).toBeInTheDocument();
  });

  it('shows advisory warning for traversal relative paths', () => {
    render(
      <FocusAreaCard
        {...defaultProps}
        focusArea={{ ...focusArea, relativePath: '../services/core' }}
      />,
    );

    expect(
      screen.getByText('Relative path should not contain a ".." segment.'),
    ).toBeInTheDocument();
  });

  it('shows advisory warning when primary focus area has no relative path', () => {
    render(
      <FocusAreaCard
        {...defaultProps}
        focusArea={{ ...focusArea, primary: true, repositoryType: 'primary', relativePath: '   ' }}
      />,
    );

    expect(
      screen.getByText('The working folder needs a relative path.'),
    ).toBeInTheDocument();
  });
});
