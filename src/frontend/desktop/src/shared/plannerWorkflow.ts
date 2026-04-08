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
  carryForwardSummary: string;
}): string {
  return (
    'This is a child-task workflow. The staged planning document already contains the platform-owned title and lineage shell.\n\n' +
    `Parent task title: ${args.parentTaskTitle}\n` +
    (args.carryForwardSummary ? `Known carry-forward context: ${args.carryForwardSummary}\n` : '') +
    '\n' +
    'The parent task was selected by the Guide from the active context pack archive. ' +
    'You are creating a child-task intake that continues from this parent.\n\n' +
    'Rules:\n' +
    '- Fill or refine only the editable sections in the staged document.\n' +
    '- Do NOT change the generated title or any platform-owned sections.\n' +
    '- The Guide will provide or you should ask for: Request Summary, Desired Outcome, ' +
    'Constraints, Acceptance Signals, Parent Task Carry-Forward Summary, and Suggested Routing / Planner Notes.\n' +
    '- Ask follow-up questions for any missing required content. Do not guess or fabricate.\n' +
    `- ${DRAFT_WRITE_CAUTION}`
  );
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
