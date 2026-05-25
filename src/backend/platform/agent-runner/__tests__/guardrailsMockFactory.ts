import { vi } from 'vitest';

/**
 * Mock module shape for `../guardrails.js` shared by roleAgent-family tests.
 *
 * The default `writeUniqueGuardrailReceipt` mock delegates to the
 * `guardrailReceiptPath` and `writeGuardrailReceipt` mocks so existing
 * receipt-path assertions still observe a single derivable path per call.
 */
export function createGuardrailsMockModule(): Record<string, unknown> {
  const guardrailReceiptPath = vi.fn();
  const writeGuardrailReceipt = vi.fn();
  return {
    runRuntimePolicyCheck: vi.fn(),
    guardrailReceiptPath,
    writeGuardrailReceipt,
    writeUniqueGuardrailReceipt: vi.fn(async (options: {
      repoRoot: string;
      agentId: string;
      taskId: string;
      data: Record<string, unknown>;
      launchId?: string;
      launchPhase?: string;
    }) => {
      const receiptPath = guardrailReceiptPath(options.repoRoot, options.agentId, options.taskId);
      await writeGuardrailReceipt(receiptPath, {
        ...options.data,
        ...(options.launchId !== undefined ? { launch_id: options.launchId } : {}),
        ...(options.launchPhase !== undefined ? { launch_phase: options.launchPhase } : {}),
      });
      return receiptPath;
    }),
  };
}
