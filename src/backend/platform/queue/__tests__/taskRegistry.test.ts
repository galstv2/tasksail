import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repairTaskRegistry } from '../taskRegistry.js';

describe('taskRegistry Deep Focus persistence', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-registry-'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'dropbox'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('captures Deep Focus binding fields while rebuilding the registry', async () => {
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'dropbox', 'task.md'),
      `# Queue Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Context Pack ID: orders
- Scope Mode: focused
- Selected Repo IDs: backend
- Selected Focus IDs: api
- Deep Focus Enabled: true
- Selected Focus Path: src/orders
- Selected Focus Target Kind: directory
- Selected Test Target: {"path":"tests/orders","kind":"directory"}
- Selected Support Targets: [{"path":"docs/orders.md","kind":"file"}]

## Request Summary

Body
`,
      'utf-8',
    );

    const registry = await repairTaskRegistry(repoRoot);
    const entry = registry.tasks.orders?.open[0];

    expect(entry).toMatchObject({
      contextPackId: 'orders',
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });
  });
});
