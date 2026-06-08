import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  mergeEnterpriseMirrorEnv,
  resolveEnterpriseMirrors,
  renderNpmrcContent,
  renderPipConfContent,
  redactUrl,
  mergeManagedBlock,
  applyEnterpriseMirrors,
  checkMirrorReachability,
  runEnterpriseMirrorsStep,
  type MirrorEnv,
} from '../enterpriseMirrors.js';

const RAW_TOKEN = 'super-secret-token-value-1234';

function envMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe('enterpriseMirrors — env merge (Map to object)', () => {
  it('returns unconfigured state and null-equivalent renders when no env is set', () => {
    const merged = mergeEnterpriseMirrorEnv({}, envMap({}));
    expect(merged).toEqual({});
    const resolved = resolveEnterpriseMirrors(merged);
    expect(resolved.configured).toBe(false);
    expect(resolved.npm).toBeUndefined();
    expect(resolved.pypi).toBeUndefined();
    // No managed block is produced for empty config.
    expect(renderNpmrcContent(undefined, resolved.npm)).toBe('');
    expect(renderPipConfContent(undefined, resolved.pypi)).toBe('');
  });

  it('reads allowed mirror keys from repo .env via Map.get and lets process.env override', () => {
    const merged = mergeEnterpriseMirrorEnv(
      { NPM_CONFIG_REGISTRY: 'https://proc.example/npm/' },
      envMap({
        NPM_CONFIG_REGISTRY: 'https://file.example/npm/',
        PIP_INDEX_URL: 'https://file.example/pypi/simple/',
      }),
    );
    // process.env wins for the conflicting key, .env supplies the other.
    expect(merged.NPM_CONFIG_REGISTRY).toBe('https://proc.example/npm/');
    expect(merged.PIP_INDEX_URL).toBe('https://file.example/pypi/simple/');
  });

  it('ignores unrelated .env keys and never evaluates shell syntax', () => {
    const merged = mergeEnterpriseMirrorEnv(
      {},
      envMap({
        UNRELATED_KEY: 'should-be-ignored',
        TASKSAIL_NPM_REGISTRY: 'https://corp.example/npm/$(whoami)',
      }),
    );
    expect(merged).not.toHaveProperty('UNRELATED_KEY');
    // The literal value is preserved verbatim, never expanded.
    expect(merged.TASKSAIL_NPM_REGISTRY).toBe('https://corp.example/npm/$(whoami)');
  });
});

describe('enterpriseMirrors — registry precedence', () => {
  it.each([
    [
      'NPM_CONFIG_REGISTRY wins over npm_config_registry and TASKSAIL_NPM_REGISTRY',
      {
        NPM_CONFIG_REGISTRY: 'https://a.example/npm/',
        npm_config_registry: 'https://b.example/npm/',
        TASKSAIL_NPM_REGISTRY: 'https://c.example/npm/',
      } as MirrorEnv,
      'https://a.example/npm/',
    ],
    [
      'npm_config_registry wins over TASKSAIL_NPM_REGISTRY when NPM_CONFIG_REGISTRY is absent',
      {
        npm_config_registry: 'https://b.example/npm/',
        TASKSAIL_NPM_REGISTRY: 'https://c.example/npm/',
      } as MirrorEnv,
      'https://b.example/npm/',
    ],
    [
      'TASKSAIL_NPM_REGISTRY is used when both uppercase and lowercase native vars are absent',
      {
        TASKSAIL_NPM_REGISTRY: 'https://c.example/npm/',
      } as MirrorEnv,
      'https://c.example/npm/',
    ],
  ] as const)('%s', (_label, env, expected) => {
    expect(resolveEnterpriseMirrors(env).npm?.registry).toBe(expected);
  });

  it('PIP_INDEX_URL wins over TASKSAIL_PYPI_INDEX_URL', () => {
    const env: MirrorEnv = {
      PIP_INDEX_URL: 'https://a.example/pypi/simple/',
      TASKSAIL_PYPI_INDEX_URL: 'https://b.example/pypi/simple/',
    };
    expect(resolveEnterpriseMirrors(env).pypi?.indexUrl).toBe('https://a.example/pypi/simple/');
  });
});

