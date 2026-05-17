import { describe, expect, it } from 'vitest';

import {
  canonicalizePlannerTaskTitle,
  deriveBypassPlannerTaskTitle,
  resolvePlannerTaskTitleFromDraft,
} from './main.plannerTitle';

describe('planner task title helpers', () => {
  it('canonicalizes spaces, title case, punctuation, and hyphens to lower snake_case', () => {
    expect(canonicalizePlannerTaskTitle('Harden terminal task scope')).toBe('harden_terminal_task_scope');
    expect(canonicalizePlannerTaskTitle('terminal-task-scope')).toBe('terminal_task_scope');
    expect(canonicalizePlannerTaskTitle('Fix: Lily / Bypass Title Flow!')).toBe('fix_lily_bypass_title_flow');
  });

  it('collapses duplicate underscores and trims leading/trailing underscores', () => {
    expect(canonicalizePlannerTaskTitle('__Terminal___Scope__')).toBe('terminal_scope');
  });

  it('falls back to content-derived title when the H1 is missing', () => {
    expect(resolvePlannerTaskTitleFromDraft(`
## Request Summary

Terminal terminal scope should filter active context pack scope and preserve terminal history.
`)).toBe('active_scope_terminal');
  });

  it('falls back to content-derived title when the H1 canonicalizes to task_title', () => {
    expect(resolvePlannerTaskTitleFromDraft(`# Task Title

## Request Summary

Renderer renderer boundary boundary.
`)).toBe('boundary_renderer');
  });

  it('strips the H1 line before fallback derivation so placeholder title does not pollute the result', () => {
    expect(resolvePlannerTaskTitleFromDraft(`# Task Title

## Request Summary

Archive archive handoff handoff.
`)).toBe('archive_handoff');
  });

  it('strips comments and fenced code before word frequency', () => {
    expect(deriveBypassPlannerTaskTitle(`
<!-- archive archive archive -->
\`\`\`
database database database database
\`\`\`
Terminal terminal scope should filter active context pack scope and preserve terminal history.
`)).toBe('active_scope_terminal');
  });

  it('selects three most frequent non-stop words, breaks ties alphabetically, then sorts selected words alphabetically', () => {
    expect(deriveBypassPlannerTaskTitle(`
zeta zeta beta beta alpha alpha gamma
`)).toBe('alpha_beta_zeta');
  });

  it('falls back to task when no meaningful words exist', () => {
    expect(deriveBypassPlannerTaskTitle('the and or is to')).toBe('task');
  });

  it('does not let fenced code dominate the derived title', () => {
    expect(deriveBypassPlannerTaskTitle(`Terminal terminal scope filtering should preserve context.

\`\`\`
database database database database
\`\`\`
`)).toBe('context_filtering_terminal');
  });
});
