// @vitest-environment jsdom

import {
  act,
  createClient,
  ContextPackSelectionHarness,
  describe,
  expect,
  fireEvent,
  it,
  render,
  screen,
  waitFor,
} from './useContextPackSelection.testSetup';

describe('useContextPackSelection', () => {
  it('loads catalog state and prefers the active context pack', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });
    expect(screen.getByTestId('active-pack')).toHaveTextContent(
      '/tmp/context-packs/orders-estate',
    );
    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent(
      'orders-api',
    );
    expect(screen.getByTestId('message')).toHaveTextContent(
      'Discovered 2 context pack(s) from approved local sources.',
    );
  });

  it('renders preview success state and warnings', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('result-stage')).toHaveTextContent('complete');
    });
    expect(screen.getByTestId('warning-count')).toHaveTextContent('1');
    expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      [],
      {},
    );
  });

  it('runs reseed through the bounded client seam and stores the latest reseed result', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run reseed' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('reseed-status')).toHaveTextContent('seeded');
    });
    expect(screen.getByTestId('reseed-report-path')).toHaveTextContent(
      '/tmp/context-packs/orders-estate/qmd/context-pack-seed-report.json',
    );
    expect(screen.getByTestId('message')).toHaveTextContent(
      'Context-pack reseed completed through the approved repo-context seed seam. Conventions memo generation remains only-if-missing.',
    );
    expect(client.reseedContextPack).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
    );
  });

  it('surfaces apply failures without hiding structured result state', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run apply' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('result-stage')).toHaveTextContent('activation');
    });
    expect(screen.getByTestId('result-status')).toHaveTextContent('error');
  });

  it('supports scope and selection changes before previewing', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select billing' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/billing-estate',
      );
    });
    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent(
      'billing-api',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
        '/tmp/context-packs/billing-estate',
        'focused',
        ['billing-api'],
        [],
        {},
      );
    });
  });

  it('commits and clears deep focus selections locally', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit deep focus' }));
    });

    expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('selected-focus-path')).toHaveTextContent('src/features/orders');
    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('tests/orders:directory');
    expect(screen.getByTestId('selected-support-targets')).toHaveTextContent('docs/orders.md:file');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear deep focus' }));
    });

    expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('false');
    expect(screen.getByTestId('selected-focus-path')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('unset');
    expect(screen.getByTestId('selected-support-targets')).toHaveTextContent('none');
  });

  it('persists explicit no-tests separately from an unset test target', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('unset');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit deep focus no tests' }));
    });

    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('none');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenLastCalledWith(
        '/tmp/context-packs/orders-estate',
        'focused',
        ['orders-api'],
        [],
        {
          deepFocusEnabled: true,
          selectedFocusPath: 'src/features/orders',
          selectedFocusTargetKind: 'directory',
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      );
    });
  });
});