describe('enterpriseMirrors — replace-registry-host', () => {
  it('NPM_CONFIG_REPLACE_REGISTRY_HOST wins, lowercase is a fallback', () => {
    expect(
      resolveEnterpriseMirrors({
        NPM_CONFIG_REGISTRY: 'https://corp.example/npm/',
        NPM_CONFIG_REPLACE_REGISTRY_HOST: 'always',
        npm_config_replace_registry_host: 'never',
      }).npm?.replaceRegistryHost,
    ).toBe('always');

    expect(
      resolveEnterpriseMirrors({
        NPM_CONFIG_REGISTRY: 'https://corp.example/npm/',
        npm_config_replace_registry_host: 'never',
      }).npm?.replaceRegistryHost,
    ).toBe('never');
  });

  it('defaults to npmjs only when a non-default npm registry is configured', () => {
    expect(
      resolveEnterpriseMirrors({ NPM_CONFIG_REGISTRY: 'https://corp.example/npm/' }).npm
        ?.replaceRegistryHost,
    ).toBe('npmjs');

    // The public registry is the default — no replace-registry-host implied.
    expect(
      resolveEnterpriseMirrors({ NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/' }).npm
        ?.replaceRegistryHost,
    ).toBeUndefined();
  });
});

describe('enterpriseMirrors — URL validation', () => {
  it('returns a structured validation error for an invalid npm URL', () => {
    const resolved = resolveEnterpriseMirrors({ NPM_CONFIG_REGISTRY: 'not a url' });
    expect(resolved.npm).toBeUndefined();
    expect(resolved.errors).toHaveLength(1);
    expect(resolved.errors[0]).toMatchObject({ key: 'npm registry' });
  });

  it('returns a structured validation error for an invalid PyPI URL', () => {
    const resolved = resolveEnterpriseMirrors({ PIP_INDEX_URL: ':::bad:::' });
    expect(resolved.pypi).toBeUndefined();
    expect(resolved.errors.some((e) => e.key === 'PyPI index')).toBe(true);
  });
});

describe('enterpriseMirrors — npm auth reference (no raw token)', () => {
  it('renders a registry-scoped ${TASKSAIL_NPM_AUTH_TOKEN} reference only when the token is set', () => {
    const withToken = resolveEnterpriseMirrors({
      NPM_CONFIG_REGISTRY: 'https://corp.example/api/npm/virtual/',
      TASKSAIL_NPM_AUTH_TOKEN: RAW_TOKEN,
    });
    const npmrc = renderNpmrcContent(undefined, withToken.npm);
    expect(npmrc).toContain('//corp.example/api/npm/virtual/:_authToken=${TASKSAIL_NPM_AUTH_TOKEN}');

    const withoutToken = resolveEnterpriseMirrors({
      NPM_CONFIG_REGISTRY: 'https://corp.example/api/npm/virtual/',
    });
    expect(renderNpmrcContent(undefined, withoutToken.npm)).not.toContain('_authToken');
  });

  it('never writes the raw token value into the generated .npmrc', () => {
    const resolved = resolveEnterpriseMirrors({
      NPM_CONFIG_REGISTRY: 'https://corp.example/npm/',
      TASKSAIL_NPM_AUTH_TOKEN: RAW_TOKEN,
    });
    const npmrc = renderNpmrcContent(undefined, resolved.npm);
    expect(npmrc).not.toContain(RAW_TOKEN);
  });

  it('includes registry, replace-registry-host, and managed markers in the rendered block', () => {
    const resolved = resolveEnterpriseMirrors({ NPM_CONFIG_REGISTRY: 'https://corp.example/npm/' });
    const npmrc = renderNpmrcContent(undefined, resolved.npm);
    expect(npmrc).toContain('# >>> tasksail enterprise mirrors >>>');
    expect(npmrc).toContain('registry=https://corp.example/npm/');
    expect(npmrc).toContain('replace-registry-host=npmjs');
    expect(npmrc).toContain('# <<< tasksail enterprise mirrors <<<');
  });
});

describe('enterpriseMirrors — redaction', () => {
  it('removes userinfo and token-like query values from a URL', () => {
    const redacted = redactUrl('https://user:p%40ss@corp.example/npm/?auth_token=abcdef&page=2');
    expect(redacted).not.toContain('user:');
    expect(redacted).not.toContain('p%40ss');
    expect(redacted).not.toContain('abcdef');
    expect(redacted).toContain('//***@corp.example');
    expect(redacted).toContain('page=2');
  });

  it('masks token-like path segments while leaving normal path segments intact', () => {
    const redacted = redactUrl('https://corp.example/api/token/abcdef123/npm/');
    expect(redacted).not.toContain('abcdef123');
    expect(redacted).toContain('/token/***/');
    // Legitimate path segments are preserved.
    expect(redacted).toContain('/api/');
    expect(redacted).toContain('/npm/');
  });
});

describe('enterpriseMirrors — managed block merge', () => {
  const existing = ['always-auth=true', '# operator note', 'fund=false'].join('\n');

  it('preserves operator content before and after the managed block', () => {
    const withBlock = mergeManagedBlock(existing, ['registry=https://corp.example/npm/']);
    expect(withBlock).toContain('always-auth=true');
    expect(withBlock).toContain('fund=false');
    expect(withBlock).toContain('registry=https://corp.example/npm/');
  });

  it('removes only the managed block and leaves operator content intact', () => {
    const withBlock = mergeManagedBlock(existing, ['registry=https://corp.example/npm/']);
    const removed = mergeManagedBlock(withBlock, null);
    expect(removed).toContain('always-auth=true');
    expect(removed).toContain('fund=false');
    expect(removed).not.toContain('# >>> tasksail enterprise mirrors >>>');
    expect(removed).not.toContain('registry=https://corp.example/npm/');
  });

  it('is idempotent: re-applying identical config yields byte-identical output', () => {
    const once = mergeManagedBlock(existing, ['registry=https://corp.example/npm/']);
    const twice = mergeManagedBlock(once, ['registry=https://corp.example/npm/']);
    expect(twice).toBe(once);
  });
});

describe('enterpriseMirrors — applyEnterpriseMirrors (filesystem)', () => {
  let repoRoot: string;

  const npmrcPath = () => join(repoRoot, '.npmrc');
  const desktopNpmrcPath = () => join(repoRoot, 'src/frontend/desktop/.npmrc');
  const pipConfPath = () => join(repoRoot, '.platform-state/pip.conf');

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async function writeEnv(contents: string): Promise<void> {
    await writeFile(join(repoRoot, '.env'), contents, 'utf-8');
  }

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-mirrors-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('creates no files and reports skipped when no env vars are set', async () => {
    await writeEnv('PROJECT_NAME=tasksail\n');
    const result = await applyEnterpriseMirrors(repoRoot, { processEnv: {} });
    expect(result.status).toBe('skipped');
    expect(result.changedFiles).toEqual([]);
    expect(await exists(npmrcPath())).toBe(false);
    expect(await exists(desktopNpmrcPath())).toBe(false);
    expect(await exists(pipConfPath())).toBe(false);
  });

  it('applies mirror vars present only in repo .env', async () => {
    await writeEnv('NPM_CONFIG_REGISTRY=https://corp.example/npm/\n');
    const result = await applyEnterpriseMirrors(repoRoot, { processEnv: {} });
    expect(result.status).toBe('configured');
    expect(result.changedFiles).toContain('.npmrc');
    const npmrc = await readFile(npmrcPath(), 'utf-8');
    expect(npmrc).toContain('registry=https://corp.example/npm/');
  });

  it('lets process.env mirror vars override conflicting repo .env mirror vars', async () => {
    await writeEnv('NPM_CONFIG_REGISTRY=https://file.example/npm/\n');
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: { NPM_CONFIG_REGISTRY: 'https://proc.example/npm/' },
    });
    const npmrc = await readFile(npmrcPath(), 'utf-8');
    expect(npmrc).toContain('registry=https://proc.example/npm/');
    expect(npmrc).not.toContain('file.example');
  });

  it('writes both .npmrc files and creates parent dirs as needed', async () => {
    await writeEnv('');
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: { NPM_CONFIG_REGISTRY: 'https://corp.example/npm/' },
    });
    expect(result.changedFiles).toEqual(
      expect.arrayContaining(['.npmrc', 'src/frontend/desktop/.npmrc']),
    );
    expect(await exists(desktopNpmrcPath())).toBe(true);
    const desktop = await readFile(desktopNpmrcPath(), 'utf-8');
    expect(desktop).toContain('registry=https://corp.example/npm/');
  });

  it('writes equivalent .npmrc files from TASKSAIL_NPM_REGISTRY when native vars are absent', async () => {
    await writeEnv('');
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: { TASKSAIL_NPM_REGISTRY: 'https://corp.example/npm/' },
    });
    const root = await readFile(npmrcPath(), 'utf-8');
    const desktop = await readFile(desktopNpmrcPath(), 'utf-8');
    expect(root).toContain('registry=https://corp.example/npm/');
    expect(desktop).toBe(root);
  });

  it('preserves operator-authored .npmrc lines before and after the managed block', async () => {
    await writeEnv('');
    await writeFile(npmrcPath(), 'always-auth=true\nfund=false\n', 'utf-8');
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: { NPM_CONFIG_REGISTRY: 'https://corp.example/npm/' },
    });
    const npmrc = await readFile(npmrcPath(), 'utf-8');
    expect(npmrc).toContain('always-auth=true');
    expect(npmrc).toContain('fund=false');
    expect(npmrc).toContain('registry=https://corp.example/npm/');
  });

  it('removes only the managed block when env vars are unset, leaving operator content', async () => {
    await writeEnv('');
    await writeFile(npmrcPath(), 'always-auth=true\n', 'utf-8');
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: { NPM_CONFIG_REGISTRY: 'https://corp.example/npm/' },
    });
    // Now unset and re-apply.
    await applyEnterpriseMirrors(repoRoot, { processEnv: {} });
    const npmrc = await readFile(npmrcPath(), 'utf-8');
    expect(npmrc).toContain('always-auth=true');
    expect(npmrc).not.toContain('tasksail enterprise mirrors');
    expect(npmrc).not.toContain('registry=https://corp.example/npm/');
  });

  it('renders a ${TASKSAIL_NPM_AUTH_TOKEN} reference, never the raw token', async () => {
    await writeEnv('');
    const rawToken = 'raw-token-do-not-write-7777';
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: {
        NPM_CONFIG_REGISTRY: 'https://corp.example/api/npm/virtual/',
        TASKSAIL_NPM_AUTH_TOKEN: rawToken,
      },
    });
    const npmrc = await readFile(npmrcPath(), 'utf-8');
    expect(npmrc).toContain(':_authToken=${TASKSAIL_NPM_AUTH_TOKEN}');
    expect(npmrc).not.toContain(rawToken);
    expect(JSON.stringify(result.messages)).not.toContain(rawToken);
  });

  it('writes .platform-state/pip.conf for a credential-free PyPI mirror', async () => {
    await writeEnv('');
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: { PIP_INDEX_URL: 'https://corp.example/pypi/simple/' },
    });
    expect(result.changedFiles).toContain('.platform-state/pip.conf');
    const pipConf = await readFile(pipConfPath(), 'utf-8');
    expect(pipConf).toContain('[global]');
    expect(pipConf).toContain('index-url = https://corp.example/pypi/simple/');
  });

  it('does NOT write pip.conf for a credential-bearing PyPI URL; warns and persists no secret', async () => {
    await writeEnv('');
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: { PIP_INDEX_URL: 'https://user:secretpw@corp.example/pypi/simple/' },
    });
    // No file written, so nothing on disk can carry the password.
    expect(await exists(pipConfPath())).toBe(false);
    expect(result.changedFiles).not.toContain('.platform-state/pip.conf');
    // The secret must not appear anywhere in the structured result.
    expect(JSON.stringify(result)).not.toContain('secretpw');
    // A redacted warning explains the skip and points at the env-var channel.
    expect(result.warnings.join(' ')).toMatch(/credentials.*PIP_INDEX_URL|PIP_INDEX_URL/i);
  });

  it('removes a stale credential-free pip.conf when the URL becomes credential-bearing', async () => {
    await writeEnv('');
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: { PIP_INDEX_URL: 'https://corp.example/pypi/simple/' },
    });
    expect(await exists(pipConfPath())).toBe(true);
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: { PIP_INDEX_URL: 'https://user:secretpw@corp.example/pypi/simple/' },
    });
    expect(await exists(pipConfPath())).toBe(false);
  });

  it('strips embedded credentials from the .npmrc registry line; warns and persists no secret', async () => {
    await writeEnv('');
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: { NPM_CONFIG_REGISTRY: 'https://deploy:hunter2@corp.example/npm/' },
    });
    const npmrc = await readFile(npmrcPath(), 'utf-8');
    expect(npmrc).toContain('registry=https://corp.example/npm/');
    expect(npmrc).not.toContain('hunter2');
    expect(npmrc).not.toContain('deploy:');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(result.warnings.join(' ')).toMatch(/credentials.*TASKSAIL_NPM_AUTH_TOKEN|TASKSAIL_NPM_AUTH_TOKEN/i);
  });

  it('does not delete operator-authored pip.conf that is not TaskSail-managed', async () => {
    await writeEnv('');
    await mkdir(join(repoRoot, '.platform-state'), { recursive: true });
    await writeFile(pipConfPath(), '[global]\nindex-url = https://operator.example/pypi/\n', 'utf-8');
    await applyEnterpriseMirrors(repoRoot, { processEnv: {} });
    expect(await exists(pipConfPath())).toBe(true);
    const pipConf = await readFile(pipConfPath(), 'utf-8');
    expect(pipConf).toContain('operator.example');
  });

  it('is idempotent: a second identical apply rewrites nothing', async () => {
    await writeEnv('');
    const env = { NPM_CONFIG_REGISTRY: 'https://corp.example/npm/', PIP_INDEX_URL: 'https://corp.example/pypi/simple/' };
    const first = await applyEnterpriseMirrors(repoRoot, { processEnv: env });
    expect(first.changedFiles.length).toBeGreaterThan(0);
    const second = await applyEnterpriseMirrors(repoRoot, { processEnv: env });
    expect(second.changedFiles).toEqual([]);
  });
});

