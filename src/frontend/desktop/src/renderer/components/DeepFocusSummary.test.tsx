// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import type {
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { DeepFocusSummary } from './DeepFocusSummary';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const TOOLS_TOP_LEVEL = {
  id: 'tools',
  label: 'Tools',
  rootPath: '',
  repoLocalPath: '/repos/tools',
  ancillaryAllowed: false,
  systemLayer: null,
};

const PLATFORM_TOP_LEVEL = {
  id: 'platform',
  label: 'Platform',
  rootPath: '',
  repoLocalPath: '/repos/platform',
  ancillaryAllowed: false,
  systemLayer: null,
};

function renderSummary({
  committedTopLevel = TOOLS_TOP_LEVEL,
  topLevelTargets = [TOOLS_TOP_LEVEL],
  committedPrimaries,
  selectedFocusPath = null,
  selectedFocusTargetKind = null,
  selectedTestTarget,
  selectedSupportTargets = [],
  onOpenEditor = vi.fn(),
  actionRef,
}: {
  committedTopLevel?: typeof TOOLS_TOP_LEVEL | null;
  topLevelTargets?: typeof TOOLS_TOP_LEVEL[];
  committedPrimaries: ContextPackPrimaryFocusTarget[];
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: ContextPackFocusTargetKind | null;
  selectedTestTarget?: ContextPackDeepFocusTarget | null;
  selectedSupportTargets?: ContextPackDeepFocusTarget[];
  onOpenEditor?: ReturnType<typeof vi.fn>;
  actionRef?: ReturnType<typeof createRef<HTMLButtonElement>>;
}): { onOpenEditor: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const result = render(
    <DeepFocusSummary
      committedTopLevel={committedTopLevel}
      topLevelTargets={topLevelTargets}
      committedPrimaries={committedPrimaries}
      selectedFocusPath={selectedFocusPath}
      selectedFocusTargetKind={selectedFocusTargetKind}
      selectedTestTarget={selectedTestTarget}
      selectedSupportTargets={selectedSupportTargets}
      onOpenEditor={onOpenEditor}
      actionRef={actionRef}
    />,
  );
  return { onOpenEditor, container: result.container };
}

