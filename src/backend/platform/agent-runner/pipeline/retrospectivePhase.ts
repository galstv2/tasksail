export interface CycleTaskContext {
  taskId: string;
  taskTitle: string;
  taskSummary: string;
  completedWorkSummary: string;
  keyDecisions: string[];
  knownLimitations: string[];
  difficultyLevel: string;
  retrospectiveSummary: string;
  whatWentWell: string[];
  whatCouldHaveGoneBetter: string[];
  actionItems: string[];
  isCurrentTask: boolean;
  warnings: string[];
}

export {
  buildCycleContextBundle,
  shouldRunRetrospectivePhase,
} from './retrospectivePhase/bundle.js';
export { buildRetrospectivePrompt } from './retrospectivePhase/prompt.js';
