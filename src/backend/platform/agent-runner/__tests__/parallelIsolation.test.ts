import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolvePaths } from '../../core/index.js';
import { guardrailReceiptPath, writeGuardrailReceipt } from '../guardrails.js';
import { writeSessionStartReceipt } from '../sessionReceipts.js';
import { writeRuntimeWorkflowFacts } from '../runtimeFacts.js';
import { writePipelinePhase } from '../pipeline/sequencer.js';
import {
  pipelineKillSwitchPath,
  requestPipelineKill,
} from '../pipeline/runtimeControl.js';

/**
 * Cross-task isolation contract.
 *
 * Exercises every per-task runtime write seam with
 * two distinct taskIds against a shared repoRoot. Asserts each write lands
 * under `<runtimeDir>/tasks/<taskId>/` with no cross-contamination between
 * the two taskIds' state trees.
 */
describe('§2.9 parallel isolation — per-task runtime state', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'parallel-isolation-'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('writes guardrail, session, phase, lock, and facts under distinct per-task dirs for two taskIds', async () => {
    const taskAlpha = 'task-alpha';
    const taskBravo = 'task-bravo';
    const alphaPaths = resolvePaths({ repoRoot, taskId: taskAlpha });
    const bravoPaths = resolvePaths({ repoRoot, taskId: taskBravo });

    expect(alphaPaths.taskRuntime).not.toBe(bravoPaths.taskRuntime);

  // Guardrail receipt.
    const alphaGuardrail = guardrailReceiptPath(repoRoot, 'dalton', taskAlpha);
    const bravoGuardrail = guardrailReceiptPath(repoRoot, 'dalton', taskBravo);
    expect(alphaGuardrail).not.toBe(bravoGuardrail);
    await writeGuardrailReceipt(alphaGuardrail, { status: 'passed', taskId: taskAlpha });
    await writeGuardrailReceipt(bravoGuardrail, { status: 'passed', taskId: taskBravo });

  // Session receipt with per-launch suffix under per-task runtime.
    const alphaSession = await writeSessionStartReceipt({
      taskRuntime: alphaPaths.taskRuntime,
      launchId: '100-1000',
      agentId: 'dalton',
      roleName: 'Software Engineer',
      displayName: 'Dalton',
      launchPid: 1000,
    });
    const bravoSession = await writeSessionStartReceipt({
      taskRuntime: bravoPaths.taskRuntime,
      launchId: '200-2000',
      agentId: 'dalton',
      roleName: 'Software Engineer',
      displayName: 'Dalton',
      launchPid: 2000,
    });
    expect(alphaSession).not.toBe(bravoSession);

  // Pipeline phase.
    await writePipelinePhase(alphaPaths.taskRuntime, 'test-capture-started');
    await writePipelinePhase(bravoPaths.taskRuntime, 'test-capture-completed');
    const alphaPhase = path.join(alphaPaths.taskRuntime, 'pipeline-phase.json');
    const bravoPhase = path.join(bravoPaths.taskRuntime, 'pipeline-phase.json');
    expect(alphaPhase).not.toBe(bravoPhase);

  // Pipeline lock surrogate: runtimeControl kill-switch shares the
    //    per-task runtime dir; acquirePipelineLock is module-private, so we
    //    assert the observable runtime-control seam instead.
    const alphaKill = pipelineKillSwitchPath(repoRoot, taskAlpha);
    const bravoKill = pipelineKillSwitchPath(repoRoot, taskBravo);
    expect(alphaKill).not.toBe(bravoKill);
    await requestPipelineKill(repoRoot, taskAlpha, 'alpha stop');
    await requestPipelineKill(repoRoot, taskBravo, 'bravo stop');

  // Runtime workflow facts keyed on taskRuntime.
    await writeRuntimeWorkflowFacts({
      repoRoot,
      taskId: taskAlpha,
      taskRuntime: alphaPaths.taskRuntime,
      handoffsDir: alphaPaths.handoffs,
      implStepsDir: alphaPaths.implementationSteps,
    });
    await writeRuntimeWorkflowFacts({
      repoRoot,
      taskId: taskBravo,
      taskRuntime: bravoPaths.taskRuntime,
      handoffsDir: bravoPaths.handoffs,
      implStepsDir: bravoPaths.implementationSteps,
    });
    const alphaFacts = path.join(alphaPaths.taskRuntime, 'workflow-facts.json');
    const bravoFacts = path.join(bravoPaths.taskRuntime, 'workflow-facts.json');
    expect(alphaFacts).not.toBe(bravoFacts);

    // Existence assertions — every file lives under its own per-task tree.
    for (const file of [alphaGuardrail, alphaSession, alphaPhase, alphaKill, alphaFacts]) {
      expect(existsSync(file)).toBe(true);
      expect(file.startsWith(alphaPaths.taskRuntime + path.sep)).toBe(true);
      expect(file.includes(`${path.sep}tasks${path.sep}${taskBravo}${path.sep}`)).toBe(false);
    }
    for (const file of [bravoGuardrail, bravoSession, bravoPhase, bravoKill, bravoFacts]) {
      expect(existsSync(file)).toBe(true);
      expect(file.startsWith(bravoPaths.taskRuntime + path.sep)).toBe(true);
      expect(file.includes(`${path.sep}tasks${path.sep}${taskAlpha}${path.sep}`)).toBe(false);
    }

    // Content isolation — alpha's guardrail JSON must not surface in bravo's dir.
    const alphaGuardrailContent = JSON.parse(readFileSync(alphaGuardrail, 'utf-8'));
    const bravoGuardrailContent = JSON.parse(readFileSync(bravoGuardrail, 'utf-8'));
    expect(alphaGuardrailContent.taskId).toBe(taskAlpha);
    expect(bravoGuardrailContent.taskId).toBe(taskBravo);

    // Directory-level isolation — neither task's runtime tree contains the other's files.
    const alphaEntries = readdirSync(alphaPaths.taskRuntime, { recursive: true }) as string[];
    const bravoEntries = readdirSync(bravoPaths.taskRuntime, { recursive: true }) as string[];
    expect(alphaEntries.some((entry) => entry.includes(taskBravo))).toBe(false);
    expect(bravoEntries.some((entry) => entry.includes(taskAlpha))).toBe(false);
  });
});
