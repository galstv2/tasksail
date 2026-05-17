import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PolicyValidator } from '../index.js';
import type { Violation } from '../types.js';
import { evaluateTemplateStructureRules } from '../rules/template.js';
import {
  HANDOFF_TEMPLATE_SPECS,
  TEMPLATE_SOURCE_PATHS,
} from '../rules/templateSpecs.js';

const REPO_ROOT = join(import.meta.dirname, '../../../../..');
const RETROSPECTIVE_TEMPLATE = 'retrospective-input.md';

const PER_TASK_COMMENT = `<!-- PER-TASK SECTION. Populate every task. Describe THIS task only.
     File names and symbols are allowed here because this is a per-task record. -->`;

const CYCLE_LEVEL_COMMENT = `<!-- CYCLE-LEVEL SECTION. Populate ONLY when Retrospective Required is "true".
     Leave this section completely empty (no placeholder, no bullets, no prose) when
     Retrospective Required is "false". On the cycle-boundary task, write 1-5 bullets
     that describe abstracted patterns or principles. Do NOT name files, symbols,
     functions, line numbers, task IDs, or repo paths. Do NOT quote code. Each bullet
     must be reusable on an unrelated future task. -->`;

const PER_TASK_SECTIONS = [
  'Retrospective Summary',
  'Meeting Context',
  "Lily's Contribution (Planning Specialist)",
  "Alice's Contribution (Product Manager)",
  "Dalton's Contribution (Software Engineer)",
  "Ron's Contribution (QA and Closeout)",
] as const;

const CYCLE_LEVEL_SECTIONS = [
  'What Went Well',
  'What Could Have Gone Better',
  'Action Items',
  'Reusable Team Learnings',
  'Anti-Patterns To Avoid',
] as const;

function sectionBody(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0);
  const bodyStart = markdown.indexOf('\n', start) + 1;
  const nextHeading = markdown.indexOf('\n## ', bodyStart);
  return markdown.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading).trim();
}

function buildTemplateValidator(violations: Violation[]): PolicyValidator {
  const evaluatedRules = new Set<string>();
  return {
    rootDir: REPO_ROOT,
    mode: 'ci',
    namedAgentTeam: {
      'planning-agent': {
        name: 'Lily',
        role: 'Planning Specialist',
        workflowOrder: 0,
      },
      'product-manager': {
        name: 'Alice',
        role: 'Product Manager',
        workflowOrder: 1,
      },
      'software-engineer': {
        name: 'Dalton',
        role: 'Software Engineer',
        workflowOrder: 2,
      },
      qa: {
        name: 'Ron',
        role: 'QA and Closeout',
        workflowOrder: 3,
      },
    },
    recordRule(ruleId: string): void {
      evaluatedRules.add(ruleId);
    },
    addViolation(violation: Violation): void {
      violations.push(violation);
    },
  } as unknown as PolicyValidator;
}

describe('retrospective template structure', () => {
  it('keeps retrospective-input.md compatible with workflow-policy template rules', async () => {
    const violations: Violation[] = [];
    await evaluateTemplateStructureRules(buildTemplateValidator(violations));

    expect(violations).toEqual([]);
  });

  it('keeps the retrospective section list valid while gating cycle-level comments', () => {
    const templatePath = TEMPLATE_SOURCE_PATHS[RETROSPECTIVE_TEMPLATE];
    expect(templatePath).toBe('AgentWorkSpace/templates/retrospective-input.md');

    const markdown = readFileSync(join(REPO_ROOT, templatePath), 'utf-8');
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    for (const section of HANDOFF_TEMPLATE_SPECS[RETROSPECTIVE_TEMPLATE].sections) {
      expect(headings, `template must include ${section}`).toContain(section);
    }

    for (const section of PER_TASK_SECTIONS) {
      expect(sectionBody(markdown, section)).toContain(PER_TASK_COMMENT);
    }

    for (const section of CYCLE_LEVEL_SECTIONS) {
      expect(sectionBody(markdown, section)).toBe(CYCLE_LEVEL_COMMENT);
    }
  });
});

