import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { buildRealignmentContextBundle } from '../bundle.js';

describe('buildRealignmentContextBundle', () => {
  let repoRoot: string;
  let contextPackDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'realignment-bundle-'));
    contextPackDir = path.join(repoRoot, 'contextpacks', 'pack-a');
    mkdirSync(contextPackDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('loads canonical reinforcement store, trigger task archive, recent tasks, retrospectives, GRD, and shared memory', async () => {
    seedSnapshot('qmd/custom-root');
    seedFeedbackEvents([
      feedback('FB-1', 'TASK-1', 'negative', 'trigger', '2026-01-01T00:00:00Z'),
      feedback('FB-2', 'TASK-2', 'negative', 'older negative', '2026-01-02T00:00:00Z'),
      feedback('FB-3', 'TASK-3', 'negative', 'newer negative', '2026-01-03T00:00:00Z'),
      feedback('FB-4', 'TASK-4', 'positive', 'positive', '2026-01-04T00:00:00Z'),
    ]);
    seedGlobalRealignmentDoc();
    seedSharedMemory(['old line', 'recent memory line'].join('\n'));
    seedArchiveTask('qmd/custom-root', 'TASK-1', 1);
    seedArchiveTask('qmd/custom-root', 'TASK-2', 2);
    seedArchiveTask('qmd/custom-root', 'TASK-3', 3);

    const bundle = await buildRealignmentContextBundle({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
      triggerTaskId: 'TASK-1',
      triggerFeedbackId: 'FB-1',
    });

    expect(bundle.realignmentId).toBe('RA-1');
    expect(bundle.triggerFeedback).toMatchObject({ feedbackId: 'FB-1', comment: 'trigger' });
    expect(bundle.recentNegativeFeedback.map((entry) => entry.feedbackId)).toEqual(['FB-2', 'FB-3']);
    expect(bundle.triggerTask).toMatchObject({
      taskId: 'TASK-1',
      taskTitle: 'Task 1',
      retrospectiveSummary: 'Retro summary 1',
    });
    expect(bundle.recentTasks.map((entry) => entry.taskId)).toEqual(['TASK-2', 'TASK-3']);
    expect(bundle.rollingRetrospectives.map((entry) => entry.retrospectiveSummary)).toEqual([
      'Retro summary 1',
      'Retro summary 2',
      'Retro summary 3',
    ]);
    expect(bundle.globalRealignmentDoc).toMatchObject({
      standingExpectations: ['Keep validation explicit.'],
      lessonsLearned: ['Prefer reusable guidance.'],
      version: 7,
    });
    expect(bundle.sharedRetrospectiveMemory).toContain('recent memory line');
    expect(bundle.warnings).toEqual([]);
  });

  it('supports ui-triggered feedback and warns for recoverable missing archives and GRD', async () => {
    seedManifest('qmd/manifest-root');

    const bundle = await buildRealignmentContextBundle({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-UI',
      triggerTaskId: 'MISSING-TASK',
      triggerFeedbackId: 'ui-triggered',
    });

    expect(bundle.triggerFeedback).toEqual({ trigger: 'ui-triggered' });
    expect(bundle.triggerTask).toBeNull();
    expect(bundle.sharedRetrospectiveMemory).toBe('');
    expect(bundle.warnings.join('\n')).toContain('Missing trigger task archive for MISSING-TASK.');
    expect(bundle.warnings.join('\n')).toContain('Missing global-realignment-doc.json');
  });

  it('keeps task archive fields and adds entry warning when a retrospective sidecar is absent', async () => {
    seedManifest('qmd/manifest-root');
    seedArchiveTask('qmd/manifest-root', 'TASK-1', 1, { retrospective: false });

    const bundle = await buildRealignmentContextBundle({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
      triggerTaskId: 'TASK-1',
      triggerFeedbackId: 'FB-missing',
    });

    expect(bundle.triggerTask).toMatchObject({
      taskId: 'TASK-1',
      taskTitle: 'Task 1',
      retrospectiveSummary: '',
    });
    expect(bundle.triggerTask?.warnings.join('\n')).toContain('Missing retrospective record for TASK-1.');
  });

  it('migrates legacy reinforcement store before building bundle context', async () => {
    seedManifest('qmd/manifest-root');
    const legacyFeedbackPath = path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      'reinforcement',
      'feedback-events.json',
    );
    mkdirSync(path.dirname(legacyFeedbackPath), { recursive: true });
    writeFileSync(legacyFeedbackPath, JSON.stringify({
      entries: [feedback('FB-LEGACY', 'TASK-1', 'negative', 'legacy feedback', '2026-01-01T00:00:00Z')],
    }), 'utf-8');

    const bundle = await buildRealignmentContextBundle({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
      triggerTaskId: 'TASK-1',
      triggerFeedbackId: 'FB-LEGACY',
    });

    expect(bundle.triggerFeedback).toMatchObject({ feedbackId: 'FB-LEGACY' });
    expect(bundle.triggerFeedback).toMatchObject({ comment: 'legacy feedback' });
    expect(existsSync(path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      'global',
      'reinforcement',
      'store',
      'feedback-events.json',
    ))).toBe(true);
  });

  function seedSnapshot(qmdScopeRoot: string): void {
    const snapshotPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'TASK-1', 'pack-snapshot.json');
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ qmdScopeRoot }), 'utf-8');
  }

  function seedManifest(qmdScopeRoot: string): void {
    const manifestPath = path.join(contextPackDir, 'qmd', 'repo-sources.json');
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify({ qmd_scope_root: qmdScopeRoot }), 'utf-8');
  }

  function seedFeedbackEvents(entries: Record<string, unknown>[]): void {
    const filePath = path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'reinforcement', 'store', 'feedback-events.json');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ entries }), 'utf-8');
  }

  function seedGlobalRealignmentDoc(): void {
    const filePath = path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'reinforcement', 'store', 'global-realignment-doc.json');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      standing_expectations: ['Keep validation explicit.'],
      lessons_learned: ['Prefer reusable guidance.'],
      behavioral_guidance: ['Avoid file-specific prescriptions.'],
      fairness_framing: ['Apply corrections consistently.'],
      version: 7,
    }), 'utf-8');
  }

  function seedSharedMemory(content: string): void {
    const filePath = path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'global', 'retrospectives', 'shared-retrospective-memory.md');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }

  function seedArchiveTask(
    qmdScopeRoot: string,
    taskId: string,
    ordinal: number,
    options: { retrospective?: boolean } = {},
  ): void {
    const slug = taskId.toLowerCase();
    const archivePath = path.join(contextPackDir, qmdScopeRoot, 'archive', 'tasks', '2026', `${slug}.json`);
    mkdirSync(path.dirname(archivePath), { recursive: true });
    writeFileSync(archivePath, JSON.stringify({
      task_id: taskId,
      task_title: `Task ${ordinal}`,
      task_summary: `Task summary ${ordinal}`,
      completed_work_summary: `Completed work ${ordinal}`,
      key_decisions: [`Decision ${ordinal}`],
      known_limitations: [`Limitation ${ordinal}`],
      difficulty_level: 'Medium',
      repo_name: 'repo-a',
      indexed_at: `2026-01-0${ordinal}T00:00:00Z`,
      completed_at_utc: `2026-01-0${ordinal}T01:00:00Z`,
    }), 'utf-8');

    if (options.retrospective === false) return;
    const retrospectivePath = path.join(
      contextPackDir,
      qmdScopeRoot,
      'archive',
      'retrospectives',
      'repo-a',
      '2026',
      slug,
      'retrospective.md.record.json',
    );
    mkdirSync(path.dirname(retrospectivePath), { recursive: true });
    writeFileSync(retrospectivePath, JSON.stringify({
      retrospective_summary: `Retro summary ${ordinal}`,
      what_went_well: [`Went well ${ordinal}`],
      what_could_have_gone_better: [`Could improve ${ordinal}`],
      action_items: [`Action ${ordinal}`],
    }), 'utf-8');
  }
});

function feedback(
  feedbackId: string,
  taskId: string,
  feedbackType: 'positive' | 'negative',
  comment: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    feedback_id: feedbackId,
    task_id: taskId,
    feedback_type: feedbackType,
    star_rating: feedbackType === 'negative' ? 2 : 5,
    comment,
    created_at: createdAt,
  };
}
