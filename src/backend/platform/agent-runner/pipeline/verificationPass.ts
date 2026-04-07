import { collectSliceValidationCommands } from './testCapture.js';
import { appendFocusBlock } from './monolithFocusPrompt.js';
import { appendMcpContextBlock } from './mcpPromptContext.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

/**
 * Build the prompt for the verification Dalton pass.
 *
 * Verification Dalton is an adversarial code-quality reviewer. He receives
 * NO task context — no implementation spec, no slice acceptance criteria,
 * no task description. He reviews the code like a senior engineer doing a
 * blind PR review: build it, test it, read it, and flag anything that isn't
 * clean, correct, or trustworthy.
 *
 * Acceptance-criteria verification is Ron's job, not verification Dalton's.
 */
export function buildVerificationDaltonPrompt(
  validationCommands: string[],
  primaryFocusRelativePath?: string,
  externalMcpRegistry?: ExternalMcpRegistry,
  verificationDiffAbsolutePath?: string,
  verificationDiffWarning?: string,
): string {
  const parts: string[] = [
    'You are running a code quality verification pass. Another engineer just',
    'completed work in this repository. Do NOT trust their work. Assume they',
    'cut corners.',
    '',
    'You have NO context about what the task was. You do not need it. Review',
    'the code the same way you would review a PR from an untrusted contributor:',
    'build it, test it, read it, and judge it on its own merits.',
    '',
    '## Your Mandatory Steps (in this exact order)',
    '',
    '1. **Build the project.** Run the build command. If it fails, fix the build errors.',
    '2. **Run the full test suite.** If any tests fail, fix them.',
    '3. **Run every validation command listed below.** If any command fails, fix the issue.',
    '4. **Read the changed code.** Start from the staged verification diff file',
    '   at the absolute path provided below, then open and inspect the referenced',
    '   repo files directly. For each file:',
    '   - Is the code clean, readable, and well-structured?',
    '   - Are variable and function names clear and consistent with the codebase?',
    '   - Is error handling present and correct?',
    '   - Is there dead code, duplication, or unnecessary complexity?',
    '   - Do the tests actually test what their names claim? A test called',
    '     "rejects invalid input" must actually test invalid input, not a happy path.',
    '   - Are there obvious bugs — off-by-one errors, unclosed resources, missing',
    '     null checks, race conditions?',
    '   - Are there obvious performance problems in the changed code — unnecessary',
    '     nested scans, repeated full-list passes in hot paths, avoidable N+1 work,',
    '     or data structures that make the algorithm asymptotically worse than needed?',
    '5. **Fix broken builds, failing tests, and obvious bugs.** These are objective',
    '   problems — fix them directly.',
    '6. **Do NOT fix style preferences or refactor working code.** If the code works,',
    '   tests pass, and there are no bugs, leave it alone. Quality observations that',
    '   are not bugs should not be acted on — QA will review them separately.',
    '',
    'Do NOT skip any step. Do NOT assume anything works until you have personally',
    'run it and seen it succeed. Do NOT exit until the build passes and all tests',
    'and validation commands succeed.',
    '',
  ];
  appendFocusBlock(parts, primaryFocusRelativePath);
  appendMcpContextBlock(parts, externalMcpRegistry, 'dalton-verify');

  if (verificationDiffAbsolutePath || verificationDiffWarning) {
    parts.push('## Verification Diff File\n');
    if (verificationDiffAbsolutePath) {
      parts.push('Read the staged verification diff file at this absolute path before browsing outward:\n');
      parts.push(`- \`${verificationDiffAbsolutePath}\``);
      parts.push('');
      parts.push('This file was staged by the orchestrator for this verification pass.');
      parts.push('If the file contains `# No git diff available. Skip this file and scope your review to the files listed in the assigned slice.`, treat that as an empty-diff sentinel and fall back to the slice-listed files.');
    }
    if (verificationDiffWarning) {
      parts.push('');
      parts.push(`Warning: ${verificationDiffWarning}`);
      parts.push('If the staged diff file is unavailable or incomplete, inspect the changed repo files manually.');
    }
    parts.push('');
  }

  if (validationCommands.length > 0) {
    parts.push('## Validation Commands\n');
    parts.push('Run each of these and confirm they pass:\n');
    parts.push('```');
    parts.push(validationCommands.join('\n'));
    parts.push('```');
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Collect slice validation commands and build the verification prompt.
 * Returns undefined if no validation commands are found (nothing to verify).
 */
export async function resolveVerificationDaltonPrompt(
  _handoffsDir: string,
  implStepsDir: string,
  primaryFocusRelativePath?: string,
  externalMcpRegistry?: ExternalMcpRegistry,
  verificationDiffAbsolutePath?: string,
  verificationDiffWarning?: string,
): Promise<string | undefined> {
  const commands = await collectSliceValidationCommands(implStepsDir)
    .catch(() => [] as string[]);
  if (commands.length === 0) {
    return undefined;
  }
  return buildVerificationDaltonPrompt(
    commands,
    primaryFocusRelativePath,
    externalMcpRegistry,
    verificationDiffAbsolutePath,
    verificationDiffWarning,
  );
}
