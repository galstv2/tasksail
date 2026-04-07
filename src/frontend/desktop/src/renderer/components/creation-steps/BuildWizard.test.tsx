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
    expect(screen.getByText('What kind of project are you building?')).toBeInTheDocument();
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
    expect(screen.getByText('What does this part do?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add another part/i })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Documentation' }));

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

    const otherBtn = screen.getAllByRole('button').find((btn) => btn.textContent?.includes('Other'));
    expect(otherBtn).toBeTruthy();
    fireEvent.click(otherBtn!);
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

    expect(screen.getByPlaceholderText('swift')).toBeInTheDocument();
  });
});
