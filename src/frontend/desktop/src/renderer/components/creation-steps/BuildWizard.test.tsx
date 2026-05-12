import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import type { BuildWizardStep, ContextPackCreationDraft, PartDraft } from '../../contextPackCreationTypes';
import { INITIAL_DRAFT } from '../../hooks/useContextPackDraft';
import BuildWizard from './BuildWizard';

afterEach(() => {
  cleanup();
});

const defaultDraft: ContextPackCreationDraft = {
  ...INITIAL_DRAFT,
  creationOrigin: 'new',
  discoveryRoot: '/workspace/orders-platform',
  estateName: 'Orders Platform',
  contextPackId: 'orders-platform-1234',
  contextPackDir: '/packs/orders-platform-1234',
};

function makePart(overrides: Partial<PartDraft> = {}): PartDraft {
  return {
    key: 'part-1',
    name: 'Orders Platform',
    role: '',
    language: '',
    languageIsOther: false,
    location: '/workspace/orders-platform',
    primary: true,
    editing: true,
    ...overrides,
  };
}

function makeProps(overrides: Partial<ComponentProps<typeof BuildWizard>> = {}) {
  return {
    wizardStep: 'project-type' as BuildWizardStep,
    draft: defaultDraft,
    parts: [] as PartDraft[],
    busy: false,
    onStepChange: vi.fn(),
    onDraftFieldChange: vi.fn(),
    onChangeMode: vi.fn(),
    onBrowseDiscoveryRoot: vi.fn(),
    onAddPart: vi.fn(),
    onUpdatePart: vi.fn(),
    onRemovePart: vi.fn(),
    ...overrides,
  };
}

describe('BuildWizard', () => {
  it('renders the vertical progress rail and active sub-step content', () => {
    render(<BuildWizard {...makeProps()} />);

    expect(screen.getByLabelText('Build wizard progress')).toBeInTheDocument();
    expect(screen.getByText('Project type')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('How is this project organized?')).toBeInTheDocument();
  });

  it('renders Application shape and Infrastructure repos fieldsets', () => {
    render(<BuildWizard {...makeProps()} />);
    expect(screen.getByRole('group', { name: 'Application shape' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Infrastructure repos' })).toBeInTheDocument();
  });

  it('renders native radio inputs for Monolith, Distributed, No, and Yes', () => {
    render(<BuildWizard {...makeProps()} />);
    expect(screen.getByRole('radio', { name: 'Monolith' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Distributed' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'No' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeInTheDocument();
  });

  it('defaults infrastructure repos to No', () => {
    render(<BuildWizard {...makeProps()} />);

    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
  });

  it('emits the correct internal mode when infrastructure estate variants are selected', () => {
    const onChangeMode = vi.fn();
    const { rerender } = render(<BuildWizard {...makeProps({ onChangeMode })} />);

    // Default draft mode is 'distributed' (Distributed + No infra).
    // Selecting Monolith emits 'monolith'.
    fireEvent.click(screen.getByRole('radio', { name: 'Monolith' }));
    expect(onChangeMode).toHaveBeenCalledWith('monolith');

    // Rerender with mode 'monolith', then select Yes → 'monolith-platform'.
    rerender(
      <BuildWizard
        {...makeProps({ onChangeMode, draft: { ...defaultDraft, mode: 'monolith' } })}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(onChangeMode).toHaveBeenCalledWith('monolith-platform');

    // Rerender with mode 'monolith-platform', then select Distributed → 'distributed-platform'.
    rerender(
      <BuildWizard
        {...makeProps({ onChangeMode, draft: { ...defaultDraft, mode: 'monolith-platform' } })}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Distributed' }));
    expect(onChangeMode).toHaveBeenCalledWith('distributed-platform');

    // Rerender with mode 'distributed-platform', then select No → 'distributed'.
    rerender(
      <BuildWizard
        {...makeProps({ onChangeMode, draft: { ...defaultDraft, mode: 'distributed-platform' } })}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(onChangeMode).toHaveBeenCalledWith('distributed');
  });

  it('selecting a radio choice does not advance to the location step', () => {
    const onStepChange = vi.fn();
    render(<BuildWizard {...makeProps({ onStepChange })} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Monolith' }));
    expect(onStepChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('Continue button advances to the location step', () => {
    const onStepChange = vi.fn();
    render(<BuildWizard {...makeProps({ onStepChange })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onStepChange).toHaveBeenCalledWith('location');
  });

  it('renders part builders for the build step', () => {
    render(
      <BuildWizard
        {...makeProps({
          wizardStep: 'build-parts',
          parts: [makePart()],
        })}
      />,
    );

    expect(screen.getByText('Build your project')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add (folder|repository)/i })).toBeInTheDocument();
  });

  it('auto-completes documentation parts with markdown', () => {
    const onUpdatePart = vi.fn();
    render(
      <BuildWizard
        {...makeProps({
          wizardStep: 'build-parts',
          parts: [makePart()],
          onUpdatePart,
        })}
      />,
    );

    const roleSelect = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(roleSelect, { target: { value: 'documents' } });

    expect(onUpdatePart).toHaveBeenCalledWith('part-1', 'role', 'documents');
    expect(onUpdatePart).toHaveBeenCalledWith('part-1', 'language', 'markdown');
    expect(onUpdatePart).toHaveBeenCalledWith('part-1', 'editing', false);
  });

  it('shows custom language input when Other is selected', () => {
    const onUpdatePart = vi.fn();
    const { rerender } = render(
      <BuildWizard
        {...makeProps({
          wizardStep: 'build-parts',
          parts: [
            makePart({
              role: 'backend',
            }),
          ],
          onUpdatePart,
        })}
      />,
    );

    const languageSelect = screen.getAllByRole('combobox')[1]!;
    fireEvent.change(languageSelect, { target: { value: '__other__' } });
    expect(onUpdatePart).toHaveBeenCalledWith('part-1', 'languageIsOther', true);

    rerender(
      <BuildWizard
        {...makeProps({
          wizardStep: 'build-parts',
          parts: [
            makePart({
              role: 'backend',
              languageIsOther: true,
            }),
          ],
          onUpdatePart,
        })}
      />,
    );

    expect(screen.getByPlaceholderText('e.g. swift')).toBeInTheDocument();
  });
});
