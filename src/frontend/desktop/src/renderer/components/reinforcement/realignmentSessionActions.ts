import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { RealignmentAnalysisRunState } from '../../hooks/reinforcement/useRealignmentSessions';

export function realignmentActionLabel(status: string): string | null {
  if (status === 'open') return 'Run analysis';
  if (status === 'error') return 'Re-run analysis';
  if (status === 'reviewed') return 'Complete archive';
  return null;
}

export function realignmentRunMessage(
  session: ReinforcementRealignmentSessionEntry,
  analysisRun: RealignmentAnalysisRunState,
): string | null {
  if (analysisRun.status === 'idle' || analysisRun.realignmentId !== session.realignmentId) {
    return null;
  }
  if (analysisRun.status === 'starting') {
    return 'Starting realignment analysis...';
  }
  return analysisRun.message;
}
