import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { spawnDirectMcp, stopDirectMcp } from '../directRuntimeProcess.js';

describe('direct runtime integration', () => {
  it.runIf(process.env['RUN_SLOW_TESTS'] === '1')('spawns and stops the real repo-context-mcp process', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-runtime-integration-'));
    try {
      await spawnDirectMcp({
        repoRoot,
        port: 8897,
        env: { TASKSAIL_REPO_ROOT: repoRoot, REPO_CONTEXT_MCP_PORT: '8897' },
      });

      expect(fs.existsSync(path.join(repoRoot, '.platform-state/runtime/repo-context-mcp.pid'))).toBe(true);
    } finally {
      await stopDirectMcp(repoRoot);
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
