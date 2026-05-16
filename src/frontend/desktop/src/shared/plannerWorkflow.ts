import type { ArchivedParentTaskContent } from './desktopContractPlanner';

function wrapAttachedFile(content: string): string {
  return (
    `--- BEGIN ATTACHED FILE ---\n` +
    content +
    `\n--- END ATTACHED FILE ---`
  );
}

const DRAFT_WRITE_CAUTION =
  'Do NOT edit the staged draft in AgentWorkSpace/dropbox/.staging/ yet. ' +
  'Wait until I confirm that all required editable sections are satisfied before saving.';

/**
 * Wraps the Guide's first message in a fresh planner session with the
 * draft-write caution so Lily does not write to staging prematurely.
 * Child-task and markdown-review flows inject their own caution via
 * dedicated builders — this covers the regular fresh-session path.
 */
export function wrapFreshSessionMessage(guideText: string): string {
  return `${DRAFT_WRITE_CAUTION}\n\n${guideText}`;
}

export const PLANNER_SAVE_DRAFT_WORKFLOW = {
  guideMessage: 'Lily, let\u2019s save what we have so far. Please draft the spec now.',
  prompt:
    'This is the internal Draft Spec save prompt and authorizes you to write the staged planning document now. ' +
    'Please update the existing staged planning document in AgentWorkSpace/dropbox/.staging/ now. ' +
    'Edit the current staged file in place and preserve the existing shell structure. ' +
    'Only update the editable planning sections. ' +
    'Do NOT change the generated title, Task Lineage, Context Pack Binding, or Source metadata. ' +
    'Do NOT rename the file and do NOT create any additional .md files in .staging/.',
} as const;

export function buildChildTaskStarterPrompt(args: {
  parentTaskId: string;
  parentTaskTitle: string;
  rootTaskId: string;
  parentQmdScope: string;
  parentTaskContent?: ArchivedParentTaskContent;
}): string {
  const contentSections = formatParentTaskContent(args.parentTaskContent);
  return (
    'This is a child-task correction workflow against an archived parent task. The staged planning document already contains the platform-owned title, lineage, context, and source shell.\n\n' +
    `Parent Task ID: ${args.parentTaskId}\n` +
    `Parent task title: ${args.parentTaskTitle}\n` +
    `Root Task ID: ${args.rootTaskId}\n` +
    `Parent QMD Scope: ${args.parentQmdScope}\n\n` +
    "The parent task's planner focus snapshot has been restored for this session.\n\n" +
    (contentSections ? `${contentSections}\n\n` : '') +
    'Ask the operator what specifically needs correction and why before finalizing the child-task intake.\n\n' +
    'Rules:\n' +
    '- Fill or refine only the editable sections in the staged document.\n' +
    '- Do NOT change the platform-owned title, Task Lineage, Context Pack Binding, or Source metadata.\n' +
    '- The Guide will provide or you should ask for: Request Summary, Desired Outcome, ' +
    'Constraints, Acceptance Signals, Parent Task Carry-Forward Summary, and Suggested Routing / Planner Notes.\n' +
    '- Ask follow-up questions for any missing required content. Do not guess or fabricate.\n' +
    `- ${DRAFT_WRITE_CAUTION}`
  );
}

function formatParentTaskContent(content?: ArchivedParentTaskContent): string {
  if (!content) return '';
  const sections: string[] = [];
  const addText = (heading: string, value?: string): void => {
    const trimmed = value?.trim();
    if (trimmed) sections.push(`${heading}:\n${trimmed}`);
  };
  const addList = (heading: string, values?: string[]): void => {
    const items = values?.map((value) => value.trim()).filter(Boolean) ?? [];
    if (items.length > 0) {
      sections.push(`${heading}:\n${items.map((item) => `- ${item}`).join('\n')}`);
    }
  };
  addText('Parent archive task title', content.taskTitle);
  addText('Parent archive task summary', content.taskSummary);
  addText('Completed work summary', content.completedWorkSummary);
  addList('Key decisions', content.keyDecisions);
  addList('Known limitations', content.knownLimitations);
  addList('Parent constraints', content.constraints);
  addText('Implementation summary', content.implementationSummary);
  return sections.join('\n\n');
}

export function buildMarkdownReviewPrompt(filename: string, content: string): string {
  return (
    `I am attaching the Markdown file "${filename}" for you to review.\n\n` +
    wrapAttachedFile(content) +
    '\n\n' +
    'Compare this file against AgentWorkSpace/templates/planning-intake.md. ' +
    'Use it only as supporting context for the editable planning sections in the already-staged shell. ' +
    'Identify which editable required sections are missing or insufficient. ' +
    'The required sections are: Request Summary, Desired Outcome, and Acceptance Signals. ' +
    'Acceptance Signals must contain at least one bullet or numbered item. ' +
    'If this is a child-task flow, Parent Task Carry-Forward Summary must also be non-empty.\n\n' +
    'Do not validate or rewrite platform-owned title, lineage, context-pack binding, or source sections. ' +
    'If any editable required sections are missing or incomplete, ask me follow-up questions ' +
    'to fill in the gaps. Do not guess or fabricate content for missing sections.\n\n' +
    DRAFT_WRITE_CAUTION
  );
}

export function buildChildTaskMarkdownReviewPrompt(
  filename: string,
  content: string,
): string {
  return (
    `I am attaching the Markdown file "${filename}" as supporting context ` +
    'for the active child-task workflow.\n\n' +
    wrapAttachedFile(content) +
    '\n\n' +
    'IMPORTANT: This is a child-task workflow. Use the attachment only to improve the editable sections ' +
    'inside the existing staged shell.\n\n' +
    'You may use the attached file to fill content gaps in:\n' +
    '- Request Summary\n' +
    '- Desired Outcome\n' +
    '- Constraints\n' +
    '- Acceptance Signals\n' +
    '- Parent Task Carry-Forward Summary\n\n' +
    '- Suggested Routing / Planner Notes\n\n' +
    'Do NOT validate or rewrite platform-owned title, lineage, context-pack binding, or source sections.\n\n' +
    'If any required content sections are still missing or incomplete after reviewing the file, ' +
    'ask me follow-up questions to fill in the gaps. Do not guess or fabricate content.\n\n' +
    DRAFT_WRITE_CAUTION
  );
}
