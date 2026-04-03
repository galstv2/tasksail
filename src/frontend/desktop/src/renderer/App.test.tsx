import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';
import { installAppTestHarness } from './App.test-setup';

installAppTestHarness();

describe("App", () => {
  it('renders the persistent left sidebar with context-pack list and active state', async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Context pack sidebar' }),
      ).toBeInTheDocument();
    });

    const packTrigger = screen.getByLabelText('Select context pack');
    expect(packTrigger).toBeInTheDocument();
    expect(packTrigger).toHaveTextContent('Orders Estate');
    expect(screen.getByTestId('context-pack-active-state')).toHaveTextContent(
      'Orders Estate is active',
    );
    expect(
      screen.getByRole('checkbox', { name: /Orders API/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Orders Web/i }),
    ).not.toBeChecked();
  });

  it('renders compact header title without old eyebrow or badge', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('TaskSail')).toBeInTheDocument();
    });

    expect(screen.queryByText('Capstone safe operator controls')).not.toBeInTheDocument();
    expect(screen.queryByText('TaskSail')).not.toBeInTheDocument();
    expect(screen.queryByText('Automated context-pack workspace control')).not.toBeInTheDocument();
  });

  it('renders sidebar and main agent workspace regions', async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Context pack sidebar' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('region', { name: 'Agent workspace' }),
    ).toBeInTheDocument();
  });

  it('renders the FAB planner button', async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Plan with Lily' }),
      ).toBeInTheDocument();
    });
  });

  it('renders status chips from observability data', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Observe queue artifacts')).toBeInTheDocument();
    });
  });

  it('renders the terminal feed in the main workspace', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Terminal feed')).toBeInTheDocument();
    });
  });

  it('renders the planner modal when FAB is clicked', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Plan with Lily' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('dialog', { name: 'Planning agent' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plan with Lily' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Planning agent' })).toBeInTheDocument();
    });
  });

  it('auto-collapses the context pack sidebar when the window becomes narrow', async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Context pack sidebar' }),
      ).toBeInTheDocument();
    });

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1000,
    });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => {
      expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Select context pack')).not.toBeInTheDocument();
  });
});
