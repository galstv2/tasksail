import { readImplSpec } from './sequencer.js';
import { collectSliceValidationCommands } from './testCapture.js';
import { appendFocusBlock } from './monolithFocusPrompt.js';

/**
 * Build the prompt for the verification Dalton pass.
 *
 * Verification Dalton assumes the previous engineer made mistakes and
 * validates everything from scratch: build, test, acceptance criteria.
 * He receives the implementation spec AND the slice validation commands
 * so he has concrete steps to execute.
 */
export function buildVerificationDaltonPrompt(
  implSpecContent: string,
  validationCommands: string[],
  primaryFocusRelativePath?: string,
): string {
  const parts: string[] = [
    'You are running a verification pass. Another engineer just completed implementation',
    'work in this repository. Do NOT trust their work. Assume they made mistakes.',
    '',
    '## Your Mandatory Steps (in this exact order)',
    '',
    '1. **Build the project first.** Run the build command. If it fails, fix the build errors before doing anything else.',
    '2. **Run every test.** Run the full test suite. If tests fail, fix them.',
    '3. **Run every validation command listed below.** If any command fails, fix the issue.',
    '4. **Review the code against the implementation spec.** Check that every acceptance criterion is actually met — not just that the file exists, but that the logic is correct and complete.',
    '5. **Verify endpoints and runtime behavior** if the spec requires a running service. Start it, hit the endpoints, confirm they respond correctly.',
    '6. **Fix everything you find.** Do not just report issues — fix them.',
    '',
    'Do NOT skip any step. Do NOT assume anything works until you have personally run it and seen it succeed.',
    'Do NOT exit until the build passes, all tests pass, and all validation commands succeed.',
    '',
  ];
  appendFocusBlock(parts, primaryFocusRelativePath);

  if (validationCommands.length > 0) {
    parts.push('## Validation Commands (run all of these)\n');
    parts.push('```');
    parts.push(validationCommands.join('\n'));
    parts.push('```');
    parts.push('');
  }

  if (implSpecContent.trim()) {
    parts.push('## Implementation Spec\n');
    parts.push(implSpecContent.trim());
  }

  return parts.join('\n');
}

/**
 * Read the implementation spec and slice validation commands, then build
 * the verification prompt. Returns undefined if the implementation spec
 * is missing or empty.
 */
export async function resolveVerificationDaltonPrompt(
  handoffsDir: string,
  implStepsDir: string,
  primaryFocusRelativePath?: string,
): Promise<string | undefined> {
  const [content, commands] = await Promise.all([
    readImplSpec(handoffsDir),
    collectSliceValidationCommands(implStepsDir).catch(() => [] as string[]),
  ]);
  if (!content?.trim()) {
    return undefined;
  }
  return buildVerificationDaltonPrompt(content, commands, primaryFocusRelativePath);
}
