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
