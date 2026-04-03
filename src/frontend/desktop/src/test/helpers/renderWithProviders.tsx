import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { ObservabilityProvider } from '../../renderer/contexts/ObservabilityContext';
import { ToastProvider } from '../../renderer/contexts/ToastContext';
import type { DesktopShellClient } from '../../renderer/services/desktopShellClient';
import { createMockClient } from '../factories/clientFactory';

type RenderWithProvidersOptions = {
  client?: DesktopShellClient;
};

type RenderWithProvidersResult = RenderResult & {
  client: DesktopShellClient;
};

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const client = options.client ?? createMockClient();

  const result = render(
    <ToastProvider>
      <ObservabilityProvider client={client}>{ui}</ObservabilityProvider>
    </ToastProvider>,
  );

  return { ...result, client };
}
