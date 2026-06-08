import type {
  ArchivedParentChainArchiveBundle,
  ArchivedParentContextBundle,
  ArchivedParentTaskContent,
  PlannerChildTaskExecutionScope,
  PlannerPlanningReloadScope,
} from './desktopContractPlanner';

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
 * draft-write caution so the planner does not write to staging prematurely.
 * Child-task and markdown-review flows inject their own caution via
 * dedicated builders — this covers the regular fresh-session path.
 */
export function wrapFreshSessionMessage(guideText: string): string {
  return `${DRAFT_WRITE_CAUTION}\n\n${guideText}`;
}

export const PLANNER_SAVE_DRAFT_WORKFLOW = {
  guideMessage: 'Please save what we have so far. Draft the spec now.',
  prompt:
    'This is the internal Draft Spec save prompt and authorizes you to write the staged planning document now. ' +
    'Please update the existing staged planning document in AgentWorkSpace/dropbox/.staging/ now. ' +
    'Edit the current staged file in place and preserve the existing shell structure. ' +
    'Update the H1 task title and all the editable planning sections as specified. ' +
    'Do NOT change Task Lineage, Context Pack Binding, Branch Chain, or Source metadata. ' +
    'Do NOT rename the file and do NOT create any additional .md files in .staging/.',
} as const;

export function buildChildTaskStarterPrompt(args: {
  parentTaskId: string;
  parentTaskTitle: string;
  rootTaskId: string;
  parentQmdScope: string;
  parentTaskContent?: ArchivedParentTaskContent;
  parentContextBundle?: ArchivedParentContextBundle;
  parentChainArchiveBundle?: ArchivedParentChainArchiveBundle;
  childTaskExecutionScope?: PlannerChildTaskExecutionScope;
  plannerPlanningReloadScope?: PlannerPlanningReloadScope;
}): string {
  const bundleSections = formatParentContextBundle(args.parentContextBundle);
  const contentSections = bundleSections || formatParentTaskContent(args.parentTaskContent);
  const chainSections = formatParentChainArchiveBundle(args.parentChainArchiveBundle);
  const scopeSections = formatChildTaskScopeSections(
    args.childTaskExecutionScope,
    args.plannerPlanningReloadScope,
  );
  return (
    'This is a child-task continuation workflow against an archived parent task. The staged planning document already contains the editable H1 title plus the platform-owned lineage, context, and source shell.\n\n' +
    `Parent Task ID: ${args.parentTaskId}\n` +
    `Parent task title: ${args.parentTaskTitle}\n` +
    `Root Task ID: ${args.rootTaskId}\n` +
    `Parent QMD Scope: ${args.parentQmdScope}\n\n` +
    "The parent task's planner focus snapshot has been restored for this session.\n\n" +
    (scopeSections ? `${scopeSections}\n\n` : '') +
    (chainSections ? `${chainSections}\n\n` : '') +
    (contentSections ? `${contentSections}\n\n` : '') +
    'Ask the Guide what continuation, extension, or follow-up outcome they need before finalizing the child-task intake.\n\n' +
    'Rules:\n' +
    '- Fill or refine only the H1 task title and editable sections in the staged document.\n' +
    '- Use the immediate parent context only as read-only background for this child task.\n' +
    '- Do NOT change Task Lineage, Context Pack Binding, Branch Chain, or Source metadata.\n' +
    '- You own translating the conversation into Request Summary, Desired Outcome, Constraints, Acceptance Signals, Parent Task Carry-Forward Summary, and Suggested Routing / Planner Notes.\n' +
    '- Ask natural follow-up questions for missing facts. Do not ask the Guide to fill section-by-section intake fields or present a required-fields form.\n' +
    '- Do not guess or fabricate missing content.\n' +
    `- ${DRAFT_WRITE_CAUTION}`
  );
}

function quoteBoundaryValue(value: string): string {
  return value.replaceAll('"', '\\"');
}

function formatParentChainArchiveBundle(bundle?: ArchivedParentChainArchiveBundle): string {
  if (!bundle) return '';
  const sections: string[] = [
    'Full Chain Archive Timeline (Read-Only Planning Memory)',
    'This timeline summarizes completed tasks in the same child-task chain, ordered from root to the selected immediate parent. Use it only to understand chain history and continuity. It is not implementation authority.',
  ];
  if (bundle.status === 'no-chain-state') {
    sections.push('No prior child-chain archive timeline exists yet. This child starts the chain.');
  }
  if (bundle.status === 'missing-archives' && bundle.missingTaskIds.length > 0) {
    sections.push(`Missing chain archive task IDs: ${bundle.missingTaskIds.join(', ')}`);
  }
  if (bundle.truncated || bundle.tasks.some((task) => task.truncated)) {
    sections.push('One or more chain archives were truncated by the platform prompt-size guard.');
  }
  sections.push(...bundle.tasks.map((task) => (
    `--- BEGIN CHAIN ARCHIVE TASK depth=${task.depth} role=${task.role} taskId=${task.taskId} title="${quoteBoundaryValue(task.title)}" archivedAt=${task.archivedAt ?? 'null'} ---\n` +
    task.content.trimEnd() +
    `\n--- END CHAIN ARCHIVE TASK taskId=${task.taskId} ---`
  )));
  return sections.join('\n\n');
}

