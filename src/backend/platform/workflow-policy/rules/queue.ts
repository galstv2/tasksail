/**
 * Queue advancement rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_queue.py
 */

import {
  RETROSPECTIVE_INPUT_RELATIVE_PATH,
} from '../models.js';
import { activeItemExists, hasPendingMarkdownFiles } from '../artifacts.js';
import type { PolicyValidator } from '../validator.js';

export async function evaluateQueueRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('queue.closeout-required');
  validator.recordRule('queue.retrospective-required');
  validator.recordRule('queue.workspace-reset-required');

  if (validator.mode !== 'queue-advance') {
    return;
  }

  if (await activeItemExists(validator.rootDir)) {
    if (validator.finalSummaryIsComplete()) {
      const retrospectiveGaps = validator.retrospectiveCompletionGaps();
      if (!Object.values(retrospectiveGaps).some((list) => list.length > 0)) {
        return;
      }
      const details: string[] = [];
      if (retrospectiveGaps.required_sections.length > 0) {
        details.push(`missing or blank sections: ${retrospectiveGaps.required_sections.join(', ')}`);
      }
      if (retrospectiveGaps.action_items.length > 0) {
        details.push(...retrospectiveGaps.action_items);
      }
      if (retrospectiveGaps.missing_contributions.length > 0) {
        details.push(`missing contributions: ${retrospectiveGaps.missing_contributions.join(', ')}`);
      }
      if (retrospectiveGaps.oversized_contributions.length > 0) {
        details.push(`oversized contributions: ${retrospectiveGaps.oversized_contributions.join(', ')}`);
      }
      const detailSuffix = details.length > 0 ? `; ${details.join('; ')}` : '';
      validator.addViolation({
        rule_id: 'queue.retrospective-required',
        artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
        message: `Cannot advance the queue because the active task has not completed the required retrospective in retrospective-input.md${detailSuffix}.`,
        remediation:
          'Complete the required retrospective sections in retrospective-input.md before removing the active pending item.',
      });
      return;
    }

    validator.addViolation({
      rule_id: 'queue.closeout-required',
      artifact: 'pendingitems/.active-item',
      message:
        'Cannot advance the queue because the active pending item has not completed task closeout in final-summary.md.',
      remediation:
        'Finish final-summary.md and rerun the queue completion step before removing the active pending item.',
    });
    return;
  }

  if (!(await hasPendingMarkdownFiles(validator.rootDir))) {
    return;
  }

  if (validator.workspaceIsReset()) {
    return;
  }

  validator.addViolation({
    rule_id: 'queue.workspace-reset-required',
    artifact: 'handoffs/',
    message:
      'Cannot activate the next pending item because the handoffs workspace is not reset after the prior task.',
    remediation:
      'Run the documented reset flow so the handoffs workspace returns to its blank template state before the queue activates the next pending item.',
  });
}
