import { useCallback, useEffect, useState } from 'react';

import type { ReinforcementTaskEntry } from '../../shared/desktopContract';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';

export type UseReinforcementTasksResult = {
  tasks: ReinforcementTaskEntry[];
  availableYears: string[];
  selectedYear: string | null;
  loading: boolean;
  error: string | null;
  onSelectYear: (year: string | null) => void;
  reload: () => void;
};

export function useReinforcementTasks(
  hasActiveContextPack: boolean,
  client: DesktopShellClient = desktopShellClient,
): UseReinforcementTasksResult {
  const [tasks, setTasks] = useState<ReinforcementTaskEntry[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (year?: string) => {
      if (!hasActiveContextPack) {
        setTasks([]);
        setAvailableYears([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await client.listReinforcementTasks(year);
        if (result.ok && result.response.action === 'reinforcement.listTasks') {
          setTasks(result.response.tasks);
          setAvailableYears(result.response.availableYears);
        } else if (!result.ok) {
          setError(result.error);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks.');
      } finally {
        setLoading(false);
      }
    },
    [hasActiveContextPack, client],
  );

  useEffect(() => {
    load(selectedYear ?? undefined).catch(() => {});
  }, [load, selectedYear]);

  const onSelectYear = useCallback((year: string | null) => {
    setSelectedYear(year);
  }, []);

  const reload = useCallback(() => {
    load(selectedYear ?? undefined).catch(() => {});
  }, [load, selectedYear]);

  return { tasks, availableYears, selectedYear, loading, error, onSelectYear, reload };
}
