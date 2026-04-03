/**
 * Default rule evaluator registry wiring all ported policy rules.
 *
 * The PolicyValidator uses dependency injection for rule evaluators.
 * This module exposes the production defaults from the shared registry
 * builder so the runtime and test helper stay in one coherent state.
 */

import { createDefaultRuleEvaluators } from './rules/index.js';
import type { PolicyRuleEvaluatorRegistry } from './validator.js';

/**
 * Production default evaluators mapping each sequence name to its rule function.
 * Covers the full and lightweight validator sequences.
 */
export const DEFAULT_RULE_EVALUATORS: PolicyRuleEvaluatorRegistry = createDefaultRuleEvaluators();
