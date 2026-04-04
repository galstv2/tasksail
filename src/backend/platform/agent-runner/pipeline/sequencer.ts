import {
  resolvePaths,
  readTextFile,
  writeTextFile,
  ensureDir,
  nowIsoCompact,
  STANDARD_AGENT_ORDER,
} from '../../core/index.js';
import type { AgentId } from '../../core/index.js';
import path from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import type { PipelineOptions, PipelineReceipt } from '../types.js';
import { runRoleAgent } from '../roleAgent.js';
import { runRuntimePolicyCheck } from '../guardrails.js';
import { buildAgentArtifactRemediationPrompt, detectParallelOk, listSliceFiles } from '../artifactCompletion.js';
import { prewarmPipelineContext } from './contextPrewarm.js';
import { remediationHasBlockingFindings, remediationRunQaLoop, remediationClearCloseoutArtifacts } from './remediation.js';
import { resolveVerificationDaltonPrompt } from './verificationPass.js';
import {
  captureSliceValidation,
  buildTestCapturePrompt,
  resolveTestCaptureCwdFromFocused,
  type TestCaptureResult,
} from './testCapture.js';
import { appendFocusBlock } from './monolithFocusPrompt.js';
import { moveFailedItemToErrorItems } from '../../queue/errorItems.js';
import { completePendingItem } from '../../queue/completePendingItem.js';
import {
  clearPipelineKill,
  pipelineKillSwitchExists,
  readPipelineKillRequest,
} from './runtimeControl.js';
import { resolveSelectedPrimaryRepoRoot } from '../../context-pack/focusedRepo.js';

interface PipelineLock {
  release: () => Promise<void>;
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withInternalOrchestratorEnv<T>(
  orchestratorId: 'pipeline-sequencer',
  action: () => Promise<T>,
): Promise<T> {
  const previousAllowBypass = process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
  const previousOrchestratorId = process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];

  process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = 'true';
  process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = orchestratorId;

  try {
    return await action();
  } finally {
    if (previousAllowBypass === undefined) {
      delete process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'];
    } else {
      process.env['RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS'] = previousAllowBypass;
    }

    if (previousOrchestratorId === undefined) {
      delete process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'];
    } else {
      process.env['RUN_ROLE_AGENT_ORCHESTRATOR_ID'] = previousOrchestratorId;
    }
  }
}

function startKillSwitchMonitor(
  repoRoot: string,
  abortController: AbortController,
): () => void {
  const timer = setInterval(() => {
    if (pipelineKillSwitchExists(repoRoot) && !abortController.signal.aborted) {
      abortController.abort();
    }
  }, 250);
  return () => clearInterval(timer);
}

function ensurePipelineNotKilled(
  repoRoot: string,
  abortController: AbortController,
): void {
  if (pipelineKillSwitchExists(repoRoot) && !abortController.signal.aborted) {
    abortController.abort();
  }
  if (abortController.signal.aborted) {
    throw new Error('Pipeline kill requested.');
  }
}

function extractPolicyFailureDetails(
  policyResult: { stdout: string; stderr: string },
): string {
  const stderr = policyResult.stderr.trim();
  if (stderr) {
    return stderr;
  }
  return policyResult.stdout.trim();
}

export function buildFleetDaltonCleanupPrompt(
  artifactPrompt: string,
  policyDetails: string,
  primaryFocusRelativePath?: string,
): string {
  const sections = [
    'Your previous Dalton fleet run did not leave the workflow ready for QA.',
    '',
  ];
  appendFocusBlock(sections, primaryFocusRelativePath);
  sections.push(`Blocking workflow-policy details: ${policyDetails}`, '');
  if (artifactPrompt.trim()) {
    sections.push(artifactPrompt, '');
  } else {
    sections.push(
      'Inspect the code and validation results, fix only what is still preventing QA handoff, and ensure all tests pass.',
      '',
    );
  }
  sections.push('Ensure all tests pass.');
  return sections.join('\n');
}

export async function readImplSpec(handoffsDir: string): Promise<string | undefined> {
  return readTextFile(path.join(handoffsDir, 'implementation-spec.md'));
}

