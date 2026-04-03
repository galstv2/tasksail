import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCreationDraft } from '../../contextPackCreationTypes';
import { INITIAL_DRAFT } from '../../hooks/useContextPackDraft';
import SetupStep from './SetupStep';

afterEach(() => {
  cleanup();
});

const defaultDraft: ContextPackCreationDraft = {
  ...INITIAL_DRAFT,
  contextPackDir: '/tmp/pack',
  discoveryRoot: '/tmp/root',
  estateName: 'Test Estate',
};

const defaultProps = {
  busy: false,
  draft: defaultDraft,
  discoveryStatus: 'idle' as const,
  discoverySummary: 'No discovery results loaded yet.',
  onBrowseDiscoveryRoot: vi.fn(),
  onChangeMode: vi.fn(),
  onDraftFieldChange: vi.fn(),
  onDiscoverPrefill: vi.fn(),
};

describe('SetupStep', () => {
  it('renders discovery root input and read-only destination', () => {
    render(<SetupStep {...defaultProps} />);
    const inputs = screen.getAllByRole('textbox');
    const rootInput = inputs.find((i) => (i as HTMLInputElement).value === '/tmp/root');
    expect(rootInput).toBeDefined();
    expect(screen.getByText('/tmp/pack')).toBeInTheDocument();
  });

  it('browse button calls onBrowseDiscoveryRoot', () => {
    render(<SetupStep {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(defaultProps.onBrowseDiscoveryRoot).toHaveBeenCalled();
  });

  it('mode selector renders and calls onChangeMode', () => {
    const onChangeMode = vi.fn();
    render(<SetupStep {...defaultProps} onChangeMode={onChangeMode} />);
    const select = screen.getByRole('combobox', { name: 'Creation mode' });
    fireEvent.change(select, { target: { value: 'monolith' } });
    expect(onChangeMode).toHaveBeenCalledWith('monolith');
  });

  it('discover button calls onDiscoverPrefill', () => {
    const onDiscoverPrefill = vi.fn();
    render(<SetupStep {...defaultProps} onDiscoverPrefill={onDiscoverPrefill} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan for repositories' }));
    expect(onDiscoverPrefill).toHaveBeenCalled();
  });

  it('shows scanning text when discovery is loading', () => {
    render(<SetupStep {...defaultProps} discoveryStatus="loading" />);
    expect(screen.getByRole('button', { name: /Scanning/ })).toBeInTheDocument();
  });

  it('displays discovery summary after successful scan', () => {
    render(
      <SetupStep
        {...defaultProps}
        discoveryStatus="ready"
        discoverySummary="Found 2 repositories"
      />,
    );
    expect(screen.getByText('Found 2 repositories')).toBeInTheDocument();
  });

  it('shows destination placeholder when contextPackDir is empty', () => {
    render(
      <SetupStep
        {...defaultProps}
        draft={{ ...defaultDraft, contextPackDir: '' }}
      />,
    );
    expect(screen.getByText(/Set a discovery root/)).toBeInTheDocument();
  });

  it('disables buttons when busy', () => {
    render(<SetupStep {...defaultProps} busy={true} />);
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
});
