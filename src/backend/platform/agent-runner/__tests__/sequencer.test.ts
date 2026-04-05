import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildFleetDaltonCleanupPrompt,
  buildFleetPrompt,
  buildSimpleDaltonPrompt,
  detectWorkflowPath,
  detectParallelOk,
  getAgentOrder,
} from '../pipeline/sequencer.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'sequencer-test-'));
}

function createExternalMcpRegistry(agentIds: string[]): ExternalMcpRegistry {
  return {
    schema_version: 1,
    external_servers: [
      {
        id: 'prompt-guide',
        display_name: 'Prompt Guide',
        purpose: 'triaging implementation work',
        enabled: true,
        transport: 'http',
        url: 'http://localhost:8080/mcp',
        agent_scope: { mode: 'allowlist', agent_ids: agentIds },
      },
    ],
  };
}

describe('detectWorkflowPath', () => {
  it('always returns standard', async () => {
    const dir = makeTmpDir();
    const result = await detectWorkflowPath(dir);
    expect(result).toBe('standard');
  });
});

describe('detectParallelOk', () => {
  it('returns false when parallel-ok.md does not exist', async () => {
    const dir = makeTmpDir();
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns false when file only has comments and whitespace', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Header\n<!-- comment -->\n\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns false for the template-only file without an affirmative decision', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Parallel OK\n\nUse this file only when slice independence is real.\n\n## Task Metadata\n\n- Task ID:\n\n## Decision\n<!-- (1 word) — write "complex" or "simple" -->\n\n## Independent Slices\n<!-- placeholder -->\n\n## Constraints\n<!-- placeholder -->\n\n## Coordination Notes\n<!-- placeholder -->\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns false when the decision explicitly requires simple execution', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Parallel Authorization\n\n## Decision\n\nSimple execution required.\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns true when file has complex decision', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Parallel Authorization\n\n## Decision\n\nComplex execution authorized by Alice.\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(true);
  });
});

describe('getAgentOrder', () => {
  it('returns standard order for standard path', () => {
    const order = getAgentOrder();
    expect(order[0]).toBe('alice');
    expect(order).toEqual(['alice', 'dalton', 'ron']);
  });

  it('returns the unattended active-task order', () => {
    const order = getAgentOrder();
    expect(order).toEqual(['alice', 'dalton', 'ron']);
  });
});

describe('buildFleetPrompt', () => {
  it('throws when no slice files exist', async () => {
    const dir = makeTmpDir();
    await expect(buildFleetPrompt(dir, dir)).rejects.toThrow(
      'no slice files found in ImplementationSteps/',
    );
  });

  it('includes all slice content in the prompt', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');
    writeFileSync(path.join(dir, 'slice-2.md'), '# Slice 2\nDo the second thing.');
    const prompt = await buildFleetPrompt(
      dir,
      dir,
      'services/sink',
      createExternalMcpRegistry(['dalton']),
    );
    expect(prompt).toContain('fleet mode');
    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('"Prompt Guide" may help with triaging implementation work');
    expect(prompt).toContain('Primary focus path: `services/sink`');
    expect(prompt).toContain('Your launch CWD is already this folder.');
    expect(prompt).toContain('## Slice: slice-1');
    expect(prompt).toContain('Do the first thing.');
    expect(prompt).toContain('## Slice: slice-2');
    expect(prompt).toContain('Do the second thing.');
    expect(prompt).toContain('ensure all tests pass before exiting');
  });

  it('ignores slice-template.md', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-template.md'), 'Template content');
    writeFileSync(path.join(dir, 'slice-1.md'), 'Real slice content');
    const prompt = await buildFleetPrompt(dir, dir);
    expect(prompt).toContain('## Slice: slice-1');
    expect(prompt).not.toContain('Template content');
    expect(prompt).not.toContain('slice-template');
    expect(prompt).not.toContain('## Monolith Focus Scope');
  });
});

describe('buildFleetDaltonCleanupPrompt', () => {
  it('builds a generic cleanup prompt when QA is blocked without a Dalton artifact gap', () => {
    const prompt = buildFleetDaltonCleanupPrompt('', 'QA blocked by policy');
    expect(prompt).toContain('did not leave the workflow ready for QA');
    expect(prompt).toContain('QA blocked by policy');
    expect(prompt).toContain('Inspect the code and validation results');
  });

  it('builds a cleanup prompt when concrete Dalton artifact proof exists', () => {
    const prompt = buildFleetDaltonCleanupPrompt(
      'Address the blocker in AgentWorkSpace/handoffs/issues.md.',
      'QA blocked by policy',
      'services/sink',
      createExternalMcpRegistry(['dalton']),
    );
    expect(prompt).toContain('did not leave the workflow ready for QA');
    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('Primary focus path: `services/sink`');
    expect(prompt).toContain('Address the blocker in AgentWorkSpace/handoffs/issues.md.');
  });
});

describe('buildSimpleDaltonPrompt', () => {
  it('includes the shared monolith focus block when a primary focus path is provided', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');

    const prompt = await buildSimpleDaltonPrompt(
      dir,
      dir,
      'services/sink',
      createExternalMcpRegistry(['dalton']),
    );

    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('Primary focus path: `services/sink`');
    expect(prompt).toContain('Your launch CWD is already this folder.');
    expect(prompt).toContain('implementation changes must stay within the selected focus area.');
  });

  it('preserves no-focus prompt behavior when no primary focus path is provided', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');

    const prompt = await buildSimpleDaltonPrompt(dir, dir);

    expect(prompt).not.toContain('## Monolith Focus Scope');
    expect(prompt).toContain('Implement the changes described above.');
  });

  it('omits external MCP guidance when Dalton has no in-scope servers', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');

    const prompt = await buildSimpleDaltonPrompt(
      dir,
      dir,
      undefined,
      createExternalMcpRegistry(['ron']),
    );

    expect(prompt).not.toContain('## External MCP Guidance');
  });
});
