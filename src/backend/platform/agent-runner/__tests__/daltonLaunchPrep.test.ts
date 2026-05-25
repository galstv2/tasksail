import { describe, expect, it } from 'vitest';
import { buildArtifactCleanupPrompt } from '../daltonLaunchPrep.js';

describe('buildArtifactCleanupPrompt', () => {
  it('renders exact-path cleanup guardrails and supplied forbidden tokens', () => {
    const prompt = buildArtifactCleanupPrompt({
      artifactPrompt: '- /repo/AgentWorkSpace/tasks/t1/handoffs/parallel-ok.md: fill Decision.',
      policyFailureDetails: 'parallel-ok decision missing',
      forbiddenPathTokens: ['$CUSTOM_HANDOFFS_DIR', '$CUSTOM_IMPL_STEPS_DIR', 'AgentWorkSpace/tasks/active'],
    });

    expect(prompt).toContain('Your previous run did not leave the workflow ready for the next role.');
    expect(prompt).toContain('Blocking workflow-policy details: parallel-ok decision missing');
    expect(prompt).toContain('Use only the exact absolute artifact paths listed below.');
    expect(prompt).toContain('- $CUSTOM_HANDOFFS_DIR');
    expect(prompt).toContain('- $CUSTOM_IMPL_STEPS_DIR');
    expect(prompt).toContain('- AgentWorkSpace/tasks/active');
    expect(prompt).toContain('Do not use shell commands to create workflow artifact directories');
    expect(prompt).toContain('If a write fails, report the exact listed path and the failure');
    expect(prompt).toContain('/repo/AgentWorkSpace/tasks/t1/handoffs/parallel-ok.md');
    expect(prompt).not.toContain('$COPILOT_HANDOFFS_DIR');
  });
});
