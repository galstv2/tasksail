import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { contextPackEnv } from '../bootstrapTaskMcp.js';

describe('contextPackEnv (mount resolution)', () => {
  const repoRoot = '/host/repo';
  const engineOptions = { engineHost: 'auto' as const, wslDistro: null };

  it('returns empty env when binding is undefined', () => {
    expect(contextPackEnv(repoRoot, undefined, engineOptions)).toEqual({});
  });

  it('in-tree pack: ACTIVE_CONTEXT_PACK_DIR resolves under /workspace', () => {
    const env = contextPackEnv(
      repoRoot,
      {
        contextPackPath: path.join(
          repoRoot,
          'AgentWorkSpace',
          'context-pack',
          'pack.json',
        ),
      },
      engineOptions,
    );
    expect(env['ACTIVE_CONTEXT_PACK_DIR']).toBe(
      '/workspace/AgentWorkSpace/context-pack',
    );
    expect(env['ACTIVE_CONTEXT_PACK_HOST_DIR']).toBeUndefined();
  });

  it('out-of-tree pack: ACTIVE_CONTEXT_PACK_DIR is /mnt/context-pack and host dir set', () => {
    const env = contextPackEnv(
      repoRoot,
      {
        contextPackPath: '/elsewhere/my-pack/pack.json',
      },
      engineOptions,
    );
    expect(env['ACTIVE_CONTEXT_PACK_DIR']).toBe('/mnt/context-pack');
    expect(env['ACTIVE_CONTEXT_PACK_HOST_DIR']).toBe('/elsewhere/my-pack');
  });

  it('rejects non-POSIX dataContainerDir', () => {
    expect(() =>
      contextPackEnv(repoRoot, {
        contextPackPath: path.join(repoRoot, 'AgentWorkSpace', 'pack.json'),
        dataContainerDir: 'data/qmd',
      }, engineOptions),
    ).toThrow(/absolute POSIX path/);
  });

  it('absolute dataContainerDir passes through verbatim', () => {
    const env = contextPackEnv(
      repoRoot,
      {
        contextPackPath: path.join(repoRoot, 'AgentWorkSpace', 'pack.json'),
        dataContainerDir: '/data/qmd',
      },
      engineOptions,
    );
    expect(env['REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR']).toBe('/data/qmd');
  });
});
