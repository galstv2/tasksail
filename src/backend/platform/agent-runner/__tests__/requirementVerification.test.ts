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
    expect(finalSummary).toMatch(/## Closeout Owner Agent ID\s+qa/);
    expect(finalSummary).toContain('<!-- You need to populate the CR-001 line below by changing pending to verified or advisory and adding concise evidence.');
    expect(finalSummary).toContain('- CR-001: pending');
    expect(finalSummary).toContain('<!-- You need to populate the VAL-001 line below by changing pending to verified or advisory and adding concise evidence.');
    expect(finalSummary).toContain('- VAL-001: pending');
  });

  it('stamps Closeout Owner Agent ID even when implementation-spec is missing', async () => {
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Closeout Owner Agent ID\n\nalice\n\n## Requirement Verification\n\nlegacy\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toMatch(/## Closeout Owner Agent ID\s+qa/);
    expect(finalSummary).toContain('legacy');
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
    expect(finalSummary.match(/^- CR-001:/gm)).toHaveLength(1);
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

  it('preserves verified evidence when status lines use dash separators', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n- VAL-001: Run tests.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n- done\n\n## Requirement Verification\n\n- CR-001 — verified — focused test passed.\n- VAL-001 - advisory - broad suite follow-up.\n\n## Task branches\n\n[]\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toContain('focused test passed');
    expect(finalSummary).toContain('broad suite follow-up');
    expect(finalSummary).not.toContain('pending');
  });

  it('preserves verified evidence when status is natural prose after the generated ID', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n- VAL-001: Run tests.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n- done\n\n## Requirement Verification\n\nCR-001 is verified because focused tests passed.\nVAL-001 is advisory because broad validation remains a follow-up.\n\n## Task branches\n\n[]\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toContain('CR-001 is verified');
    expect(finalSummary).toContain('VAL-001 is advisory');
    expect(finalSummary).not.toContain('pending');
  });

  it('does not let later evidence prose override the first status after the ID', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n- done\n\n## Requirement Verification\n\nCR-001 is pending until the previously verified evidence is rechecked.\n\n## Task branches\n\n[]\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    const finalSummary = await readFinalSummary();
    expect(finalSummary).toContain('- CR-001: pending');
    expect(finalSummary).not.toContain('previously verified evidence');
  });

  it('preserves verified evidence when status is joined to an em dash', async () => {
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      '# Implementation Spec\n\n## Intake Requirements\n\n- CR-001: Preserve behavior.\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Completed Work\n\n- done\n\n## Requirement Verification\n\n- CR-001 — verified—focused test passed.\n\n## Task branches\n\n[]\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    await expect(readFinalSummary()).resolves.toContain('verified—focused test passed');
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
    expect(finalSummary).toContain('- CR-001: pending');
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
    expect(finalSummary).toContain('- CR-001: pending');
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

  it('leaves Requirement Verification unchanged when implementation-spec is missing', async () => {
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Final Summary\n\n## Closeout Owner Agent ID\n\nqa\n\n## Requirement Verification\n\nlegacy\n',
      'utf-8',
    );

    await prepopulateRequirementVerification({ handoffsDir, repoRoot });

    await expect(readFinalSummary()).resolves.toContain('legacy');
  });
});
