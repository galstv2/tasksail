import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildCycleContextBundle,
  buildRetrospectivePrompt,
  shouldRunRetrospectivePhase,
} from '../retrospectivePhase.js';

describe('retrospectivePhase', () => {
  let repoRoot: string;
  let handoffsDir: string;
  let contextPackDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'retrospective-phase-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'current-task', 'handoffs');
    contextPackDir = path.join(repoRoot, 'contextpacks', 'pack-a');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(contextPackDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it.each([
    ['missing file', undefined, false],
    ['missing label', '# Retrospective Input\n\n## Task Metadata\n\n- Task ID: current-task\n', false],
    ['false label', '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: false\n', false],
    ['true label', '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required: true\n', true],
    ['quoted true label', '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required:  "true" \n', true],
  ])('detects phase gate from %s', async (_name, content, expected) => {
    if (content !== undefined) {
      writeFileSync(path.join(handoffsDir, 'retrospective-input.md'), content, 'utf-8');
    }

    await expect(shouldRunRetrospectivePhase(handoffsDir)).resolves.toBe(expected);
  });

  it('combines nine prior counter tasks with the current task from handoff state', async () => {
    seedPrompt();
    seedCurrentHandoffs();
    seedSnapshot('qmd/custom-root');
    const priorIds = Array.from({ length: 9 }, (_, index) => `2026010${index + 1}t000000z-prior-${index + 1}`);
    seedCounter(priorIds);
    priorIds.forEach((taskId, index) => seedArchiveTask('qmd/custom-root', taskId, index + 1));

    const bundle = await buildCycleContextBundle({ repoRoot, contextPackDir, handoffsDir, currentTaskId: 'current-task' });

    expect(bundle).toHaveLength(10);
    expect(bundle.at(-1)).toMatchObject({
      taskId: 'current-task',
      taskTitle: 'Current Retrospective Task',
      completedWorkSummary: 'Delivered retrospective phase wiring',
      isCurrentTask: true,
    });
    expect(bundle[0]).toMatchObject({
      taskId: priorIds[0],
      taskTitle: 'Prior Task 1',
      retrospectiveSummary: 'Retrospective summary 1',
      whatWentWell: ['Pattern strength 1'],
    });
  });

  it('appends the current task when the counter does not contain it', async () => {
    seedCurrentHandoffs();
    seedManifest('qmd/manifest-root');
    seedCounter(['20260101t000000z-prior-1']);
    seedArchiveTask('qmd/manifest-root', '20260101t000000z-prior-1', 1);

    const bundle = await buildCycleContextBundle({ repoRoot, contextPackDir, handoffsDir, currentTaskId: 'current-task' });

    expect(bundle.map((entry) => entry.taskId)).toEqual(['20260101t000000z-prior-1', 'current-task']);
    expect(bundle.at(-1)?.isCurrentTask).toBe(true);
  });

  it('backfills prior task ids by scanning archive task records', async () => {
    seedCurrentHandoffs();
    seedManifest('qmd/scan-root');
    seedCounter([]);
    seedArchiveTask('qmd/scan-root', '20260101t000000z-scanned-1', 1);
    seedArchiveTask('qmd/scan-root', '20260102t000000z-scanned-2', 2);

    const bundle = await buildCycleContextBundle({ repoRoot, contextPackDir, handoffsDir, currentTaskId: 'current-task' });

    expect(bundle.map((entry) => entry.taskId)).toEqual([
      '20260101t000000z-scanned-1',
      '20260102t000000z-scanned-2',
      'current-task',
    ]);
  });

  it('backfills from the newest archive task records when more than nine are available', async () => {
    seedCurrentHandoffs();
    seedManifest('qmd/newest-scan-root');
    seedCounter([]);
    const archivedIds = Array.from(
      { length: 12 },
      (_, index) => `202601${String(index + 1).padStart(2, '0')}t000000z-scanned-${index + 1}`,
    );
    archivedIds.forEach((taskId, index) => seedArchiveTask('qmd/newest-scan-root', taskId, index + 1));

    const bundle = await buildCycleContextBundle({ repoRoot, contextPackDir, handoffsDir, currentTaskId: 'current-task' });

    expect(bundle.map((entry) => entry.taskId)).toEqual([
      ...archivedIds.slice(3),
      'current-task',
    ]);
  });

  it('surfaces missing prior archive data as per-entry warnings', async () => {
    seedCurrentHandoffs();
    seedManifest('qmd/missing-root');
    seedCounter(['20260101t000000z-missing']);

    const bundle = await buildCycleContextBundle({ repoRoot, contextPackDir, handoffsDir, currentTaskId: 'current-task' });

    expect(bundle[0]).toMatchObject({
      taskId: '20260101t000000z-missing',
      isCurrentTask: false,
    });
    expect(bundle[0]?.warnings.join(' ')).toContain('Missing archived task record');
  });

  it('builds retrospective prompt from provider path plus cycle context and MCP block', async () => {
    seedPrompt();
    const bundle = [
      {
        taskId: 'prior-task',
        taskTitle: 'Prior Task',
        taskSummary: 'summary',
        completedWorkSummary: 'work',
        keyDecisions: ['decision'],
        knownLimitations: ['limitation'],
        difficultyLevel: 'Medium',
        retrospectiveSummary: 'retro',
        whatWentWell: ['well'],
        whatCouldHaveGoneBetter: ['better'],
        actionItems: ['action'],
        isCurrentTask: false,
        warnings: [],
      },
    ];

    const prompt = await buildRetrospectivePrompt({
      repoRoot,
      bundle,
      externalMcpScope: {
        runtimeToProviderAgentId: (agentId: string) => (({
          lily: 'planning-agent',
          alice: 'product-manager',
          dalton: 'software-engineer',
          'dalton-verify': 'software-engineer-verify',
          ron: 'qa',
        } as Record<string, string>)[agentId] ?? agentId),
        registry: {
          schema_version: 1,
          external_servers: [
            {
              id: 'docs',
              display_name: 'Docs',
              enabled: true,
              purpose: 'reference checks',
              transport: 'http',
              url: 'https://example.invalid',
              preferred_for: ['documentation'],
              fallback_description: 'continue without it',
            },
          ],
        },
        assignments: {
          schema_version: 1,
          assignments: [{ agent_id: 'qa', external_mcp_server_ids: ['docs'] }],
        },
      },
    });

    expect(prompt).toContain('You are running in retrospective mode.');
    expect(prompt).toContain('## Cycle Context (Last 10 Tasks)');
    expect(prompt).toContain('### Task 1: prior-task');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt.split('\n\n---\n\n')).toHaveLength(3);
  });

  it('throws a clear launch-prompt error when the prompt file is missing', async () => {
    await expect(buildRetrospectivePrompt({ repoRoot, bundle: [] })).rejects.toThrow(
      'Launch prompt is missing or empty:',
    );
  });

  function seedPrompt(): void {
    const promptPath = path.join(repoRoot, '.github', 'copilot', 'prompts', 'retrospective-task.prompt.md');
    mkdirSync(path.dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, 'You are running in retrospective mode.', 'utf-8');
  }

  function seedSnapshot(qmdScopeRoot: string): void {
    const snapshotPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'current-task', 'pack-snapshot.json');
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ qmdScopeRoot }), 'utf-8');
  }

  function seedManifest(qmdScopeRoot: string): void {
    const manifestPath = path.join(contextPackDir, 'qmd', 'repo-sources.json');
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify({ qmd_scope_root: qmdScopeRoot }), 'utf-8');
  }

  function seedCounter(cycleTaskIds: string[]): void {
    const counterPath = path.join(repoRoot, '.platform-state', 'task-counters', 'pack-a.json');
    mkdirSync(path.dirname(counterPath), { recursive: true });
    writeFileSync(counterPath, JSON.stringify({ cycle_task_ids: cycleTaskIds }), 'utf-8');
  }

  function seedArchiveTask(qmdScopeRoot: string, taskId: string, ordinal: number): void {
    const slug = taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const archivePath = path.join(contextPackDir, qmdScopeRoot, 'archive', 'tasks', '2026', `${slug}.json`);
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
    mkdirSync(path.dirname(archivePath), { recursive: true });
    mkdirSync(path.dirname(retrospectivePath), { recursive: true });
    writeFileSync(archivePath, JSON.stringify({
      task_id: taskId,
      task_title: `Prior Task ${ordinal}`,
      task_summary: `Task summary ${ordinal}`,
      completed_work_summary: `Completed work ${ordinal}`,
      key_decisions: [`Decision ${ordinal}`],
      known_limitations: [`Limitation ${ordinal}`],
      difficulty_level: 'Medium',
      repo_name: 'repo-a',
      indexed_at: `2026-01-${String(ordinal).padStart(2, '0')}T00:00:00Z`,
    }), 'utf-8');
    writeFileSync(retrospectivePath, JSON.stringify({
      completed_at_utc: `2026-01-${String(ordinal).padStart(2, '0')}T00:00:00Z`,
      retrospective_summary: `Retrospective summary ${ordinal}`,
      what_went_well: [`Pattern strength ${ordinal}`],
      what_could_have_gone_better: [`Pattern gap ${ordinal}`],
      action_items: [`Pattern action ${ordinal}`],
    }), 'utf-8');
  }

  function seedCurrentHandoffs(): void {
    writeFileSync(path.join(handoffsDir, 'final-summary.md'), [
      '# Final Summary',
      '',
      '## Task Metadata',
      '',
      '- Task ID: current-task',
      '- Task Title: Current Retrospective Task',
      '',
      '## Completed Work',
      '',
      '- Delivered retrospective phase wiring',
      '',
      '## Key Design Decisions',
      '',
      '- Reuse Ron for retrospective synthesis',
      '',
      '## Known Limitations',
      '',
      '- None',
      '',
      '## Test Result Summary',
      '',
      'Focused tests passed.',
      '',
      '## Difficulty Assessment',
      '',
      '- Difficulty Level: Medium',
      '',
    ].join('\n'), 'utf-8');
    writeFileSync(path.join(handoffsDir, 'retrospective-input.md'), [
      '# Retrospective Input',
      '',
      '## Task Metadata',
      '',
      '- Retrospective Required: true',
      '- Task Title: Current Retrospective Task',
      '',
      '## Retrospective Summary',
      '',
      'Current task retrospective summary.',
      '',
      '## What Went Well',
      '',
      '## What Could Have Gone Better',
      '',
      '## Action Items',
      '',
    ].join('\n'), 'utf-8');
  }
});
