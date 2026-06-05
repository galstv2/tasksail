import path from 'node:path';
import { readTextFile, safeJsonParse } from '../core/index.js';

/**
 * Single source of truth for "did the Software Engineer (Dalton) produce passing
 * remediation evidence for this task?" Reads the first guardrail receipt
 * (`guardrails/software-engineer.json`, the authoritative completion signal) and
 * accepts only an explicit pass / internal-bypass status.
 *
 * Both the remediation-loop guardrail (`rules/transition.ts`) and the runtime
 * facts computation (`runtimeInference.ts`) call this so the two can never
 * diverge. The earlier `role-sessions/software-engineer.json` fallback was
 * removed: session receipts are written `software-engineer-<launchId>.json`
 * (suffixed), so the bare-name read never matched — it was dead code carrying a
 * latent truthy-status bug where any terminal status (including `failed`/
 * `cancelled`) counted as completion.
 */
export async function softwareEngineerGuardrailPassed(taskRuntime: string): Promise<boolean> {
  const guardrailPath = path.join(taskRuntime, 'guardrails', 'software-engineer.json');
  const receiptText = await readTextFile(guardrailPath);
  if (receiptText === undefined) {
    return false;
  }
  try {
    const receipt = safeJsonParse<Record<string, unknown>>(receiptText, guardrailPath);
    const status = typeof receipt?.status === 'string' ? receipt.status : '';
    return status === 'passed' || status === 'internal-bypass';
  } catch {
    return false;
  }
}