describe('enterpriseMirrors — preflight reachability', () => {
  const fakeResponse = (status: number) =>
    () => Promise.resolve(new Response(null, { status })) as unknown as Promise<Response>;

  it.each([200, 401, 403, 404])('treats HTTP %i as reachable', async (status) => {
    const result = await checkMirrorReachability('https://corp.example/npm/', {
      fetchImpl: fakeResponse(status) as unknown as typeof fetch,
    });
    expect(result.reachable).toBe(true);
    expect(result.status).toBe(status);
  });

  it('returns a redacted failure for a connect/timeout-style error', async () => {
    const failing = (() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:443'))) as unknown as typeof fetch;
    const result = await checkMirrorReachability('https://user:pw@corp.example/npm/', { fetchImpl: failing });
    expect(result.reachable).toBe(false);
    // The redacted URL must not leak userinfo.
    expect(result.url).not.toContain('user:pw');
    expect(result.url).toContain('//***@corp.example');
  });

  it('returns unreachable for an invalid URL without throwing', async () => {
    const result = await checkMirrorReachability('not a url');
    expect(result.reachable).toBe(false);
    expect(result.error).toBe('invalid URL');
  });
});

describe('enterpriseMirrors — runEnterpriseMirrorsStep', () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-mirrors-step-'));
    await writeFile(join(repoRoot, '.env'), '', 'utf-8');
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reports skipped when no mirror vars are set', async () => {
    const step = await runEnterpriseMirrorsStep(repoRoot, { processEnv: {} });
    expect(step).toEqual({ name: 'enterprise-mirrors', status: 'skipped' });
  });

  it('reports ok and never leaks credentials when configured and reachable', async () => {
    const rawToken = 'tok-should-not-appear-2222';
    const ok = (() => Promise.resolve(new Response(null, { status: 200 }))) as unknown as typeof fetch;
    const step = await runEnterpriseMirrorsStep(repoRoot, {
      processEnv: {
        NPM_CONFIG_REGISTRY: 'https://deploy:p%40ss@corp.example/npm/',
        TASKSAIL_NPM_AUTH_TOKEN: rawToken,
      },
      fetchImpl: ok,
    });
    expect(step.status).toBe('ok');
    expect(step.message ?? '').not.toContain(rawToken);
    expect(step.message ?? '').not.toContain('p%40ss');
    expect(step.message ?? '').not.toContain('deploy:');
  });

  it('reports failed (not platform-config-seed) when a configured mirror URL is invalid', async () => {
    const step = await runEnterpriseMirrorsStep(repoRoot, {
      processEnv: { PIP_INDEX_URL: ':::bad:::' },
    });
    expect(step.status).toBe('failed');
  });

  it('reports failed with a redacted message when a configured mirror is unreachable', async () => {
    const failing = (() => Promise.reject(new Error('getaddrinfo ENOTFOUND corp.example'))) as unknown as typeof fetch;
    const step = await runEnterpriseMirrorsStep(repoRoot, {
      processEnv: { NPM_CONFIG_REGISTRY: 'https://corp.example/npm/' },
      fetchImpl: failing,
    });
    expect(step.status).toBe('failed');
    expect(step.message).toContain('unreachable');
  });
});

