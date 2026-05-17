import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepopulateRequirementVerification } from '../pipeline/requirementVerification.js';

describe('prepopulateRequirementVerification', () => {
  let repoRoot: string;
  let handoffsDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'requirement-verification-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'task-1', 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'templates', 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n## Requirement Verification\n\n## Task branches\n',
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const readFinalSummary = async (): Promise<string> => (
    readFile(path.join(handoffsDir, 'final-summary.md'), 'utf-8')
  );

  it('renders generated IDs as pending checklist lines before Ron launch', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- VAL-001: Run lint.\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toContain('- CR-001: pending - Ron must verify before pass/advisory closeout.');
    expect(finalSummary).toContain('- VAL-001: pending - Ron must verify before pass/advisory closeout.');
  });

  it('is idempotent and does not duplicate checklist lines', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });
    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary.match(/CR-001/g)).toHaveLength(1);
  });

  it('preserves verified evidence when the ID set exactly matches', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n- done\n\n## Requirement Verification\n\n- CR-001: verified focused test passed.\n\n## Task branches\n\n[]\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    await expect(readFinalSummary()).resolves.toContain('focused test passed');
  });

  it('replaces stale or unknown IDs with the generated pending checklist', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n- done\n\n## Requirement Verification\n\n- CR-999: verified - stale.\n\n## Task branches\n\n[]\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toContain('- CR-001: pending - Ron must verify before pass/advisory closeout.');
    expect(finalSummary).not.toContain('CR-999');
    expect(finalSummary).toContain('## Completed Work');
    expect(finalSummary).toContain('## Task branches');
  });

  it('does not preserve evidence hidden in comments or fenced code', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Requirement Verification\n\n<!-- - CR-001: verified - hidden -->\n\n```text\n- CR-001: verified - hidden\n```\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toContain('- CR-001: pending - Ron must verify before pass/advisory closeout.');
  });

  it('writes None when Intake Requirements has no generated IDs', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\nNone\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    await expect(readFinalSummary()).resolves.toContain('None');
  });

  it('leaves final-summary unchanged when implementation-spec is missing', async () => {
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Requirement Verification\n\nlegacy\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    await expect(readFinalSummary()).resolves.toContain('legacy');
  });
});