describe('DeepFocusSummary', () => {
  it('renders the empty card when there are no primaries', () => {
    const { onOpenEditor } = renderSummary({ committedPrimaries: [] });

    expect(screen.getByText('No primary targets')).toBeInTheDocument();
    expect(screen.getByText("Choose what's in scope for this task.")).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit Scope' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    expect(onOpenEditor).toHaveBeenCalledWith();
  });

  it('renders header + one primary row with no globals or override hint for a single bare primary', () => {
    const { container } = renderSummary({
      committedTopLevel: PLATFORM_TOP_LEVEL,
      topLevelTargets: [PLATFORM_TOP_LEVEL, TOOLS_TOP_LEVEL],
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
    });

    expect(screen.getByText('1 primary target')).toBeInTheDocument();
    expect(container.querySelectorAll('.deep-focus-summary__primary-row')).toHaveLength(1);
    expect(container.querySelector('.deep-focus-summary__globals')).toBeNull();
    expect(container.querySelector('.deep-focus-summary__override-hint')).toBeNull();
    expect(container.querySelector('.deep-focus-summary__primary-row-static')).not.toBeNull();
    expect(container.querySelector('.deep-focus-summary__chevron')).toBeNull();
  });

  it('uses repo prefix spans when primaries span multiple repos', () => {
    const { container } = renderSummary({
      committedTopLevel: PLATFORM_TOP_LEVEL,
      topLevelTargets: [PLATFORM_TOP_LEVEL, TOOLS_TOP_LEVEL],
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
        {
          path: 'src',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
    });

    expect(screen.getByText('2 primary targets across 2 repos')).toBeInTheDocument();
    const prefixes = container.querySelectorAll('.deep-focus-summary__primary-label-prefix');
    expect(prefixes).toHaveLength(2);
    const prefixTexts = Array.from(prefixes).map((node) => node.textContent);
    expect(prefixTexts).toEqual(expect.arrayContaining(['tools', 'platform']));
  });

  it('keeps single-repo summary labels unprefixed', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/frontend',
          repoId: 'frontend',
        },
        {
          path: 'lib',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/frontend',
          repoId: 'frontend',
        },
      ],
    });

    expect(screen.getByText('2 primary targets')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('lib')).toBeInTheDocument();
    expect(container.querySelector('.deep-focus-summary__primary-label-prefix')).toBeNull();
  });

  it('toggles the inline overrides accordion when a primary has a scoped testTarget', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          testTarget: { path: 'tests/unit', kind: 'directory' },
        },
      ],
    });

    const rowButton = container.querySelector(
      '.deep-focus-summary__primary-row-button',
    ) as HTMLButtonElement | null;
    expect(rowButton).not.toBeNull();
    expect(rowButton?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.deep-focus-summary__overrides')).toBeNull();

    fireEvent.click(rowButton as HTMLButtonElement);

    expect(rowButton?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Test')).toBeInTheDocument();
    const overrides = container.querySelector('.deep-focus-summary__overrides');
    expect(overrides).not.toBeNull();
    expect(overrides?.querySelector('.deep-focus-summary__path-parent')?.textContent).toBe('tests/');
    expect(overrides?.querySelector('.deep-focus-summary__path-basename')?.textContent).toBe('unit');
  });

  it('does not throw when Enter is pressed on a non-expandable row and no row button is rendered', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
    });

    const staticRow = container.querySelector('.deep-focus-summary__primary-row-static');
    expect(staticRow).not.toBeNull();
    expect(container.querySelector('.deep-focus-summary__primary-row-button')).toBeNull();
    expect(container.querySelector('.deep-focus-summary__chevron')).toBeNull();
    expect(() => {
      fireEvent.keyDown(staticRow as Element, { key: 'Enter' });
    }).not.toThrow();
    expect(container.querySelector('.deep-focus-summary__overrides')).toBeNull();
  });

  it('renders a globals block with only a Test row when only globalTest is set', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
      selectedTestTarget: { path: 'tests', kind: 'directory' },
    });

    const globals = container.querySelector('.deep-focus-summary__globals');
    expect(globals).not.toBeNull();
    expect(globals?.querySelectorAll('.deep-focus-summary__globals-row')).toHaveLength(1);
    expect(globals?.querySelector('.deep-focus-summary__globals-label')?.textContent).toBe('Test');
  });

  it('summarizes 3 global supports as "3 folders" with a preview of two basenames + "+1"', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
      selectedSupportTargets: [
        { path: 'docs', kind: 'directory' },
        { path: 'design', kind: 'directory' },
        { path: 'README.md', kind: 'file' },
      ],
    });

    expect(screen.getByText('3 folders')).toBeInTheDocument();
    const preview = container.querySelector('.deep-focus-summary__globals-preview');
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toBe('docs · design +1');
  });

  it('renders each support path in exactly one section (per-primary OR globals — never both)', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          supportTargets: [{ path: 'lib/scoped.ts', kind: 'file' }],
        },
      ],
      selectedSupportTargets: [{ path: 'lib/global.ts', kind: 'file' }],
    });

    const expandButton = container.querySelector(
      '.deep-focus-summary__primary-row-button',
    ) as HTMLButtonElement;
    fireEvent.click(expandButton);

    const overrides = container.querySelector('.deep-focus-summary__overrides');
    const globals = container.querySelector('.deep-focus-summary__globals');

    expect(overrides?.textContent).toContain('scoped.ts');
    expect(overrides?.textContent).not.toContain('global.ts');
    expect(globals?.textContent).toContain('global.ts');
    expect(globals?.textContent).not.toContain('scoped.ts');
  });

  it('labels whole-repo per-primary support by repo name instead of slash', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
          supportTargets: [{
            path: '',
            kind: 'directory',
            repoLocalPath: '/repos/tools',
            repoId: 'tools',
          }],
        },
      ],
    });

    const expandButton = container.querySelector(
      '.deep-focus-summary__primary-row-button',
    ) as HTMLButtonElement;
    fireEvent.click(expandButton);

    const overrides = container.querySelector('.deep-focus-summary__overrides');
    expect(overrides?.textContent).toContain('Tools');
    expect(overrides?.textContent).not.toContain('/');
  });

  it('hides the globals section when there are no global supports or test target', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          supportTargets: [{ path: 'lib/scoped.ts', kind: 'file' }],
        },
      ],
    });

    expect(container.querySelector('.deep-focus-summary__globals')).toBeNull();
    expect(screen.queryByText('Support for all primaries')).not.toBeInTheDocument();
  });

  it('labels the globals section as "Support for all primaries" when global supports exist', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
      selectedSupportTargets: [{ path: 'docs', kind: 'directory' }],
    });

    const globals = container.querySelector('.deep-focus-summary__globals');
    expect(globals).not.toBeNull();
    expect(globals?.getAttribute('aria-label')).toBe('Support for all primaries');
    expect(
      globals?.querySelector('.deep-focus-summary__globals-eyebrow')?.textContent,
    ).toBe('Support for all primaries');
    expect(globals?.querySelector('.deep-focus-summary__globals-label')).toBeNull();
  });

  it('labels whole-repo global support by repo name instead of slash', () => {
    const { container } = renderSummary({
      committedPrimaries: [
        {
          path: '',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
      selectedSupportTargets: [{
        path: '',
        kind: 'directory',
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
      }],
    });

    const globals = container.querySelector('.deep-focus-summary__globals');
    expect(globals?.textContent).toContain('Tools');
    expect(globals?.textContent).not.toContain('/');
  });

  it('summarizes legacy scalar primary scope as one primary target', () => {
    renderSummary({
      committedPrimaries: [],
      selectedFocusPath: 'src',
      selectedFocusTargetKind: 'directory',
    });

    expect(screen.getByText('1 primary target')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.queryByText('No primary targets')).not.toBeInTheDocument();
  });

  it('exposes a single Edit Scope action wired through onOpenEditor and actionRef', () => {
    const actionRef = createRef<HTMLButtonElement>();
    const { onOpenEditor } = renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
      ],
      actionRef,
    });

    const editButtons = screen.getAllByRole('button', { name: 'Edit Scope' });
    expect(editButtons).toHaveLength(1);
    expect(actionRef.current).toBe(editButtons[0]);

    fireEvent.click(editButtons[0]);
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    expect(onOpenEditor).toHaveBeenCalledWith();
  });

  it('does not expose per-target edit links in read-only mode', () => {
    renderSummary({
      committedPrimaries: [
        {
          path: 'src',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        },
        {
          path: 'src',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        },
      ],
    });

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit Scope' })).toHaveLength(1);
  });
});
