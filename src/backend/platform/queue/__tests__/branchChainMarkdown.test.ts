import { describe, expect, it } from 'vitest';
import {
  extractBranchChainBinding,
  extractContextPackBinding,
  formatBranchChainSection,
  formatContextPackBindingSection,
  type TaskBranchChainBinding,
} from '../markdown.js';

const binding: TaskBranchChainBinding = {
  schemaVersion: 1,
  mode: 'continuation',
  rootTaskId: '20260517t084211z-platform',
  parentTaskId: '20260518t091500z-platform-followup',
  depth: 2,
  repos: [
    {
      repoRoot: '/repo/tools',
      repoLabel: 'tools',
      chainSourceBranch: 'task/20260517t084211z-platform',
      parentSourceBranch: 'task/20260518t091500z-platform-followup',
      parentBranchHead: '0123456789abcdef0123456789abcdef01234567',
      targetBranch: 'main',
    },
  ],
};

describe('Branch Chain markdown contract', () => {
  it('returns absent when the section is missing', () => {
    expect(extractBranchChainBinding('# Task\n\n## Scope\n\nDo work.')).toEqual({ kind: 'absent' });
  });

  it('formats and extracts deterministic fenced JSON', () => {
    const section = formatBranchChainSection({
      ...binding,
      unknown: 'ignored',
    } as TaskBranchChainBinding & { unknown: string });

    expect(section).toBe(`## Branch Chain

\`\`\`json
{
  "schemaVersion": 1,
  "mode": "continuation",
  "rootTaskId": "20260517t084211z-platform",
  "parentTaskId": "20260518t091500z-platform-followup",
  "depth": 2,
  "repos": [
    {
      "repoRoot": "/repo/tools",
      "repoLabel": "tools",
      "chainSourceBranch": "task/20260517t084211z-platform",
      "parentSourceBranch": "task/20260518t091500z-platform-followup",
      "parentBranchHead": "0123456789abcdef0123456789abcdef01234567",
      "targetBranch": "main"
    }
  ]
}
\`\`\``);
    expect(section.endsWith('\n')).toBe(false);
    expect(extractBranchChainBinding(section)).toEqual({ kind: 'binding', binding });
  });

  it('returns malformed-json for invalid fenced JSON', () => {
    const result = extractBranchChainBinding('## Branch Chain\n\n```json\n{bad\n```');

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBe('malformed-json');
    }
  });

  it('returns missing-json-fence when prose exists without an accepted fence', () => {
    const result = extractBranchChainBinding('## Branch Chain\n\n{"schemaVersion":1}');

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBe('missing-json-fence');
    }
  });

  it('rejects a non-json first fence instead of scanning later fences', () => {
    const result = extractBranchChainBinding(`## Branch Chain

\`\`\`bash
echo ignored
\`\`\`

${formatBranchChainSection(binding).replace('## Branch Chain\n\n', '')}`);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBe('missing-json-fence');
    }
  });

  it('returns invalid-schema when JSON does not match the contract', () => {
    const result = extractBranchChainBinding('## Branch Chain\n\n```json\n{"schemaVersion":1}\n```');

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBe('invalid-schema');
    }
  });

  it('leaves Context Pack Binding parsing unchanged when Branch Chain is present', () => {
    const contextPack = formatContextPackBindingSection({
      contextPackDir: '/repo/contextpacks/demo',
      contextPackId: 'demo-pack',
      scopeMode: 'regular',
      selectedRepoIds: ['tools'],
      selectedFocusIds: [],
    });
    const result = extractContextPackBinding(`${contextPack}\n\n${formatBranchChainSection(binding)}`);

    expect(result).toEqual({
      kind: 'binding',
      binding: {
        contextPackDir: '/repo/contextpacks/demo',
        contextPackId: 'demo-pack',
        scopeMode: 'regular',
        selectedRepoIds: ['tools'],
        selectedFocusIds: [],
      },
    });
  });
});
