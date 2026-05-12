import path from 'node:path';

import { getActiveProvider } from '../../../cli-provider/index.js';
import type { ExternalMcpRegistry } from '../../../external-mcp-registry/index.js';
import { readTextFile } from '../../../core/index.js';
import { appendMcpContextBlock } from '../mcpPromptContext.js';
import type { CycleTaskContext } from '../retrospectivePhase.js';

export async function buildRetrospectivePrompt(options: {
  repoRoot: string;
  bundle: CycleTaskContext[];
  externalMcpRegistry?: ExternalMcpRegistry;
}): Promise<string> {
  const promptRelativePath = getActiveProvider(options.repoRoot).resolvePromptPath('retrospective-task');
  const promptPath = path.join(options.repoRoot, promptRelativePath);
  const anchor = (await readTextFile(promptPath))?.trim();
  if (!anchor) {
    throw new Error(`Launch prompt is missing or empty: ${promptPath}`);
  }

  const parts = [anchor, renderCycleContextBlock(options.bundle)];
  const mcpParts: string[] = [];
  appendMcpContextBlock(mcpParts, options.externalMcpRegistry, 'ron');
  const mcpBlock = mcpParts.join('\n').trim();
  if (mcpBlock) parts.push(mcpBlock);
  return parts.join('\n\n---\n\n');
}

function renderCycleContextBlock(bundle: CycleTaskContext[]): string {
  const lines = ['## Cycle Context (Last 10 Tasks)', ''];
  bundle.forEach((task, index) => {
    lines.push(`### Task ${index + 1}: ${task.taskId}`);
    lines.push(`- Current Task: ${task.isCurrentTask ? 'true' : 'false'}`);
    lines.push(`- Task Title: ${task.taskTitle}`);
    lines.push(`- Difficulty Level: ${task.difficultyLevel}`);
    lines.push('', '#### Task Summary', task.taskSummary || '(empty)', '');
    lines.push('#### Completed Work Summary', task.completedWorkSummary || '(empty)', '');
    lines.push('#### Key Decisions', ...formatList(task.keyDecisions), '');
    lines.push('#### Known Limitations', ...formatList(task.knownLimitations), '');
    lines.push('#### Retrospective Summary', task.retrospectiveSummary || '(empty)', '');
    lines.push('#### What Went Well', ...formatList(task.whatWentWell), '');
    lines.push('#### What Could Have Gone Better', ...formatList(task.whatCouldHaveGoneBetter), '');
    lines.push('#### Action Items', ...formatList(task.actionItems), '');
    if (task.warnings.length > 0) {
      lines.push('#### Warnings', ...formatList(task.warnings), '');
    }
  });
  return lines.join('\n').trimEnd();
}

function formatList(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ['(empty)'];
}