/**
 * Read all slices from implStepsDir and format them as markdown sections.
 * Used by fleet, simple, and remediation prompt builders.
 */
export async function formatSliceSections(
  implStepsDir: string,
  headingLevel: '##' | '###' = '##',
): Promise<{ files: string[]; formatted: string }> {
  const sliceFiles = await listSliceFiles(implStepsDir);
  if (sliceFiles.length === 0) {
    return { files: [], formatted: '' };
  }
  const sliceContents = await Promise.all(sliceFiles.map((f) => readTextFile(f)));
  const parts: string[] = [];
  for (let i = 0; i < sliceFiles.length; i++) {
    const sliceId = path.basename(sliceFiles[i], '.md');
    parts.push(`${headingLevel} Slice: ${sliceId}`);
    parts.push('');
    if (sliceContents[i]?.trim()) {
      parts.push(sliceContents[i]!.trim());
    }
    parts.push('');
  }
  return { files: sliceFiles, formatted: parts.join('\n') };
}

export async function buildFleetPrompt(
  implStepsDir: string,
  handoffsDir: string,
  primaryFocusRelativePath?: string,
): Promise<string> {
  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir);
  if (sliceFiles.length === 0) {
    throw new Error('Fleet mode triggered but no slice files found in ImplementationSteps/');
  }

  const parts: string[] = [
    'You are running in fleet mode. Multiple implementation slices are available.',
    'You have full discretion on how to organize your work across subagents.',
    'Analyze the slices below, identify dependencies, and decide which slices can',
    'run in parallel vs. which must be sequential.',
    '',
  ];
  appendFocusBlock(parts, primaryFocusRelativePath);

  const implSpec = await readImplSpec(handoffsDir);
  if (implSpec?.trim()) {
    parts.push('## Implementation Spec\n');
    parts.push(implSpec.trim());
    parts.push('');
  }

  parts.push(`Total slices: ${sliceFiles.length}`);
  parts.push('');
  parts.push(sliceBlock);

  parts.push(
    'After implementation, ensure all tests pass before exiting.',
  );

  return parts.join('\n');
}

export async function buildSimpleDaltonPrompt(
  implStepsDir: string,
  handoffsDir: string,
  primaryFocusRelativePath?: string,
): Promise<string> {
  const { files: sliceFiles, formatted: sliceBlock } = await formatSliceSections(implStepsDir, '###');

  const implSpec = await readImplSpec(handoffsDir);

  const parts: string[] = [];
  appendFocusBlock(parts, primaryFocusRelativePath);

  if (implSpec?.trim()) {
    parts.push('## Implementation Spec\n');
    parts.push(implSpec.trim());
    parts.push('');
  }

  if (sliceFiles.length > 0) {
    parts.push(`## Implementation Slices (${sliceFiles.length} total)\n`);
    parts.push(sliceBlock);
  }

  parts.push('Implement the changes described above. Ensure all tests pass before exiting.');

  return parts.join('\n');
}

async function removeSliceTemplateIfPresent(
  implementationStepsDir: string,
): Promise<void> {
  await rm(path.join(implementationStepsDir, 'slice-template.md'), { force: true });
}

