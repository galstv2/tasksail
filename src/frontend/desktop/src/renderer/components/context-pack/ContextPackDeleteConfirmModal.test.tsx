// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
import ContextPackDeleteConfirmModal from './ContextPackDeleteConfirmModal';

expect.extend(matchers);

afterEach(() => cleanup());

const pack: ContextPackCatalogEntry = {
  contextPackId: 'pack',
  displayName: 'Platform Pack',
  contextPackDir: '/repo/contextpacks/platform',
  manifestPath: null,
  bootstrapReady: true,
  source: 'configured-path',
  isActive: false,
  estateType: 'distributed-platform',
  defaultScopeMode: 'focused',
  repoCount: 1,
  primaryWorkingRepoIds: [],
  focusTargets: [],
};

describe('ContextPackDeleteConfirmModal', () => {
  it('renders destructive copy and confirms delete', () => {
    const onConfirm = vi.fn();
    render(
      <ContextPackDeleteConfirmModal
        isOpen
        selectedPack={pack}
        repoRoot="/repo"
        pending={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Delete context pack' })).toBeInTheDocument();
    expect(screen.getByText('Are you sure? This is a destructive action.')).toBeInTheDocument();
    expect(screen.getByText('/repo/contextpacks/platform')).toBeInTheDocument();
    expect(screen.getByText('/repo/AgentWorkSpace/qmd/context-packs/platform')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancel closes without confirming', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ContextPackDeleteConfirmModal
        isOpen
        selectedPack={pack}
        pending={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
