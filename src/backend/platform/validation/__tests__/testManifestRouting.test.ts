import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { detectPythonBin, findRepoRoot } from '../../core/index.js';
import { buildTargetedTestArgs } from '../changedDomainFiles.js';

/**
 * Proves changed Python paths select the intended Python test domains from
 * tests/test_manifest.json via the shared resolver (run-targeted-tests.py
 * --resolve-only), so the CI changed-domain lane and local checks agree.
 */
describe('changed-path → manifest domain routing', () => {
  const repoRoot = findRepoRoot();
  const python = detectPythonBin(repoRoot);
  const scriptPath = path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'run-targeted-tests.py');
  const manifestPath = path.join(repoRoot, 'tests', 'test_manifest.json');

  function resolveOnly(changedPath: string): { status: number | null; output: string } {
    const args = buildTargetedTestArgs({ scriptPath, manifestPath, changedFiles: [changedPath], resolveOnly: true });
    const result = spawnSync(python, args, { cwd: repoRoot, encoding: 'utf-8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('routes a changed MCP reinforcement source path to the reinforcement domain modules', () => {
    const { status, output } = resolveOnly('src/backend/mcp/reinforcement/persistence.py');
    expect(status).toBe(0);
    expect(output).toMatch(/reinforcement/);
  });

  it('reports no selected modules for a path mapped to no domain', () => {
    const { output } = resolveOnly('some/unmapped/location/nothing-here.txt');
    expect(output).toMatch(/No test modules were selected/);
  });
});