async function writePipelineReceipt(
  repoRoot: string,
  receipt: PipelineReceipt,
): Promise<void> {
  const receiptDir = path.join(repoRoot, '.platform-state', 'runtime');
  await ensureDir(receiptDir);
  await writeTextFile(
    path.join(receiptDir, 'pipeline-receipt.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
}

async function writePipelinePhase(
  repoRoot: string,
  phase: string,
): Promise<void> {
  const phaseFile = path.join(repoRoot, '.platform-state', 'runtime', 'pipeline-phase.json');
  await writeTextFile(
    phaseFile,
    JSON.stringify({ phase, timestamp: nowIsoCompact() }) + '\n',
  );
}

async function handlePipelineFailure(
  repoRoot: string,
  contextPackDir?: string,
): Promise<void> {
  try {
    await moveFailedItemToErrorItems({
      repoRoot,
      contextPackDir: contextPackDir || process.env['ACTIVE_CONTEXT_PACK_DIR'] || undefined,
    });
  } catch (err) {
    process.stderr.write(
      `Warning: failed to move item to erroritems/: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

async function acquirePipelineLock(repoRoot: string): Promise<PipelineLock> {
  const runtimeDir = path.join(repoRoot, '.platform-state', 'runtime');
  const lockDir = path.join(runtimeDir, 'pipeline.lock');
  const ownerPath = path.join(lockDir, 'owner.json');
  await ensureDir(runtimeDir);

  try {
    await mkdir(lockDir);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      let ownerSummary = 'unknown owner';
      try {
        const ownerRaw = await readFile(ownerPath, 'utf-8');
        ownerSummary = ownerRaw.trim();
      } catch {
        // Keep the lock contention error deterministic even if the owner file is missing.
      }
      throw new Error(
        `Another pipeline run is already active for repo ${repoRoot}. Lock: ${lockDir}. Owner: ${ownerSummary}`,
      );
    }
    throw err;
  }

  await writeTextFile(
    ownerPath,
    JSON.stringify({
      pid: process.pid,
      started_at: new Date().toISOString(),
    }, null, 2) + '\n',
  );

  return {
    release: async () => {
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

/**
 * Read the task-bound context pack dir from the sidecar file written at
 * activation time. Checks the canonical queue state path first, then falls
 * back to workspace-context-sync.json. Returns undefined for legacy tasks
 * or when no sidecar exists.
 */
async function resolveTaskBoundContextPackDir(
  repoRoot: string,
): Promise<string | undefined> {
  // Primary: canonical queue state sidecar (written by activateNextPendingItemIfReady)
  try {
    const raw = await readFile(
      path.join(repoRoot, '.platform-state', 'queue', 'active-context-pack.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dir = typeof parsed.contextPackDir === 'string' ? parsed.contextPackDir.trim() : '';
    if (dir) return dir;
  } catch { /* absent for legacy tasks — fall through */ }

  // Fallback: workspace-context-sync.json (written by context pack activation UI)
  try {
    const raw = await readFile(
      path.join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dir = typeof parsed.active_context_pack_dir === 'string'
      ? parsed.active_context_pack_dir.trim()
      : '';
    if (dir) return dir;
  } catch { /* absent or unreadable — fall through */ }

  return undefined;
}

/** Fast path is retired, so workflow routing always resolves to standard. */
export async function detectWorkflowPath(
  _handoffsDir: string,
): Promise<'standard'> {
  return 'standard';
}

export { detectParallelOk } from '../artifactCompletion.js';

/**
 * Get the agent order for a given workflow path.
 */
export function getAgentOrder(): AgentId[] {
  return [...STANDARD_AGENT_ORDER];
}

function selectAgentOrder(options: PipelineOptions): AgentId[] {
  const fullOrder = getAgentOrder();
  const startIndex = options.startAt ? fullOrder.indexOf(options.startAt) : 0;
  const stopIndex = options.stopAfter ? fullOrder.indexOf(options.stopAfter) : fullOrder.length - 1;

  if (startIndex < 0) {
    throw new Error(`Unknown startAt agent: ${options.startAt}`);
  }
  if (stopIndex < 0) {
    throw new Error(`Unknown stopAfter agent: ${options.stopAfter}`);
  }
  if (startIndex > stopIndex) {
    throw new Error(
      `Pipeline stopAfter (${options.stopAfter}) cannot precede startAt (${options.startAt}).`,
    );
  }

  return fullOrder.slice(startIndex, stopIndex + 1);
}

/**
 * Run the full pipeline sequence: iterate agents in workflow order,
 * handle optional parallel daltons, and the QA remediation loop.
 */
export async function runPipelineSequence(
  options: PipelineOptions = {},
): Promise<PipelineReceipt> {
  const paths = resolvePaths(options.repoRoot);
  const lock = await acquirePipelineLock(paths.repoRoot);
  const pipelineStart = Date.now();
  const abortController = new AbortController();
  const stopKillMonitor = startKillSwitchMonitor(paths.repoRoot, abortController);
  let workflowPath: 'standard' = 'standard';
  let prewarmSeconds = 0;
  const agentTimings: Record<string, number> = {};

  // Resolve the task-bound context pack before the try block so the catch
  // handler can pass it to handlePipelineFailure on error.
  const taskBoundContextPackDir = await resolveTaskBoundContextPackDir(
    paths.repoRoot,
  );
  const effectiveContextPackDir =
    taskBoundContextPackDir || process.env['ACTIVE_CONTEXT_PACK_DIR'] || undefined;

  try {
    return await withInternalOrchestratorEnv('pipeline-sequencer', async () => {
      ensurePipelineNotKilled(paths.repoRoot, abortController);
      workflowPath = await detectWorkflowPath(paths.handoffs);
      const agentOrder = selectAgentOrder(options);

      const prewarmStart = Date.now();
      await prewarmPipelineContext(
        agentOrder,
        effectiveContextPackDir,
        paths.repoRoot,
      );
      prewarmSeconds = Math.round((Date.now() - prewarmStart) / 1000);

      const maxRemediationCycles = 3;

      let isFirstAgent = true;
      let skipNextEntryValidation = false;
      let testCaptureResults: TestCaptureResult[] = [];
      const selectedPrimary = effectiveContextPackDir
        ? await resolveSelectedPrimaryRepoRoot(effectiveContextPackDir, paths.repoRoot)
        : undefined;
      const primaryFocusRelativePath = selectedPrimary?.primaryFocusRelativePath;
      const testCaptureCwd = effectiveContextPackDir
        ? resolveTestCaptureCwdFromFocused(selectedPrimary)
        : paths.repoRoot;

      // Shared post-Dalton logic: optional verification pass then test capture.
      let daltonRemediationActive = false;
      const runPostDaltonPasses = async (): Promise<TestCaptureResult[]> => {
        if (!daltonRemediationActive) {
          const verificationPrompt = await resolveVerificationDaltonPrompt(
            paths.handoffs,
            paths.implementationSteps,
            primaryFocusRelativePath,
          );
          if (verificationPrompt) {
            console.log('[pipeline] Launching Dalton verification pass.');
            const verifyStart = Date.now();
            await runRoleAgent({
              agentId: 'dalton',
              skipWorkflowValidation: true,
              contextPackDir: effectiveContextPackDir,
              abortSignal: abortController.signal,
              promptOverride: verificationPrompt,
              launchPhase: 'Verification',
            });
            agentTimings['dalton-verify'] = Math.round((Date.now() - verifyStart) / 1000);
          }
        }
        if (testCaptureCwd) {
          await writePipelinePhase(paths.repoRoot, 'test-capture-started');
          const results = await captureSliceValidation(paths.implementationSteps, testCaptureCwd);
          await writePipelinePhase(paths.repoRoot, 'test-capture-completed');
          return results;
        }
        console.warn('[pipeline] target repo resolution failed; skipping test capture.');
        return [];
      };

      for (let index = 0; index < agentOrder.length; index++) {
        ensurePipelineNotKilled(paths.repoRoot, abortController);
        const agentId = agentOrder[index];
        const agentStart = Date.now();

        if (agentId === 'dalton') {
          daltonRemediationActive = false;
          await removeSliceTemplateIfPresent(paths.implementationSteps);
          daltonRemediationActive = await remediationHasBlockingFindings(paths.handoffs);
          const isComplex = daltonRemediationActive
            ? false
            : await detectParallelOk(paths.handoffs);

          if (isComplex) {
            const fleetPrompt = await buildFleetPrompt(
              paths.implementationSteps,
              paths.handoffs,
              primaryFocusRelativePath,
            );
            await runRoleAgent({
              agentId: 'dalton',
              skipWorkflowValidation: false,
              contextPackDir: effectiveContextPackDir,
              abortSignal: abortController.signal,
              promptOverride: fleetPrompt,
            });
            agentTimings['dalton'] = Math.round((Date.now() - agentStart) / 1000);

            const qaPolicy = await runRuntimePolicyCheck(paths.repoRoot, 'ron');
            if (qaPolicy.exitCode !== 0) {
              const artifactPrompt = await buildAgentArtifactRemediationPrompt({
                agentId: 'software-engineer',
                handoffsDir: paths.handoffs,
                implStepsDir: paths.implementationSteps,
                repoRoot: paths.repoRoot,
                abortSignal: abortController.signal,
              });
              const policyDetails = extractPolicyFailureDetails(qaPolicy);
              const cleanupPrompt = buildFleetDaltonCleanupPrompt(
                artifactPrompt,
                policyDetails,
                primaryFocusRelativePath,
              );
              await runRoleAgent({
                agentId: 'dalton',
                skipWorkflowValidation: true,
                contextPackDir: effectiveContextPackDir,
                abortSignal: abortController.signal,
                promptOverride: cleanupPrompt,
              });
            }

            testCaptureResults = await runPostDaltonPasses();
            skipNextEntryValidation = true;
            isFirstAgent = false;
            if (options.stopAfter === 'dalton') break;
            continue;
          }
        }

        const skipWorkflowValidation = isFirstAgent || skipNextEntryValidation;

        let agentPromptOverride: string | undefined;
        if (agentId === 'dalton') {
          agentPromptOverride = await buildSimpleDaltonPrompt(
            paths.implementationSteps,
            paths.handoffs,
            primaryFocusRelativePath,
          );
        } else if (agentId === 'ron') {
          agentPromptOverride = buildTestCapturePrompt(
            testCaptureResults,
            primaryFocusRelativePath,
          );
        }

        await runRoleAgent({
          agentId,
          skipWorkflowValidation,
          contextPackDir: effectiveContextPackDir,
          abortSignal: abortController.signal,
          promptOverride: agentPromptOverride,
        });
        skipNextEntryValidation = agentId === 'alice' || agentId === 'dalton';
        isFirstAgent = false;

        const agentEnd = Date.now();
        agentTimings[agentId] = Math.round((agentEnd - agentStart) / 1000);

        if (agentId === 'dalton') {
          testCaptureResults = await runPostDaltonPasses();
        }

        if (agentId === 'ron') {
          const hasFindings = await remediationHasBlockingFindings(paths.handoffs);
          if (hasFindings) {
            await remediationClearCloseoutArtifacts(paths.handoffs, paths.templates);
            await remediationRunQaLoop({
              maxCycles: maxRemediationCycles,
              repoRoot: paths.repoRoot,
              contextPackDir: effectiveContextPackDir,
              primaryFocusRelativePath,
            });
          }
        }

        if (options.stopAfter && agentId === options.stopAfter) {
          break;
        }
      }

      const totalSeconds = Math.round((Date.now() - pipelineStart) / 1000);

      const receipt: PipelineReceipt = {
        status: 'completed',
        workflowPath,
        totalSeconds,
        prewarmSeconds,
        agentTimings,
      };

      await writePipelineReceipt(paths.repoRoot, receipt);

      try {
        await completePendingItem({ repoRoot: paths.repoRoot });
      } catch (err) {
        console.warn('[pipeline] Post-pipeline closeout failed:', err instanceof Error ? err.message : err);
      }

      return receipt;
    });
  } catch (err) {
    const killRequest = await readPipelineKillRequest(paths.repoRoot);
    const killed = abortController.signal.aborted || killRequest !== undefined;
    const failureReason = killed
      ? `Pipeline killed: ${killRequest?.reason ?? 'operator-request'}`
      : formatErrorMessage(err);
    const failureStatus: PipelineReceipt['status'] = killed ? 'killed' : 'failed';
    const failureReceipt: PipelineReceipt = {
      status: failureStatus,
      workflowPath,
      totalSeconds: Math.round((Date.now() - pipelineStart) / 1000),
      prewarmSeconds,
      agentTimings,
      failureReason,
    };

    await writePipelineReceipt(paths.repoRoot, failureReceipt);
    await handlePipelineFailure(paths.repoRoot, effectiveContextPackDir);

    if (killed) {
      throw new Error(failureReason);
    }
    throw err;
  } finally {
    stopKillMonitor();
    await clearPipelineKill(paths.repoRoot);
    await lock.release();
  }
}