describe('implementation-spec template structure', () => {
  it('keeps Intake Requirements immediately after Task Metadata', () => {
    const markdown = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/implementation-spec.md'),
      'utf-8',
    );
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(headings).toEqual([
      'Task Metadata',
      'Intake Requirements',
      'Problem and Outcome',
      'Current State and Boundaries',
      'Implementation Plan',
      'Risk and Impact',
      'Validation and Evidence',
      'Change Surface',
    ]);
  });

  it('keeps Requirement Handling nested under Implementation Plan', () => {
    const markdown = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/implementation-spec.md'),
      'utf-8',
    );
    const implementationPlan = sectionBody(markdown, 'Implementation Plan');

    expect(implementationPlan).toContain('### Touched Systems');
    expect(implementationPlan).toContain('### Requirement Handling');
    expect(implementationPlan).toContain('### Proposed Structure');
    expect(implementationPlan.indexOf('### Touched Systems')).toBeLessThan(
      implementationPlan.indexOf('### Requirement Handling'),
    );
    expect(implementationPlan.indexOf('### Requirement Handling')).toBeLessThan(
      implementationPlan.indexOf('### Proposed Structure'),
    );
  });

  it('keeps implementation-spec and slice templates scaled without filler guidance', () => {
    const implementationSpec = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/implementation-spec.md'),
      'utf-8',
    );
    const sliceTemplate = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/slice-template.md'),
      'utf-8',
    );

    expect(implementationSpec).toContain('Scale detail to task complexity');
    expect(implementationSpec).toContain('Do not add filler');
    expect(sliceTemplate).toContain('Scale detail to task complexity');
    expect(sliceTemplate).toContain('Do not add filler');
  });

  it('keeps new slice guidance headings inside existing top-level sections', () => {
    const markdown = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/slice-template.md'),
      'utf-8',
    );
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    const nestedHeadings = [...markdown.matchAll(/^### (.+)$/gm)].map((match) => match[1]);

    expect(headings).toEqual([
      'Objective',
      'Dependencies and Order',
      'Execution Scope',
      'Files and Interfaces',
      'Acceptance and Validation',
      'Guards and Coordination',
    ]);
    expect(nestedHeadings).toEqual(expect.arrayContaining([
      'Inputs to Read',
      'Requirement Coverage',
      'Allowed Changes',
      'Out of Scope',
      'Stale Assumption Handling',
      'Closeout Requirements',
    ]));
  });

  it('keeps Requirement Coverage nested under Execution Scope', () => {
    const markdown = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/slice-template.md'),
      'utf-8',
    );
    const executionScope = sectionBody(markdown, 'Execution Scope');

    expect(executionScope).toContain('### Scope');
    expect(executionScope).toContain('### Requirement Coverage');
    expect(executionScope).toContain('### Allowed Changes');
    expect(executionScope.indexOf('### Scope')).toBeLessThan(
      executionScope.indexOf('### Requirement Coverage'),
    );
    expect(executionScope.indexOf('### Requirement Coverage')).toBeLessThan(
      executionScope.indexOf('### Allowed Changes'),
    );
  });

  it('keeps parallel-ok headings validator-compatible while describing orchestrated execution', () => {
    const markdown = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/parallel-ok.md'),
      'utf-8',
    );
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(markdown).toContain('Complex Dalton fleet/orchestrator execution');
    expect(markdown).toContain('Complex does not mean every slice must run simultaneously');
    expect(headings).toEqual([
      'Task Metadata',
      'Decision',
      'Independent Slices',
      'Constraints',
      'Coordination Notes',
    ]);
  });
});

describe('Ron closeout template structure', () => {
  it('keeps final-summary requirement verification and exact Task branches contract aligned', () => {
    const finalSummary = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/final-summary.md'),
      'utf-8',
    );
    const qaInstructions = readFileSync(
      join(REPO_ROOT, '.github/copilot/instructions/qa.instructions.md'),
      'utf-8',
    );
    const artifactCompletion = readFileSync(
      join(REPO_ROOT, 'src/backend/platform/agent-runner/artifactCompletion.ts'),
      'utf-8',
    );
    const headings = [...finalSummary.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(headings).toContain('Requirement Verification');
    expect(headings).toContain('Closeout Owner Agent ID');
    expect(headings).toContain('Task branches');
    expect(HANDOFF_TEMPLATE_SPECS['final-summary.md'].sections).toContain('Requirement Verification');
    expect(HANDOFF_TEMPLATE_SPECS['final-summary.md'].sections).toContain('Task branches');
    expect(qaInstructions).toContain('## Task branches');
    expect(artifactCompletion).toContain("sections['Task branches']");
  });

  it('keeps issues template guidance tied to generated requirement IDs and top-level Review Outcome', () => {
    const issues = readFileSync(
      join(REPO_ROOT, 'AgentWorkSpace/templates/issues.md'),
      'utf-8',
    );
    const headings = [...issues.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(headings).toContain('Review Outcome');
    expect(sectionBody(issues, 'Expectation Violated')).toContain('generated requirement');
    expect(sectionBody(issues, 'Expectation Violated')).toContain('CR-*, COMP-*, or VAL-*');
  });
});