describe('enterpriseMirrors — electron binary mirror (resolve)', () => {
  it('resolves the electron + builder-binaries mirrors and marks configured', () => {
    const resolved = resolveEnterpriseMirrors({
      TASKSAIL_ELECTRON_MIRROR: 'https://art.example/electron/electron/releases/download/',
      TASKSAIL_ELECTRON_BUILDER_BINARIES_MIRROR: 'https://art.example/electron-builder-binaries/',
    });
    expect(resolved.electronMirror).toBe('https://art.example/electron/electron/releases/download/');
    expect(resolved.electronBuilderBinariesMirror).toBe('https://art.example/electron-builder-binaries/');
    expect(resolved.configured).toBe(true);
  });

  it('strips URL-embedded credentials from the electron mirror', () => {
    const resolved = resolveEnterpriseMirrors({
      TASKSAIL_ELECTRON_MIRROR: 'https://user:secret@art.example/electron/releases/download/',
    });
    expect(resolved.electronMirror).toBe('https://art.example/electron/releases/download/');
    expect(resolved.electronMirrorHadCredentials).toBe(true);
  });

  it('rejects an invalid electron mirror URL', () => {
    const resolved = resolveEnterpriseMirrors({ TASKSAIL_ELECTRON_MIRROR: 'not a url' });
    expect(resolved.electronMirror).toBeUndefined();
    expect(resolved.errors.some((e) => e.key === 'Electron mirror')).toBe(true);
  });
});

