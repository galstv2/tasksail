import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReinforcementOverviewData } from '../../../shared/desktopContract';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import { desktopShellClient } from '../../services/desktopShellClient';

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
  activeContextPackDir: string | null,
  client: DesktopShellClient = desktopShellClient,
): UseReinforcementOverviewResult {
  const [overview, setOverview] = useState<ReinforcementOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const load = useCallback(async () => {
    if (!activeContextPackDir) {
      setOverview(EMPTY_OVERVIEW);
      setError(null);
      return;
    }
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await client.readReinforcementOverview();
      if (generation !== requestGenerationRef.current) return;
      if (result.ok && result.response.action === 'reinforcement.readOverview') {
        setOverview(result.response.overview);
      } else if (!result.ok) {
        setError(result.error);
        setOverview(EMPTY_OVERVIEW);
      }
    } catch (err: unknown) {
      if (generation !== requestGenerationRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load overview.');
      setOverview(EMPTY_OVERVIEW);
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [activeContextPackDir, client]);

  // Reset and reload on pack change
  useEffect(() => {
    setOverview(null);
    setError(null);
    requestGenerationRef.current += 1;
    load().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContextPackDir]);

  return { overview, loading, error, reload: load };
}
