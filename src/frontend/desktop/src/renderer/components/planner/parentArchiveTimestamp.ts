import { formatLocalTimestamp } from '../../utils/localTimestamp';

export function formatParentArchiveTimestamp(iso: string): string | null {
  return formatLocalTimestamp(iso);
}

export const formatPlannerDropdownTimestamp = formatLocalTimestamp;
