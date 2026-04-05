import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatJson,
  formatText,
  listSliceFiles,
  loadWorkspaceArtifact,
  parseArtifactMetadata,
  parallelOkHasActiveApproval,
  resolveSemanticSection,
} from '../index.js';
import {
  SLICE_REQUIRED_SECTION_SPECS,
  SPEC_REQUIRED_SECTION_SPECS,
} from '../models.js';

describe('workflow-policy artifacts and formatting', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('loads workspace artifacts with parsed metadata and authoritative runtime approval', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-artifact-'));
    createdRoots.push(repoRoot);

    const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime'), { recursive: true });

    writeFileSync(
      path.join(handoffsDir, 'parallel-plan.md'),
      [
        '## Task Metadata',
        '- Task ID: task-42',
        '## Task Lineage',
        '- Parent Task ID: parent-1',
        '## Decision',
        '<!-- placeholder -->',
        'simple',
        '## Notes',
        'Keep this section substantive.',
      ].join('\n'),
      'utf-8',
    );

    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'workflow-facts.json'),
      JSON.stringify({
        schema_version: 1,
        source: 'typescript',
        generated_at: new Date().toISOString(),
        completion: {},
        parallel: { active_approval: true },
        next_agent_id: 'product-manager',
        next_agent_source: 'typescript runtime completion',
      }, null, 2),
      'utf-8',
    );

    const artifact = await loadWorkspaceArtifact(repoRoot, 'AgentWorkSpace/handoffs/parallel-plan.md');

    expect(artifact.metadata).toEqual({ 'Task ID': 'task-42' });
    expect(artifact.taskLineage).toEqual({ 'Parent Task ID': 'parent-1' });
    expect(artifact.hasSubstantiveContent).toBe(true);
    expect(await parallelOkHasActiveApproval(repoRoot, artifact)).toBe(true);
  });

  it('renders stable text and json output contracts', () => {
    const result = {
      status: 'report-only-violations',
      mode: 'lint',
      phase: 'report-only',
      rule_count: 2,
      failure_count: 0,
      warning_count: 1,
      violations: [
        {
          rule_id: 'slice.missing-purpose',
          severity: 'warning',
          transition: 'lint',
          artifact: 'AgentWorkSpace/ImplementationSteps/slice-1.md',
          message: 'Purpose section is empty.',
          remediation: 'Populate the Purpose section.',
        },
      ],
      next_steps: ['Populate the Purpose section.'],
      guardrail: {
        status: 'allowed',
        requested_agent_id: 'software-engineer',
        resolved_agent_id: 'software-engineer',
        expected_agent_id: 'software-engineer',
        expected_source: 'slice progress',
        validator_mode: 'runtime',
        launch_seam: 'workflow-policy-validator',
        required_model: 'gpt-4.1',
        active_model: '',
        violations: [],
      },
    } as const;

    expect(formatText(result)).toBe(
      [
        'Workflow policy status: report-only-violations',
        'Mode: lint',
        'Phase: report-only',
        'Rules evaluated: 2',
        'Failures: 0',
        'Warnings: 1',
        'Violations:',
        '- [warning] slice.missing-purpose',
        '  Artifact: AgentWorkSpace/ImplementationSteps/slice-1.md',
        '  Message: Purpose section is empty.',
        '  Remediation: Populate the Purpose section.',
        'Guardrail:',
        '- Status: allowed',
        '- Requested agent ID: software-engineer',
        '- Expected agent ID: software-engineer',
        '- Required model: gpt-4.1',
        '- Launch seam: workflow-policy-validator',
        'Next steps:',
        '- Populate the Purpose section.',
      ].join('\n'),
    );

    expect(JSON.parse(formatJson(result))).toEqual({
      status: 'report-only-violations',
      mode: 'lint',
      phase: 'report-only',
      rule_count: 2,
      failure_count: 0,
      warning_count: 1,
      violations: [
        {
          rule_id: 'slice.missing-purpose',
          severity: 'warning',
          transition: 'lint',
          artifact: 'AgentWorkSpace/ImplementationSteps/slice-1.md',
          message: 'Purpose section is empty.',
          remediation: 'Populate the Purpose section.',
        },
      ],
      next_steps: ['Populate the Purpose section.'],
      guardrail: {
        status: 'allowed',
        requested_agent_id: 'software-engineer',
        resolved_agent_id: 'software-engineer',
        expected_agent_id: 'software-engineer',
        expected_source: 'slice progress',
        validator_mode: 'runtime',
        launch_seam: 'workflow-policy-validator',
        required_model: 'gpt-4.1',
        active_model: '',
        violations: [],
      },
    });
  });

  it('resolves semantic sections through aliases and nested grouped headings', () => {
    const specSections = {
      'Problem and Outcome': [
        'Context paragraph.',
        '',
        '### Desired Outcomes',
        '- Preserve compatibility.',
      ],
      'Acceptance and Validation': [
        '### Acceptance Criteria',
        '- Validators accept semantic aliases.',
        '',
        '### Validation Commands',
        '```bash',
        'pnpm test -- --run contentRuleFamilies.test.ts',
        '```',
      ],
    };

    expect(
      resolveSemanticSection(specSections, SPEC_REQUIRED_SECTION_SPECS[1]!),
    ).toMatchObject({
      heading: 'Desired Outcomes',
      source: 'nested-heading',
      content: ['- Preserve compatibility.'],
    });

    expect(
      resolveSemanticSection(specSections, SLICE_REQUIRED_SECTION_SPECS[4]!),
    ).toMatchObject({
      heading: 'Acceptance Criteria',
      source: 'nested-heading',
      content: ['- Validators accept semantic aliases.', ''],
    });
  });

  it('resolves grouped implementation-spec sections using the actual container layout', () => {
    const specSections = {
      'Task Metadata': [
        '### Core Metadata',
        '- Task ID: task-1',
        '',
        '### Task Lineage',
        '- Task Kind: child-task',
      ],
      'Problem and Outcome': [
        '### Problem Statement',
        'Need grouped scaffolds.',
        '',
        '### Goals',
        '- Keep compatibility.',
        '',
        '### Non-Goals',
        '- Do not rework queue behavior.',
      ],
      'Current State and Boundaries': [
        '### Parent Task Carry-Forward Context',
        'Parent context matters here.',
        '',
        '### Codebase Analysis',
        'Existing validator logic is alias-aware.',
        '',
        '### Dependency Analysis',
        '| Module | Depends On |',
        '|---|---|',
        '| spec.ts | artifacts.ts |',
        '',
        '### Change Boundaries',
        'Workflow policy and tests only.',
      ],
      'Implementation Plan': [
        '### Architecture Summary',
        'Grouped sections keep the scaffold stable.',
        '',
        '### Touched Systems',
        '- workflow-policy',
        '',
        '### Proposed Structure',
        '',
        '### Contracts',
        'None.',
      ],
    };

    expect(resolveSemanticSection(specSections, SPEC_REQUIRED_SECTION_SPECS[2]!)).toMatchObject({
      heading: 'Non-Goals',
      source: 'nested-heading',
      content: ['- Do not rework queue behavior.'],
    });
    expect(resolveSemanticSection(specSections, SPEC_REQUIRED_SECTION_SPECS[3]!)).toMatchObject({
      heading: 'Architecture Summary',
      source: 'nested-heading',
      content: ['Grouped sections keep the scaffold stable.', ''],
    });
    expect(resolveSemanticSection(specSections, SPEC_REQUIRED_SECTION_SPECS[4]!)).toMatchObject({
      heading: 'Touched Systems',
      source: 'nested-heading',
      content: ['- workflow-policy', ''],
    });
    expect(resolveSemanticSection(specSections, SPEC_REQUIRED_SECTION_SPECS[8]!)).toMatchObject({
      heading: 'Proposed Structure',
      source: 'nested-heading',
      content: [''],
    });
  });

  it('parses nested Task Lineage under Task Metadata without polluting metadata labels', () => {
    const sections = {
      'Task Metadata': [
        '### Core Metadata',
        '- Task ID: task-42',
        '- Task Title: Workflow policy parity',
        '',
        '### Task Lineage',
        '- Task Kind: child-task',
        '- Parent Task ID: parent-1',
      ],
    };

    expect(parseArtifactMetadata(sections)).toEqual({
      metadata: {
        'Task ID': 'task-42',
        'Task Title': 'Workflow policy parity',
      },
      taskLineage: {
        'Task Kind': 'child-task',
        'Parent Task ID': 'parent-1',
      },
    });
  });

  it('excludes the canonical slice template file from discovered slices', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-slices-'));
    createdRoots.push(repoRoot);
    const stepsDir = path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps');
    mkdirSync(stepsDir, { recursive: true });

    writeFileSync(path.join(stepsDir, 'slice-template.md'), '# Slice Template', 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-2.md'), '# Slice 2', 'utf-8');

    const sliceFiles = await listSliceFiles(stepsDir);

    expect(sliceFiles).toEqual([path.join(stepsDir, 'slice-2.md')]);
  });
});
