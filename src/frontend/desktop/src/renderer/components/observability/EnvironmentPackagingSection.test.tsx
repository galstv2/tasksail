import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EnvironmentStatusResponse } from '../../../shared/desktopContract';
import EnvironmentPackagingSection from './EnvironmentPackagingSection';

afterEach(() => {
  cleanup();
});

function makeEnvStatus(
  overrides: Partial<EnvironmentStatusResponse> = {},
): EnvironmentStatusResponse {
  return {
    action: 'environment.readStatus',
    mode: 'read-only',
    message: '',
    platform: 'linux',
    repoRoot: '/project',
    packageOutputDir: '/out',
    packageArtifactName: 'TaskSail.AppImage',
    packageCommand: 'npm run package:linux',
    hostMode: 'repo-root-native',
    validationSummary: 'All checks passed',
    launchPolicy: 'standard',
    helperStatuses: [],
    contextPackCommand: '',
    contextPackWritePlanHint: '',
    bootstrapFlowHint: '',
    ...overrides,
  };
}

describe('EnvironmentPackagingSection', () => {
  it('shows loading state when environmentStatus is null', () => {
    render(<EnvironmentPackagingSection environmentStatus={null} />);
    expect(screen.getByText('Checking your setup — this will only take a moment.')).toBeInTheDocument();
  });

  it('renders section title', () => {
    render(<EnvironmentPackagingSection environmentStatus={makeEnvStatus()} />);
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });

  it('renders validation summary', () => {
    render(<EnvironmentPackagingSection environmentStatus={makeEnvStatus()} />);
    expect(screen.getByText('All checks passed')).toBeInTheDocument();
  });

  it('renders KV pairs for mode, root, build command, policy', () => {
    render(<EnvironmentPackagingSection environmentStatus={makeEnvStatus()} />);
    expect(screen.getByText('repo-root-native')).toBeInTheDocument();
    expect(screen.getByText('/project')).toBeInTheDocument();
    expect(screen.getByText('npm run package:linux')).toBeInTheDocument();
    expect(screen.getByText('standard')).toBeInTheDocument();
  });

  it('renders helper statuses when present', () => {
    const env = makeEnvStatus({
      helperStatuses: [
        { label: 'Docker', path: '/usr/bin/docker', available: true, detail: 'v24' },
        { label: 'Node', path: '/usr/bin/node', available: false, detail: 'not found' },
      ],
    });
    render(<EnvironmentPackagingSection environmentStatus={env} />);
    expect(screen.getByText('Required tools')).toBeInTheDocument();
    expect(screen.getByText('Docker')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Node')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('hides helper section when no helpers', () => {
    render(<EnvironmentPackagingSection environmentStatus={makeEnvStatus()} />);
    expect(screen.queryByText('Required tools')).toBeNull();
  });
});
