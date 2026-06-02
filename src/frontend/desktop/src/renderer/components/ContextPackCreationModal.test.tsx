import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    onDiscardDraft: vi.fn(),
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
    expect(screen.getByText('Create Context Pack')).toBeInTheDocument();
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
    render(<ContextPackCreationModal {...makeProps({ step: 'review', canGoNext: false })} />);
    const buttons = screen.getAllByText('Create Context Pack');
    // One is the h2 heading, one is the button
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows Creating… when busy and canGoNext is false', () => {
    render(<ContextPackCreationModal {...makeProps({ step: 'review', canGoNext: false, busy: true })} />);
    expect(screen.getByText('Creating…')).toBeInTheDocument();
  });

  it('keeps Next disabled with an accessible reason when shape gating fails', () => {
    render(
      <ContextPackCreationModal
        {...makeProps({
          step: 'shape',
          canGoNext: false,
          canGoNextReason: 'Mark at least one repository as primary to continue.',
        })}
      />,
    );

    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeDisabled();
    expect(nextButton).toHaveAttribute('aria-disabled', 'true');
    expect(nextButton).toHaveAttribute(
      'title',
      'Mark at least one repository as primary to continue.',
    );
    expect(
      screen.getByText('Mark at least one repository as primary to continue.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Context Pack' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables buttons when busy', () => {
    render(<ContextPackCreationModal {...makeProps({ busy: true })} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  it('renders step counter with current label and progressbar at the correct position', () => {
    render(<ContextPackCreationModal {...makeProps({ step: 'shape' })} />);
    expect(screen.getByText('Step 2 of 3 · Shape')).toBeInTheDocument();
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '2');
    expect(progressbar).toHaveAttribute('aria-valuemax', '3');
  });

  it('appends wizard sub-step label to subtitle while in new-project setup', () => {
    render(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'location',
        })}
      />,
    );
    expect(screen.getByText('Step 1 of 3 · Setup · Location')).toBeInTheDocument();
  });

  it('advances progressbar fractionally across wizard sub-steps', () => {
    const { rerender } = render(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'project-type',
        })}
      />,
    );

    const initial = screen.getByRole('progressbar') as HTMLElement;
    const fill = initial.querySelector('.creation-progress__fill') as HTMLElement;
    const firstWidth = fill.style.width;

    rerender(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'build-parts',
        })}
      />,
    );

    const advanced = screen.getByRole('progressbar') as HTMLElement;
    const fillAdvanced = advanced.querySelector('.creation-progress__fill') as HTMLElement;
    expect(fillAdvanced.style.width).not.toBe(firstWidth);
  });

  it('footer Continue advances from project-type to location in wizard', () => {
    const onWizardStepChange = vi.fn();
    render(
      <ContextPackCreationModal
        {...makeProps({
          draft: {
            ...makeProps().draft,
            creationOrigin: 'new',
          },
          wizardStep: 'project-type',
          onWizardStepChange,
        })}
      />,
    );

    fireEvent.click(screen.getByText('Continue'));
    expect(onWizardStepChange).toHaveBeenCalledWith('location');
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

  it('renders multiple git repository warnings under "Some folders were skipped"', () => {
    render(
      <ContextPackCreationModal
        {...makeProps({
          gitRepositoryWarnings: [
            {
              repoName: 'tools',
              path: '/estate/tools',
              relativePath: 'tools',
              message:
                'repo tools does not have .git folder, if you would like it part of this context pack please initialize git in this repo.',
            },
            {
              repoName: 'docs',
              path: '/estate/docs',
              relativePath: 'docs',
              message:
                'repo docs does not have .git folder, if you would like it part of this context pack please initialize git in this repo.',
            },
          ],
        })}
      />,
    );

    const callout = screen.getByRole('status');
    expect(callout).toHaveTextContent('Some folders were skipped');
    expect(callout).toHaveAttribute('aria-live', 'polite');
    const items = within(callout).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('repo tools does not have .git folder');
    expect(items[1]).toHaveTextContent('repo docs does not have .git folder');
  });

  it('does not render the skipped-folders callout when there are no warnings', () => {
    const { rerender } = render(
      <ContextPackCreationModal {...makeProps({ gitRepositoryWarnings: [] })} />,
    );
    expect(screen.queryByText('Some folders were skipped')).toBeNull();

    // An omitted prop behaves the same as an empty list.
    rerender(<ContextPackCreationModal {...makeProps()} />);
    expect(screen.queryByText('Some folders were skipped')).toBeNull();
  });

  it('does not show skipped-folder warnings for new-project creation', () => {
    render(
      <ContextPackCreationModal
        {...makeProps({
          draft: { ...makeProps().draft, creationOrigin: 'new' },
          gitRepositoryWarnings: [],
        })}
      />,
    );
    expect(screen.queryByText('Some folders were skipped')).toBeNull();
  });

  it('renders the error callout and skipped-folder warnings together', () => {
    render(
      <ContextPackCreationModal
        {...makeProps({
          error: 'Something went wrong',
          gitRepositoryWarnings: [
            {
              repoName: 'tools',
              path: '/estate/tools',
              relativePath: 'tools',
              message:
                'repo tools does not have .git folder, if you would like it part of this context pack please initialize git in this repo.',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Some folders were skipped')).toBeInTheDocument();
  });
});
