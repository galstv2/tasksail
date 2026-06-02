import path from 'node:path';

import { getActiveProvider } from '../../cli-provider/index.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';
import { readTextFile } from '../../core/index.js';
import { appendMcpContextBlock } from '../pipeline/mcpPromptContext.js';
import { getCachedExternalMcpAssignments } from '../pipeline/externalMcpRegistryCache.js';
import type { RealignmentBundle, RetrospectiveDigestEntry, TaskBundleEntry } from './bundle.js';

export async function buildRealignmentPrompt(options: {
  repoRoot: string;
  bundle: RealignmentBundle;
  externalMcpRegistry?: ExternalMcpRegistry;
}): Promise<string> {
  const promptRelativePath = getActiveProvider(options.repoRoot).resolvePromptPath('realignment-task');
  const promptPath = path.join(options.repoRoot, promptRelativePath);
  const anchor = (await readTextFile(promptPath))?.trim();
  if (!anchor) {
    throw new Error(`Realignment prompt anchor missing or empty: ${promptPath}`);
  }

  const parts = [anchor, renderRealignmentContext(options.bundle)];
  // The realignment chain (supervisor → reinforcementWrite → driver) threads only
  // the registry; pair it here with the cached assignment snapshot so this 'ron'
  // prompt uses the same assignment-based selection as the rest of the pipeline.
  appendMcpContextBlock(
    parts,
    {
      registry: options.externalMcpRegistry,
      assignments: getCachedExternalMcpAssignments(options.repoRoot),
      runtimeToProviderAgentId: (agentId) => getActiveProvider(options.repoRoot).runtimeToProviderAgentId(agentId),
    },
    'ron',
  );
  return parts.filter((part) => part.trim()).join('\n\n---\n\n');
}

function renderRealignmentContext(bundle: RealignmentBundle): string {
  const lines = ['## Realignment Context', ''];
  renderTriggerFeedback(lines, bundle);
  renderTriggerTask(lines, bundle.triggerTask);
  renderFeedbackList(lines, 'Recent Negative Feedback', bundle.recentNegativeFeedback);
  renderTaskList(lines, 'Recent Tasks', bundle.recentTasks);
  renderGrd(lines, bundle);
  renderRetrospectiveDigest(lines, bundle.rollingRetrospectives);
  lines.push('### Recent Shared Retrospective Memory', '');
  lines.push(bundle.sharedRetrospectiveMemory || '(empty)', '');
  lines.push('### Warnings', '');
  pushList(lines, bundle.warnings);
  return lines.join('\n').trimEnd();
}

function renderTriggerFeedback(lines: string[], bundle: RealignmentBundle): void {
  lines.push('### Trigger Feedback', '');
  const feedback = bundle.triggerFeedback;
  if (!feedback) {
    lines.push('(empty)', '');
    return;
  }
  if ('trigger' in feedback) {
    lines.push('- Trigger: ui-triggered', '');
    return;
  }
  renderFeedback(lines, feedback);
  lines.push('');
}

function renderFeedbackList(
  lines: string[],
  heading: string,
  entries: RealignmentBundle['recentNegativeFeedback'],
): void {
  lines.push(`### ${heading}`, '');
  if (entries.length === 0) {
    lines.push('(empty)', '');
    return;
  }
  entries.forEach((entry, index) => {
    lines.push(`#### Feedback ${index + 1}: ${entry.feedbackId}`);
    renderFeedback(lines, entry);
    lines.push('');
  });
}

function renderFeedback(lines: string[], feedback: RealignmentBundle['recentNegativeFeedback'][number]): void {
  lines.push(`- Task ID: ${feedback.taskId}`);
  lines.push(`- Feedback Type: ${feedback.feedbackType}`);
  lines.push(`- Star Rating: ${feedback.starRating ?? 'none'}`);
  lines.push(`- Created At: ${feedback.createdAt}`);
  lines.push('');
  lines.push('Comment:');
  lines.push(feedback.comment || '(empty)');
}

function renderTriggerTask(lines: string[], task: TaskBundleEntry | null): void {
  lines.push('### Trigger Task', '');
  if (!task) {
    lines.push('(empty)', '');
    return;
  }
  renderTask(lines, task);
}

function renderTaskList(lines: string[], heading: string, tasks: TaskBundleEntry[]): void {
  lines.push(`### ${heading}`, '');
  if (tasks.length === 0) {
    lines.push('(empty)', '');
    return;
  }
  tasks.forEach((task, index) => {
    lines.push(`#### Task ${index + 1}: ${task.taskId}`, '');
    renderTask(lines, task);
  });
}

function renderTask(lines: string[], task: TaskBundleEntry): void {
  lines.push(`- Task ID: ${task.taskId}`);
  lines.push(`- Task Title: ${task.taskTitle}`);
  lines.push(`- Difficulty Level: ${task.difficultyLevel}`);
  lines.push('', '#### Task Summary', task.taskSummary || '(empty)', '');
  lines.push('#### Completed Work Summary', task.completedWorkSummary || '(empty)', '');
  lines.push('#### Key Decisions');
  pushList(lines, task.keyDecisions);
  lines.push('', '#### Known Limitations');
  pushList(lines, task.knownLimitations);
  lines.push('', '#### Retrospective Summary', task.retrospectiveSummary || '(empty)', '');
  lines.push('#### What Went Well');
  pushList(lines, task.whatWentWell);
  lines.push('', '#### What Could Have Gone Better');
  pushList(lines, task.whatCouldHaveGoneBetter);
  lines.push('', '#### Action Items');
  pushList(lines, task.actionItems);
  if (task.warnings.length > 0) {
    lines.push('', '#### Warnings');
    pushList(lines, task.warnings);
  }
  lines.push('');
}

function renderGrd(lines: string[], bundle: RealignmentBundle): void {
  const grd = bundle.globalRealignmentDoc;
  lines.push('### Current Global Realignment Document', '');
  lines.push(`- Version: ${grd.version}`, '');
  lines.push('#### Standing Expectations');
  pushList(lines, grd.standingExpectations);
  lines.push('', '#### Lessons Learned');
  pushList(lines, grd.lessonsLearned);
  lines.push('', '#### Behavioral Guidance');
  pushList(lines, grd.behavioralGuidance);
  lines.push('', '#### Fairness Framing');
  pushList(lines, grd.fairnessFraming);
  lines.push('');
}

function renderRetrospectiveDigest(lines: string[], entries: RetrospectiveDigestEntry[]): void {
  lines.push('### Rolling Retrospective Digest', '');
  if (entries.length === 0) {
    lines.push('(empty)', '');
    return;
  }
  entries.forEach((entry, index) => {
    lines.push(`#### Retrospective ${index + 1}: ${entry.taskId}`);
    lines.push(`- Task Title: ${entry.taskTitle}`);
    lines.push(`- Completed At: ${entry.completedAt}`, '');
    lines.push('Summary:');
    lines.push(entry.retrospectiveSummary || '(empty)', '');
    lines.push('What Went Well:');
    pushList(lines, entry.whatWentWell);
    lines.push('', 'What Could Have Gone Better:');
    pushList(lines, entry.whatCouldHaveGoneBetter);
    lines.push('', 'Action Items:');
    pushList(lines, entry.actionItems);
    if (entry.warnings.length > 0) {
      lines.push('', 'Warnings:');
      pushList(lines, entry.warnings);
    }
    lines.push('');
  });
}

function pushList(lines: string[], values: string[]): void {
  if (values.length === 0) {
    lines.push('(empty)');
    return;
  }
  values.forEach((value) => lines.push(`- ${value}`));
}
