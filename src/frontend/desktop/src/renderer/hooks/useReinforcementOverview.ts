import { useCallback, useEffect, useState } from 'react';

import type { ReinforcementOverviewData } from '../../shared/desktopContract';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';

export type UseReinforcementOverviewResult = {
  overview: ReinforcementOverviewData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

const EMPTY_OVERVIEW: ReinforcementOverviewData = {
  totalTasks: 0,
  totalReward: 0,
  unrewardedCount: 0,
  streakProgress: 0,
  streakThreshold: 10,
  lastSettlementId: null,
  agents: [],
};

export function useReinforcementOverview(
  hasActiveContextPack: boolean,
  client: DesktopShellClient = desktopShellClient,
): UseReinforcementOverviewResult {
  const [overview, setOverview] = useState<ReinforcementOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasActiveContextPack) {
      setOverview(EMPTY_OVERVIEW);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await client.readReinforcementOverview();
      if (result.ok && result.response.action === 'reinforcement.readOverview') {
        setOverview(result.response.overview);
      } else if (!result.ok) {
        setError(result.error);
        setOverview(EMPTY_OVERVIEW);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load overview.');
      setOverview(EMPTY_OVERVIEW);
    } finally {
      setLoading(false);
    }
  }, [hasActiveContextPack, client]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return { overview, loading, error, reload: load };
}
