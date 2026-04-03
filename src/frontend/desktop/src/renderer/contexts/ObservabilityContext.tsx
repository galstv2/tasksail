import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  useObservedState,
  type UseObservedStateResult,
} from '../hooks/useObservedState';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';

const ObservabilityContext = createContext<UseObservedStateResult | null>(null);

export function ObservabilityProvider({
  client = desktopShellClient,
  children,
}: {
  client?: DesktopShellClient;
  children: ReactNode;
}): JSX.Element {
  const state = useObservedState(client, client);
  const value = useMemo(
    () => state,
    [
      state.queueStatusMessage,
      state.observability,
      state.environmentStatus,
      state.contractError,
      state.setContractError,
      state.refreshObservedState,
    ],
  );
  return (
    <ObservabilityContext.Provider value={value}>
      {children}
    </ObservabilityContext.Provider>
  );
}

export function useObservabilityContext(): UseObservedStateResult {
  const context = useContext(ObservabilityContext);
  if (!context) {
    throw new Error('useObservabilityContext must be used within an ObservabilityProvider');
  }
  return context;
}
