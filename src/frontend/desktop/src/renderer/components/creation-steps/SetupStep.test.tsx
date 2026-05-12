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
  wizardStep: 'project-type' as const,
  wizardParts: [],
  onWizardStepChange: vi.fn(),
  onWizardAddPart: vi.fn(),
  onWizardUpdatePart: vi.fn(),
  onWizardRemovePart: vi.fn(),
};

describe('SetupStep', () => {
  it('renders creation origin toggle', () => {
    render(<SetupStep {...defaultProps} />);
    expect(screen.getByRole('radio', { name: 'Existing project' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'New project' })).toBeInTheDocument();
  });

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

  it('creation-mode select uses infrastructure estate labels without "platform"', () => {
    render(<SetupStep {...defaultProps} />);
    const select = screen.getByRole('combobox', { name: 'Creation mode' });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.text);
    expect(options).toContain('Monolith');
    expect(options).toContain('Monolith + infrastructure');
    expect(options).toContain('Distributed');
    expect(options).toContain('Distributed + infrastructure');
    expect(options.some((t) => /platform repos/i.test(t))).toBe(false);
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

  it('renders the build wizard when new project origin is selected', () => {
    render(
      <SetupStep
        {...defaultProps}
        draft={{ ...defaultDraft, creationOrigin: 'new' }}
      />,
    );

    expect(screen.getByText('How is this project organized?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan for repositories' })).toBeNull();
  });

  it('falls back safely when wizard props are missing', () => {
    render(
      <SetupStep
        {...defaultProps}
        draft={{ ...defaultDraft, creationOrigin: 'new' }}
        wizardStep={undefined}
        wizardParts={undefined}
        onWizardStepChange={undefined}
        onWizardAddPart={undefined}
        onWizardUpdatePart={undefined}
        onWizardRemovePart={undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Scan for repositories' })).toBeInTheDocument();
  });
});