function formatChildTaskScopeSections(
  childScope?: PlannerChildTaskExecutionScope,
  reloadScope?: PlannerPlanningReloadScope,
): string {
  if (!childScope && !reloadScope) return '';
  const sections: string[] = [];
  if (childScope) {
    sections.push(
      [
        'Child Execution Scope (Implementation Authority):',
        'Implementation agent, Context Pack Binding, activation, and closeout use only Child Execution Scope.',
        formatScopeSummary(childScope),
      ].join('\n'),
    );
  }
  if (reloadScope) {
    sections.push(
      [
        'Additional Parent Context Scope (Read-Only Planning Context):',
        'Do not infer implementation authority from read-only planning context.',
        'If broader implementation authority is needed, ask the Guide to adjust Child Execution Scope.',
        formatScopeSummary(reloadScope),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

function formatScopeSummary(scope: PlannerChildTaskExecutionScope | PlannerPlanningReloadScope): string {
  const primaryRepos = scope.selectedRepoIds.filter((id) => scope.repositoryTypes?.[id] === 'primary');
  const supportRepos = scope.selectedRepoIds.filter((id) => (scope.repositoryTypes?.[id] ?? 'support') === 'support');
  const primaryFocusIds = scope.selectedFocusIds.filter((id) => scope.repositoryTypes?.[id] === 'primary');
  const supportFocusIds = scope.selectedFocusIds.filter((id) => (scope.repositoryTypes?.[id] ?? 'support') === 'support');
  const standardRows = scope.deepFocusEnabled
    ? []
    : [
        `Primary repositories: ${primaryRepos.length ? primaryRepos.join(', ') : 'none'}`,
        `Support/read-only repositories: ${supportRepos.length ? supportRepos.join(', ') : 'none'}`,
        `Primary focus IDs: ${primaryFocusIds.length ? primaryFocusIds.join(', ') : 'none'}`,
        `Support/read-only focus IDs: ${supportFocusIds.length ? supportFocusIds.join(', ') : 'none'}`,
      ];
  return [
    `Context Pack ID: ${scope.contextPackId}`,
    `Scope mode: ${scope.scopeMode}`,
    `Selected repositories: ${scope.selectedRepoIds.length ? scope.selectedRepoIds.join(', ') : 'none'}`,
    `Selected focus IDs: ${scope.selectedFocusIds.length ? scope.selectedFocusIds.join(', ') : 'none'}`,
    `Deep Focus: ${scope.deepFocusEnabled ? 'enabled' : 'disabled'}`,
    ...standardRows,
    `Primary Deep Focus targets: ${scope.selectedFocusTargets.length}`,
    `Support/read-only Deep Focus targets: ${scope.selectedSupportTargets.length}`,
    `Test target: ${scope.selectedTestTarget ? `${scope.selectedTestTarget.kind}:${scope.selectedTestTarget.path}` : 'none'}`,
  ].join('\n');
}

function formatParentContextBundle(bundle?: ArchivedParentContextBundle): string {
  if (!bundle) return '';
  const sections: string[] = [];
  if (bundle.files.length > 0) {
    sections.push(
      [
        'Immediate Parent Context Bundle:',
        'This context is from the selected immediate parent task.',
        ...bundle.files.map((file) => (
          `--- BEGIN IMMEDIATE PARENT CONTEXT FILE: ${file.relativePath} ---\n` +
          file.content.trimEnd() +
          `\n--- END IMMEDIATE PARENT CONTEXT FILE: ${file.relativePath} ---`
        )),
      ].join('\n\n'),
    );
  }
  if (bundle.status === 'missing-artifacts') {
    sections.push('Parent context artifact status: nested archive artifacts are missing or no allowed parent context files were available.');
  } else if (bundle.status === 'legacy-flat-archive') {
    sections.push('Parent context artifact status: this parent uses a legacy flat archive, so nested handoffs and ImplementationSteps are unavailable.');
  }
  if (bundle.truncated || bundle.files.some((file) => file.truncated)) {
    sections.push('One or more immediate parent context files were truncated by the platform prompt-size guard.');
  }
  if (bundle.files.length === 0 && bundle.fallbackSummary) {
    const fallback = formatParentTaskContent(bundle.fallbackSummary);
    if (fallback) sections.push(fallback);
  }
  return sections.join('\n\n');
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
    'This is the standard planner review path, not an active child-task workflow. ' +
    'Use it only as supporting context for the editable planning sections in the already-staged shell. ' +
    'Identify which editable required sections are missing or insufficient. ' +
    'The required sections are: Request Summary, Desired Outcome, and Acceptance Signals. ' +
    'Acceptance Signals must contain at least one bullet or numbered item. ' +
    'An empty Parent Task Carry-Forward Summary is valid in this standard flow; do not ask whether this is a child task. ' +
    'Only the dedicated child-task workflow requires Parent Task Carry-Forward Summary to be non-empty.\n\n' +
    'Do not validate or rewrite platform-owned lineage, context-pack binding, or source sections. You may improve only the H1 task title and editable planning sections. ' +
    'If any editable required sections are missing or incomplete, ask me follow-up questions ' +
    'to fill in the gaps. Do not guess or fabricate content for missing sections. ' +
    'If you have everything you need to draft the spec, say that the intake is ready and the Draft Spec button can be clicked.\n\n' +
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
    'Do NOT validate or rewrite platform-owned lineage, context-pack binding, or source sections. You may improve only the H1 task title and editable planning sections.\n\n' +
    'If any required content sections are still missing or incomplete after reviewing the file, ' +
    'ask me follow-up questions to fill in the gaps. Do not guess or fabricate content.\n\n' +
    DRAFT_WRITE_CAUTION
  );
}
