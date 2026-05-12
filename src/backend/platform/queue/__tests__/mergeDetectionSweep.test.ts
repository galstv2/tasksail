import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { runMergeDetectionSweep } from '../mergeDetectionSweep.js';

describe('runMergeDetectionSweep retired compatibility shim', () => {
  it('does not scan completed sidecars or clean up completed branch handoffs', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'tasksail-sweep-retired-'));
    const taskId = 'completed-handoff';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    try {
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(
        path.join(taskDir, '.task.json'),
        JSON.stringify({
          schema_version: 2,
          taskId,
          contextPackBinding: {
            contextPackPath: null,
            dataHostDir: null,
            dataContainerDir: null,
            repoBindings: [{
              originalRoot: repoRoot,
              worktreeRoot: path.join(taskDir, 'worktrees', 'repo'),
              worktreeBranch: `task/${taskId}`,
              baseCommitSha: 'base',
            }],
          },
          materialization: { strategy: 'copy', cloned: [], skipped: [] },
          frozenAt: new Date().toISOString(),
          finalizedAt: new Date().toISOString(),
          state: 'completed',
        }, null, 2) + '\n',
      );

      const result = await runMergeDetectionSweep(repoRoot);

      expect(result).toEqual({
        scanned: 0,
        bindingsMarked: 0,
        tasksFullyMerged: 0,
        tasksCleanedUp: 0,
      });
      expect(existsSync(taskDir)).toBe(true);
      expect(existsSync(path.join(taskDir, '.task.json'))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
