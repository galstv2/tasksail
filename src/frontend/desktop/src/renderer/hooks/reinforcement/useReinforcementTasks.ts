import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReinforcementTaskEntry } from '../../../shared/desktopContract';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import { desktopShellClient } from '../../services/desktopShellClient';

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
  activeContextPackDir: string | null,
  client: DesktopShellClient = desktopShellClient,
): UseReinforcementTasksResult {
  const [tasks, setTasks] = useState<ReinforcementTaskEntry[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const load = useCallback(
    async (year?: string) => {
      if (!activeContextPackDir) {
        setTasks([]);
        setAvailableYears([]);
        setError(null);
        return;
      }
      const generation = ++requestGenerationRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await client.listReinforcementTasks(year);
        if (generation !== requestGenerationRef.current) return;
        if (result.ok && result.response.action === 'reinforcement.listTasks') {
          setTasks(result.response.tasks);
          setAvailableYears(result.response.availableYears);
        } else if (!result.ok) {
          setError(result.error);
        }
      } catch (err: unknown) {
        if (generation !== requestGenerationRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load tasks.');
      } finally {
        if (generation === requestGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [activeContextPackDir, client],
  );

  // Reset on pack change
  useEffect(() => {
    setTasks([]);
    setAvailableYears([]);
    setSelectedYear(null);
    setError(null);
    requestGenerationRef.current += 1;
    load(undefined).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContextPackDir]);

  const onSelectYear = useCallback((year: string | null) => {
    setSelectedYear(year);
    load(year ?? undefined).catch(() => {});
  }, [load]);

  const reload = useCallback(() => {
    load(selectedYear ?? undefined).catch(() => {});
  }, [load, selectedYear]);

  return { tasks, availableYears, selectedYear, loading, error, onSelectYear, reload };
}
