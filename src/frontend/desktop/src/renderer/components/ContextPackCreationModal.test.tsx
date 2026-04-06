import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCreationModalProps } from '../contextPackCreationTypes';
import ContextPackCreationModal from './ContextPackCreationModal';

afterEach(() => {
  cleanup();
});

function makeProps(overrides: Partial<ContextPackCreationModalProps> = {}): ContextPackCreationModalProps {
  return {
    isOpen: true,
    busy: false,
    step: 'setup',
    draft: {
      contextPackDir: '/tmp/pack',
      discoveryRoot: '/tmp',
      mode: 'distributed',
      contextPackId: 'pack-1',
      estateName: 'Test Estate',
      defaultScopeMode: 'focused',
      creationOrigin: 'existing',
      repositories: [],
      focusAreas: [],
    },
    discoveryStatus: 'idle',
    discoverySummary: '',
    error: '',
    message: '',
    canGoBack: false,
    canGoNext: true,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onBrowseContextPackDir: vi.fn(),
    onBrowseDiscoveryRoot: vi.fn(),
    onChangeMode: vi.fn(),
    onDraftFieldChange: vi.fn(),
    onDiscoverPrefill: vi.fn(),
    onAddRepository: vi.fn(),
    onRemoveRepository: vi.fn(),
    onRepositoryFieldChange: vi.fn(),
    onSetPrimaryRepository: vi.fn(),
    onAddFocusArea: vi.fn(),
    onRemoveFocusArea: vi.fn(),
    onFocusAreaFieldChange: vi.fn(),
    onSetPrimaryFocusArea: vi.fn(),
    wizardStep: 'project-type',
    wizardParts: [],
    onWizardStepChange: vi.fn(),
    onWizardAddPart: vi.fn(),
    onWizardUpdatePart: vi.fn(),
    onWizardRemovePart: vi.fn(),
    onBack: vi.fn(),
    onNext: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
}

describe('ContextPackCreationModal', () => {
  it('returns null when not open', () => {
    const { container } = render(<ContextPackCreationModal {...makeProps({ isOpen: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open', () => {
    render(<ContextPackCreationModal {...makeProps()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create context pack')).toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    render(<ContextPackCreationModal {...makeProps({ error: 'Something went wrong' })} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows message when message is set', () => {
    render(<ContextPackCreationModal {...makeProps({ message: 'Step 1 of 3' })} />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('shows Next button when canGoNext is true', () => {
    render(<ContextPackCreationModal {...makeProps({ canGoNext: true })} />);
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('shows Create button when canGoNext is false', () => {
    render(<ContextPackCreationModal {...makeProps({ canGoNext: false })} />);
    const buttons = screen.getAllByText('Create context pack');
    // One is the h2 heading, one is the button
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows Creating… when busy and canGoNext is false', () => {
    render(<ContextPackCreationModal {...makeProps({ canGoNext: false, busy: true })} />);
    expect(screen.getByText('Creating…')).toBeInTheDocument();
  });

  it('shows Back button when canGoBack is true', () => {
    render(<ContextPackCreationModal {...makeProps({ canGoBack: true })} />);
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('hides Back button when canGoBack is false', () => {
    render(<ContextPackCreationModal {...makeProps({ canGoBack: false })} />);
    expect(screen.queryByText('Back')).toBeNull();
  });

  it('calls onNext when Next is clicked', () => {
    const onNext = vi.fn();
    render(<ContextPackCreationModal {...makeProps({ onNext })} />);
    fireEvent.click(screen.getByText('Next'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('calls onClose when Close is clicked', () => {
    const onClose = vi.fn();
    render(<ContextPackCreationModal {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables buttons when busy', () => {
    render(<ContextPackCreationModal {...makeProps({ busy: true })} />);
    expect(screen.getByText('Close')).toBeDisabled();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  it('renders labeled step indicator', () => {
    render(<ContextPackCreationModal {...makeProps({ step: 'shape' })} />);
    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Shape')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('uses wizard back navigation inside setup for new projects', () => {
    const onWizardStepChange = vi.fn();
    render(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'location',
          onWizardStepChange,
        })}
      />,
    );

    fireEvent.click(screen.getByText('Back'));
    expect(onWizardStepChange).toHaveBeenCalledWith('project-type');
  });

  it('shows continue to details for configured build-parts step', () => {
    const onNext = vi.fn();
    render(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'build-parts',
          wizardParts: [
            {
              key: 'part-1',
              name: 'Orders API',
              role: 'backend',
              language: 'python',
              languageIsOther: false,
              location: '/workspace/orders-api',
              primary: true,
              editing: false,
            },
          ],
          onNext,
        })}
      />,
    );

    fireEvent.click(screen.getByText('Continue to details →'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('disables continue to details until a part is configured', () => {
    render(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'build-parts',
          wizardParts: [
            {
              key: 'part-1',
              name: 'Orders API',
              role: '',
              language: '',
              languageIsOther: false,
              location: '/workspace/orders-api',
              primary: true,
              editing: true,
            },
          ],
        })}
      />,
    );

    const button = screen.getByText('Continue to details →');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Add at least one part with a role and language');
  });
});
