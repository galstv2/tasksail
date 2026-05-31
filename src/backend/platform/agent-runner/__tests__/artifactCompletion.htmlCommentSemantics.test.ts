import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAgentArtifactCompletion } from '../artifactCompletion.js';

const TEST_TASK_ID = 'task-test-001';

describe('artifactCompletion HTML comment semantics', () => {
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'artifact-comment-semantics-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  function writeHandoff(fileName: string, content: string): void {
    writeFileSync(path.join(handoffsDir, fileName), content, 'utf-8');
  }

  function writeSlice(content: string): void {
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), content, 'utf-8');
  }

  function productManagerSpec(body: string, options: { onlyCommentContent?: boolean } = {}): string {
    const semanticBody = options.onlyCommentContent ? '<!-- seeded guidance -->' : body;
    return options.onlyCommentContent ? [
      '# Implementation Spec',
      '',
      '## Goals',
      semanticBody,
    ].join('\n') : [
      '# Implementation Spec',
      '',
      '## Problem and Outcome',
      '',
      '### Problem Statement',
      semanticBody,
      '',
      '### Goals',
      '- Plan the work.',
      '',
      '### Non-Goals',
      '- Do not change unrelated behavior.',
      '',
      '## Current State and Boundaries',
      '',
      '### Codebase Analysis',
      '- Existing behavior is in src/example.ts.',
      '',
      '### Source Inventory',
      '- slice-1 owns the change.',
      '',
      '### Dependency Analysis',
      '| Dependency | Impact |',
      '| --- | --- |',
      '| app | direct |',
      '',
      '### Change Boundaries',
      '- Keep scope focused.',
      '',
      '## Implementation Plan',
      '',
      '### Architecture Summary',
      'Use the existing code path.',
      '',
      '### Touched Systems',
      '- app',
      '',
      '### Proposed Structure',
      '- Update focused code and tests.',
      '',
      '### Slice Partition',
      '- slice-1 owns the change.',
      '',
      '## Validation and Evidence',
      '',
      '### Validation Strategy',
      '```bash',
      'pnpm run lint',
      '```',
      '',
      '## Change Surface',
      '',
      '### Files or Areas Likely to Change',
      '- src/example.ts',
    ].join('\n');
  }

  function productManagerSlice(body: string): string {
    return [
      '# Slice',
      '',
      '## Purpose',
      body,
      '',
      '## Depends On',
      'None.',
      '',
      '## Scope',
      '- Change scoped code.',
      '',
      '### Current Symbols',
      'None',
      '',
      '### Included Symbols',
      'None',
      '',
      '### Excluded Symbols',
      'None',
      '',
      '## Files',
      '- src/example.ts',
      '',
      '## Acceptance Criteria',
      '- Behavior is correct.',
      '',
      '## Unit Tests',
      '- Add tests.',
      '',
      '## Validation Commands',
      '```bash',
      'pnpm run lint',
      '```',
      '',
      '## Guards',
      'No unrelated changes.',
    ].join('\n');
  }

  function writeProductManagerArtifacts(options: {
    specBody: string;
    sliceBody: string;
    onlyCommentSpec?: boolean;
  }): void {
    writeHandoff('implementation-spec.md', productManagerSpec(options.specBody, {
      onlyCommentContent: options.onlyCommentSpec,
    }));
    writeHandoff('parallel-ok.md', '# Parallel OK\n\n## Decision\n<!-- guidance -->\nSimple\n');
    writeSlice(productManagerSlice(options.sliceBody));
  }

  function writeQaArtifacts(options: {
    issueOutcome?: string;
    closeoutOwner?: string;
    finalContent?: string;
    taskBranches?: string;
    difficulty?: string;
  } = {}): void {
    writeHandoff(
      'issues.md',
      `# Issues\n\n## Review Outcome\n${options.issueOutcome ?? '<!-- guidance -->\npass'}\n`,
    );
    writeHandoff('retrospective-input.md', '# Retro\n\n## Retrospective Summary\n- Done.\n');
    writeHandoff(
      'final-summary.md',
      [
        '# Final',
        '',
        '## Closeout Owner Agent ID',
        options.closeoutOwner ?? '<!-- guidance -->\nqa',
        '',
        '## Completed Work',
        options.finalContent ?? '- Completed.',
        '',
        '## Key Design Decisions',
        options.finalContent ?? '- Kept simple.',
        '',
        '## Known Limitations',
        options.finalContent ?? '- None.',
        '',
        '## Test Result Summary',
        options.finalContent ?? '- Focused checks passed.',
        '',
        '## Test Status',
        'passed',
        '',
        '## QA Status',
        'passed',
        '',
        '## Task branches',
        options.taskBranches ?? '[]',
        '',
        '## Difficulty Assessment',
        `- Difficulty Level: ${options.difficulty ?? 'Medium'}`,
      ].join('\n'),
    );
  }

  it('requires product-manager implementation-spec semantic content beyond comments', async () => {
    writeProductManagerArtifacts({
      specBody: '<!-- seeded guidance -->',
      sliceBody: '- Implement the slice.',
      onlyCommentSpec: true,
    });

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('requires product-manager final slice semantic content beyond comments', async () => {
    writeProductManagerArtifacts({
      specBody: '- Plan the work.',
      sliceBody: '<!-- seeded guidance -->',
    });

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });

  it('accepts product-manager artifacts when guidance comments precede real content', async () => {
    writeProductManagerArtifacts({
      specBody: '<!-- seeded guidance -->\n- Plan the work.',
      sliceBody: '<!-- seeded guidance -->\n- Implement the slice.',
    });

    await expect(checkAgentArtifactCompletion({
      agentId: 'product-manager',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('accepts QA Review Outcome comment plus pass', async () => {
    writeQaArtifacts();

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(true);
  });

  it('rejects QA closeout sections that contain only comments', async () => {
    writeQaArtifacts({
      closeoutOwner: '<!-- owner guidance -->',
      finalContent: '<!-- content guidance -->',
      taskBranches: '<!-- branches guidance -->',
      difficulty: '<!-- difficulty guidance -->',
    });

    await expect(checkAgentArtifactCompletion({
      agentId: 'qa',
      handoffsDir,
      implStepsDir,
      repoRoot,
    })).resolves.toBe(false);
  });
});
