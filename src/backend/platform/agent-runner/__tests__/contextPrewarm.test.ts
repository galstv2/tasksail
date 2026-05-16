import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveConventionsContext = vi.fn();
const resolveCorrectionsContext = vi.fn();
const resolveReinforcementContext = vi.fn();
const loadExternalMcpRegistryWithFallback = vi.fn();

vi.mock('../conventions.js', () => ({
  resolveConventionsContext,
}));

vi.mock('../corrections.js', () => ({
  resolveCorrectionsContext,
}));

vi.mock('../reinforcement.js', () => ({
  resolveReinforcementContext,
}));

vi.mock('../../external-mcp-registry/index.js', () => ({
  CURRENT_SCHEMA_VERSION: 1,
  loadExternalMcpRegistryWithFallback,
}));

const { prewarmPipelineContext } = await import('../pipeline/contextPrewarm.js');
const {
  clearExternalMcpRegistryCache,
  getCachedExternalMcpRegistry,
} = await import('../pipeline/externalMcpRegistryCache.js');

describe('prewarmPipelineContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearExternalMcpRegistryCache();
    resolveConventionsContext.mockResolvedValue({ status: 'resolved' });
    resolveCorrectionsContext.mockResolvedValue({ status: 'resolved' });
    resolveReinforcementContext.mockResolvedValue({ status: 'resolved' });
    loadExternalMcpRegistryWithFallback.mockResolvedValue({
      schema_version: 1,
      external_servers: [{ id: 'registry-server' }],
    });
  });

  afterEach(() => {
    clearExternalMcpRegistryCache();
  });

  it('prewarms the external MCP registry even without a context pack', async () => {
    await prewarmPipelineContext(['alice', 'dalton'], undefined, '/repo');

    expect(loadExternalMcpRegistryWithFallback).toHaveBeenCalledTimes(1);
    expect(loadExternalMcpRegistryWithFallback).toHaveBeenCalledWith('/repo');
    expect(resolveConventionsContext).not.toHaveBeenCalled();
    expect(resolveCorrectionsContext).not.toHaveBeenCalled();
    expect(resolveReinforcementContext).not.toHaveBeenCalled();
    expect(getCachedExternalMcpRegistry('/repo')).toEqual({
      schema_version: 1,
      external_servers: [{ id: 'registry-server' }],
    });
  });

  it('reuses the cached registry across repeated prewarm calls in the same run', async () => {
    await prewarmPipelineContext(['alice'], undefined, '/repo');
    await prewarmPipelineContext(['dalton'], undefined, '/repo');

    expect(loadExternalMcpRegistryWithFallback).toHaveBeenCalledTimes(1);
    expect(getCachedExternalMcpRegistry('/repo')).toEqual({
      schema_version: 1,
      external_servers: [{ id: 'registry-server' }],
    });
  });

  it('continues prewarming context-pack data after caching the registry', async () => {
    resolveConventionsContext
      .mockResolvedValueOnce({ status: 'not-applicable' })
      .mockResolvedValueOnce({ status: 'resolved' });
    resolveCorrectionsContext.mockResolvedValueOnce({ status: 'resolved' });

    await prewarmPipelineContext(['alice', 'dalton'], '/context-pack', '/repo');

    expect(loadExternalMcpRegistryWithFallback).toHaveBeenCalledTimes(1);
    expect(resolveConventionsContext.mock.calls).toEqual([
      ['alice', '/context-pack', '/repo'],
      ['dalton', '/context-pack', '/repo'],
    ]);
    expect(resolveCorrectionsContext.mock.calls).toEqual([
      ['alice', '/context-pack', '/repo'],
    ]);
    expect(resolveReinforcementContext.mock.calls).toEqual([
      ['alice', '/context-pack', '/repo'],
      ['dalton', '/context-pack', '/repo'],
    ]);
  });

  it('fails open with an empty cached registry when registry loading throws', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    loadExternalMcpRegistryWithFallback.mockRejectedValueOnce(new Error('registry unavailable'));

    await expect(prewarmPipelineContext(['alice'], undefined, '/repo')).resolves.toBeUndefined();

    expect(getCachedExternalMcpRegistry('/repo')).toEqual({
      schema_version: 1,
      external_servers: [],
    });
    const warnings = String(warnSpy.mock.calls.flat().join('\n'));
    expect(warnings).toContain('external_mcp_registry.prewarm.failed');
    expect(warnings).toContain('registry unavailable');

    warnSpy.mockRestore();
  });
});
