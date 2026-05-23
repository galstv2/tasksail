// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DeepFocusSelectionBuilder } from './DeepFocusSelectionBuilder';
import type { DeepFocusSelectionBuilderViewModel } from './sidebarDeepFocusSelectors';

expect.extend(matchers);

afterEach(cleanup);

function model(overrides: Partial<DeepFocusSelectionBuilderViewModel> = {}): DeepFocusSelectionBuilderViewModel {
  return {
    empty: false,
    primaryItems: [
      { key: 'p1', label: 'app', title: 'src/app' },
      { key: 'p2', label: 'api', title: 'src/api' },
    ],
    supportItems: [
      { key: 's1', label: 'docs', title: 'docs', kind: 'directory', scopeLabel: 'All primaries', scopeKind: 'global', primaryKey: null },
      { key: 's2', label: 'fixtures', title: 'src/app/fixtures', kind: 'directory', scopeLabel: 'app', scopeKind: 'primary', primaryKey: 'p1' },
    ],
    testItems: [
      { key: 't1', label: 'tests', title: 'tests', kind: 'directory', scopeLabel: 'All primaries', scopeKind: 'global', primaryKey: null },
      { key: 't2', label: 'app.test.ts', title: 'src/app/app.test.ts', kind: 'file', scopeLabel: 'app', scopeKind: 'primary', primaryKey: 'p1' },
    ],
    counts: { primary: 2, support: 2, test: 2 },
    ...overrides,
  };
}

describe('DeepFocusSelectionBuilder', () => {
  it('renders the accessible empty state without tutorial copy', () => {
    render(<DeepFocusSelectionBuilder model={model({
      empty: true,
      primaryItems: [],
      supportItems: [],
      testItems: [],
      counts: { primary: 0, support: 0, test: 0 },
    })} />);

    expect(screen.getByLabelText('Deep Focus Selection Builder')).toBeInTheDocument();
    expect(screen.getByText('Selection Builder')).toBeInTheDocument();
    expect(screen.getByText('No selections')).toBeInTheDocument();
    expect(screen.queryByText('Primary')).not.toBeInTheDocument();
  });

  it('renders sections, counts, scope chips, and title attributes', () => {
    render(<DeepFocusSelectionBuilder model={model()} />);

    expect(screen.getByLabelText('Primary selections')).toBeInTheDocument();
    expect(screen.getByLabelText('Support selections')).toBeInTheDocument();
    expect(screen.getByLabelText('Test selections')).toBeInTheDocument();
    expect(screen.queryByText('Main')).not.toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getAllByText('All primaries')).toHaveLength(2);
    expect(screen.getAllByText('app')).toHaveLength(3);
    expect(screen.getByText('fixtures')).toHaveAttribute('title', 'src/app/fixtures');
  });

  it('omits empty sections and renders every selected row for internal scrolling', () => {
    render(<DeepFocusSelectionBuilder model={model({
      supportItems: [],
      counts: { primary: 4, support: 0, test: 2 },
      primaryItems: [
        { key: 'p1', label: 'one', title: 'one' },
        { key: 'p2', label: 'two', title: 'two' },
        { key: 'p3', label: 'three', title: 'three' },
        { key: 'p4', label: 'four', title: 'four' },
      ],
    })} />);

    expect(screen.queryByText('Support')).not.toBeInTheDocument();
    const primarySection = screen.getByLabelText('Primary selections');
    expect(within(primarySection).getByText('four')).toBeInTheDocument();
    expect(within(primarySection).queryByText(/more/)).not.toBeInTheDocument();
  });
});
