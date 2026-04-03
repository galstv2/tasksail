/**
 * Default rule evaluator registry.
 *
 * Returns a `PolicyRuleEvaluatorRegistry` pre-populated with the live
 * production rule families, mirroring the Python `validator.evaluate()`
 * dispatch order.
 *
 * Usage:
 *   import { PolicyValidator, createDefaultRuleEvaluators } from './index.js';
 *   const validator = new PolicyValidator({
 *     rootDir,
 *     mode: 'runtime',
 *     ruleEvaluators: createDefaultRuleEvaluators(),
 *   });
 */

import { evaluateNamedAgentRules } from './agent.js';
import { evaluateBoundaryRules } from './boundary.js';
import { evaluateBootstrapRules } from './bootstrap.js';
import { evaluateCloseoutRules } from './closeout.js';
import { evaluateIntakeQualityRules } from './intake.js';
import { evaluateParallelOkContentRules } from './parallelOkContent.js';
import { evaluatePlanningAgentRules } from './planning.js';
import { evaluateQueueRules } from './queue.js';
import { evaluateQaExecutionRules } from './qaExecution.js';
import { evaluateSliceQualityRules } from './slice.js';
import { evaluateSpecQualityRules } from './spec.js';
import { evaluateRequiredTaskArtifacts } from './task.js';
import { evaluateTaskQualityRules } from './taskQuality.js';
import { evaluateTemplateStructureRules } from './template.js';
import {
  evaluateArtifactAgentIdRules,
  evaluateTransitionLegalityRules,
} from './transition.js';
import { evaluateWorkflowPathRules } from './workflow.js';
import type { PolicyRuleEvaluatorRegistry } from '../validator.js';

/**
 * Returns a registry of live workflow rule evaluators that reproduce the
 * Python `PolicyValidator.evaluate()` rule dispatch.
 *
 * The keys match `PolicyRuleName` from validator.ts exactly.
 */
export function createDefaultRuleEvaluators(): PolicyRuleEvaluatorRegistry {
  return {
    namedAgentRules: evaluateNamedAgentRules,
    boundaryRules: evaluateBoundaryRules,
    requiredTaskArtifacts: evaluateRequiredTaskArtifacts,
    artifactAgentIdRules: evaluateArtifactAgentIdRules,
    workflowPathRules: evaluateWorkflowPathRules,
    transitionLegalityRules: evaluateTransitionLegalityRules,
    closeoutRules: evaluateCloseoutRules,
    sliceQualityRules: evaluateSliceQualityRules,
    specQualityRules: evaluateSpecQualityRules,
    taskQualityRules: evaluateTaskQualityRules,
    queueRules: evaluateQueueRules,
    intakeQualityRules: evaluateIntakeQualityRules,
    planningAgentRules: evaluatePlanningAgentRules,
    qaExecutionRules: evaluateQaExecutionRules,
    templateStructureRules: evaluateTemplateStructureRules,
    parallelOkContentRules: evaluateParallelOkContentRules,
    bootstrapRules: evaluateBootstrapRules,
  };
}

// Re-export individual evaluators for direct use in targeted tests.
export {
  evaluateNamedAgentRules,
  evaluateBoundaryRules,
  evaluateBootstrapRules,
  evaluateCloseoutRules,
  evaluateIntakeQualityRules,
  evaluateParallelOkContentRules,
  evaluatePlanningAgentRules,
  evaluateQueueRules,
  evaluateQaExecutionRules,
  evaluateSliceQualityRules,
  evaluateSpecQualityRules,
  evaluateRequiredTaskArtifacts,
  evaluateTaskQualityRules,
  evaluateTemplateStructureRules,
  evaluateArtifactAgentIdRules,
  evaluateTransitionLegalityRules,
  evaluateWorkflowPathRules,
};

export { retrospectiveCompletionGaps } from './retrospectiveHelpers.js';
export type { RetrospectiveGaps } from './retrospectiveHelpers.js';

export {
  HANDOFF_TEMPLATE_SPECS,
  JSON_HANDOFF_TEMPLATE_SPECS,
  LINEAGE_HANDOFFS,
  ALLOWED_TASK_KINDS,
  HANDOFF_METADATA_LABELS,
  LINEAGE_METADATA_LABELS,
  SLICE_TEMPLATE_RELATIVE_PATH,
  SLICE_TEMPLATE_SPEC,
  TEMPLATE_SOURCE_PATHS,
  buildContributionSectionNames,
} from './templateSpecs.js';