describe('enterpriseMirrors — electron mirror (filesystem)', () => {
  let repoRoot: string;
  const npmrcPath = () => join(repoRoot, '.npmrc');
  const desktopNpmrcPath = () => join(repoRoot, 'src/frontend/desktop/.npmrc');

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-electron-mirror-'));
    await writeFile(join(repoRoot, '.env'), '', 'utf-8');
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('writes electron_mirror to the desktop .npmrc only, never the root .npmrc', async () => {
    await applyEnterpriseMirrors(repoRoot, {
      processEnv: {
        NPM_CONFIG_REGISTRY: 'https://corp.example/npm/',
        TASKSAIL_ELECTRON_MIRROR: 'https://art.example/electron/releases/download/',
      },
    });
    const desktop = await readFile(desktopNpmrcPath(), 'utf-8');
    const root = await readFile(npmrcPath(), 'utf-8');
    expect(desktop).toContain('electron_mirror=https://art.example/electron/releases/download/');
    expect(desktop).toContain('registry=https://corp.example/npm/');
    expect(root).toContain('registry=https://corp.example/npm/');
    expect(root).not.toContain('electron_mirror');
  });

  it('writes electron_mirror to the desktop .npmrc even with no npm registry configured', async () => {
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: { TASKSAIL_ELECTRON_MIRROR: 'https://art.example/electron/releases/download/' },
    });
    expect(result.status).toBe('configured');
    const desktop = await readFile(desktopNpmrcPath(), 'utf-8');
    expect(desktop).toContain('electron_mirror=https://art.example/electron/releases/download/');
    expect(desktop).not.toContain('registry=');
  });

  it('surfaces the builder-binaries mirror as an export reminder, never in .npmrc', async () => {
    const result = await applyEnterpriseMirrors(repoRoot, {
      processEnv: {
        TASKSAIL_ELECTRON_BUILDER_BINARIES_MIRROR: 'https://art.example/electron-builder-binaries/',
      },
    });
    expect(result.status).toBe('configured');
    // electron-builder reads it from the environment, so it is never persisted to .npmrc.
    expect(result.changedFiles).not.toContain('src/frontend/desktop/.npmrc');
    expect(result.changedFiles).not.toContain('.npmrc');
    expect(result.messages.join(' ')).toContain('ELECTRON_BUILDER_BINARIES_MIRROR');
  });
});
