import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateStructure,
  GENERIC_REQUIRED_DIRS,
  GENERIC_REQUIRED_FILES,
  getRequiredDirs,
  getRequiredFiles,
  normalizeStructureRelativePath,
} from '../structure.js';

describe('getRequiredDirs contents', () => {
  it('contains AgentWorkSpace/tasks and AgentWorkSpace/error-items', () => {
    expect(GENERIC_REQUIRED_DIRS).toContain('AgentWorkSpace/tasks');
    expect(GENERIC_REQUIRED_DIRS).toContain('AgentWorkSpace/error-items');
    expect(GENERIC_REQUIRED_DIRS).toContain('runtime/docker');
    expect(GENERIC_REQUIRED_DIRS).toContain('runtime/podman');
  });

  it('does not contain legacy singleton dirs AgentWorkSpace/handoffs or the old hyphen-free error dir', () => {
    expect(GENERIC_REQUIRED_DIRS).not.toContain('AgentWorkSpace/handoffs');
    const oldErrorDir = ['AgentWorkSpace', 'error' + 'items'].join('/');
    expect(GENERIC_REQUIRED_DIRS).not.toContain(oldErrorDir);
  });

  it('adds active provider required directories at validation time', () => {
    const requiredDirs = getRequiredDirs(process.cwd());
    expect(requiredDirs).toContain('.github/agents');
    expect(requiredDirs).toContain('.github/copilot');
    expect(requiredDirs).toContain('AgentWorkSpace/tasks');
  });
});

describe('getRequiredFiles contents', () => {
  it('platform-generic file list contains the base operator-facing files', () => {
    expect(GENERIC_REQUIRED_FILES).toContain('.env.example');
    expect(GENERIC_REQUIRED_FILES).toContain('Makefile');
  });

  it('getRequiredFiles equals the generic list — the Copilot provider declares no required files', () => {
    // Copilot `--agent` reads .github/copilot/instructions/ via requiredDirs;
    // top-level Copilot IDE / Chat instructions are personal dev aids, not
    // runtime-required platform files.
    const ignoredCopilotInstructions = ['.github', 'copilot-instructions.md'].join('/');
    const requiredFiles = getRequiredFiles(process.cwd());
    expect(requiredFiles).toEqual(GENERIC_REQUIRED_FILES);
    expect(requiredFiles).not.toContain(ignoredCopilotInstructions);
    expect(requiredFiles).not.toContain('CLAUDE.md');
  });
});

describe('validateStructure', () => {
  let tmpDir: string;

    beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'validate-structure-'));
    await fs.promises.mkdir(path.join(tmpDir, '.git'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects missing required directories', async () => {
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('Missing required directory'))).toBe(true);
  });

  it('detects missing required files', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing required file'))).toBe(true);
  });

  it('passes when all required dirs and files exist', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a new production module dropped at the Electron root (post-refactor boundary)', async () => {
    const electronDir = path.join(tmpDir, 'src/frontend/desktop/electron');
    await fs.promises.mkdir(electronDir, { recursive: true });
    await fs.promises.writeFile(path.join(electronDir, 'main.ts'), '');
    await fs.promises.writeFile(path.join(electronDir, 'main.newFeatureHandlers.ts'), 'export {};\n');

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('main.newFeatureHandlers.ts');
    expect(result.errors.join('\n')).toContain('ownership folder');
  });

  it('allows allowlisted root files, ownership-folder modules, and root tests at the Electron root', async () => {
    const electronDir = path.join(tmpDir, 'src/frontend/desktop/electron');
    await fs.promises.mkdir(path.join(electronDir, 'tasks'), { recursive: true });
    for (const allowed of [
      'main.ts',
      'preload.ts',
      'repoObservability.ts',
      'paths.ts',
      'utils.ts',
      'main.textUtils.ts',
      'main.markdown.ts',
      'devRestartProtocol.ts',
    ]) {
      await fs.promises.writeFile(path.join(electronDir, allowed), '');
    }
    await fs.promises.writeFile(path.join(electronDir, 'main.bootstrap.test.ts'), '');
    await fs.promises.writeFile(path.join(electronDir, 'tasks', 'board.ts'), '');

    const result = await validateStructure(tmpDir);

    // This minimal fixture may have unrelated missing-structure errors; only
    // the root-boundary rule must stay silent.
    expect(result.errors.join('\n')).not.toContain('ownership folder');
  });

  it('rejects a new production module dropped at the renderer root (post-refactor boundary)', async () => {
    const rendererDir = path.join(tmpDir, 'src/frontend/desktop/src/renderer');
    await fs.promises.mkdir(rendererDir, { recursive: true });
    await fs.promises.writeFile(path.join(rendererDir, 'main.tsx'), '');
    await fs.promises.writeFile(path.join(rendererDir, 'plannerStrayModule.ts'), 'export {};\n');

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('plannerStrayModule.ts');
    expect(result.errors.join('\n')).toContain('ownership folder');
  });

  it('allows allowlisted root files, ownership-folder modules, and root tests at the renderer root', async () => {
    const rendererDir = path.join(tmpDir, 'src/frontend/desktop/src/renderer');
    await fs.promises.mkdir(path.join(rendererDir, 'components'), { recursive: true });
    for (const allowed of [
      'main.tsx',
      'App.tsx',
      'App.test.tsx',
      'App.integration.test.tsx',
      'App.test-setup.ts',
      'activityStream.ts',
      'activityStream.test.ts',
    ]) {
      await fs.promises.writeFile(path.join(rendererDir, allowed), '');
    }
    await fs.promises.writeFile(path.join(rendererDir, 'SomeWidget.test.tsx'), '');
    await fs.promises.writeFile(path.join(rendererDir, 'components', 'SomeWidget.tsx'), '');

    const result = await validateStructure(tmpDir);

    // This minimal fixture may have unrelated missing-structure errors; only
    // the renderer root-boundary rule must stay silent.
    expect(result.errors.join('\n')).not.toContain('ownership folder');
  });

  it('rejects a new loose module dropped at the platform TypeScript root', async () => {
    const platformDir = path.join(tmpDir, 'src/backend/platform');
    await fs.promises.mkdir(path.join(platformDir, 'core'), { recursive: true });
    await fs.promises.writeFile(path.join(platformDir, 'vitest.config.ts'), '');
    await fs.promises.writeFile(path.join(platformDir, 'strayPlatformModule.ts'), 'export {};\n');

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('strayPlatformModule.ts');
    expect(result.errors.join('\n')).toContain('module folder');
  });

  it('allows the vitest tooling, module folders, and root tests at the platform TypeScript root', async () => {
    const platformDir = path.join(tmpDir, 'src/backend/platform');
    await fs.promises.mkdir(path.join(platformDir, 'validation'), { recursive: true });
    for (const allowed of ['vitest.config.ts', 'vitest.childProcessGuard.ts', 'vitest.logIsolation.ts']) {
      await fs.promises.writeFile(path.join(platformDir, allowed), '');
    }
    await fs.promises.writeFile(path.join(platformDir, 'harness.test.ts'), '');
    await fs.promises.writeFile(path.join(platformDir, 'validation', 'structure.ts'), '');

    const result = await validateStructure(tmpDir);

    // The platform root-boundary rule must allow vitest tooling, module folders, and root tests.
    expect(result.errors.join('\n')).not.toContain('module folder');
  });

  it('rejects a loose helper module dropped at the scripts/python root', async () => {
    const scriptsDir = path.join(tmpDir, 'src/backend/scripts/python');
    await fs.promises.mkdir(path.join(scriptsDir, 'lib'), { recursive: true });
    await fs.promises.writeFile(path.join(scriptsDir, 'run-targeted-tests.py'), '');
    await fs.promises.writeFile(path.join(scriptsDir, 'stray_helper.py'), '');

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('stray_helper.py');
    expect(result.errors.join('\n')).toContain('lib/');
  });

  it('allows scripts/python entrypoints plus the lib ownership folder', async () => {
    const scriptsDir = path.join(tmpDir, 'src/backend/scripts/python');
    await fs.promises.mkdir(path.join(scriptsDir, 'lib'), { recursive: true });
    for (const allowed of [
      'activate-context-pack-helper.py',
      'approve-context-estate-manifest.py',
      'bootstrap-context-pack.py',
      'discover-context-estate.py',
      'dismiss-realignment-session.py',
      'file-task-archive.py',
      'plan-qmd-seeding.py',
      'realignment-ingest.py',
      'repo-context-app.py',
      'run-pack-preflight.py',
      'run-role-agent-helper.py',
      'run-targeted-tests.py',
      'start-realignment-session.py',
      'submit-reinforcement-feedback.py',
      'sync-context-pack-workspace.py',
      'update-global-realignment-doc.py',
      'update-pack-manifest.py',
      'upgrade-pack-on-activate.py',
      'upgrade-pack-schema.py',
      'validate-docs.py',
      'write-stub-scope-tree.py',
    ]) {
      await fs.promises.writeFile(path.join(scriptsDir, allowed), '');
    }
    await fs.promises.writeFile(path.join(scriptsDir, 'notes.txt'), '');
    await fs.promises.writeFile(path.join(scriptsDir, 'lib', 'helper.py'), '');

    const result = await validateStructure(tmpDir);

    expect(result.errors.join('\n')).not.toContain('scripts/python');
  });

  it('rejects a loose module dropped at the mcp root', async () => {
    const mcpDir = path.join(tmpDir, 'src/backend/mcp');
    await fs.promises.mkdir(path.join(mcpDir, 'pack'), { recursive: true });
    await fs.promises.writeFile(path.join(mcpDir, '__init__.py'), '');
    await fs.promises.writeFile(path.join(mcpDir, 'stray_probe.py'), '');

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('stray_probe.py');
    expect(result.errors.join('\n')).toContain('module folder');
  });

  it('allows the mcp package marker and subpackage directories', async () => {
    const mcpDir = path.join(tmpDir, 'src/backend/mcp');
    for (const subpackage of [
      'context_estate',
      'pack',
      'pack_schemas',
      'probes',
      'reinforcement',
      'repo_context_mcp',
      'workspace_context_sync',
    ]) {
      await fs.promises.mkdir(path.join(mcpDir, subpackage), { recursive: true });
    }
    await fs.promises.writeFile(path.join(mcpDir, '__init__.py'), '');
    await fs.promises.writeFile(path.join(mcpDir, 'README.md'), '');

    const result = await validateStructure(tmpDir);

    expect(result.errors.join('\n')).not.toContain('src/backend/mcp');
  });

  it('allows the Electron main thin-wrapper composition surface', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }
    const mainPath = path.join(tmpDir, 'src/frontend/desktop/electron/main.ts');
    await fs.promises.mkdir(path.dirname(mainPath), { recursive: true });
    await fs.promises.writeFile(
      mainPath,
      [
        "import { app } from 'electron';",
        "import { schedulePipelineAutoStart } from './app/startupRecovery';",
        "import { createDefaultDesktopActionHandlers } from './ipc/desktopActionHandlers';",
        'const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock?.() ?? true;',
        'export function registerAppLifecycle(): void {}',
        'export function handleDesktopAction() {',
        '  return createDefaultDesktopActionHandlers({ schedulePipelineAutoStart });',
        '}',
        "export { createWindow } from './app/windowManager';",
        '',
      ].join('\n'),
    );

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects Electron main implementation bodies that belong in extracted modules', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }
    const mainPath = path.join(tmpDir, 'src/frontend/desktop/electron/main.ts');
    await fs.promises.mkdir(path.dirname(mainPath), { recursive: true });
    await fs.promises.writeFile(
      mainPath,
      [
        "import { BrowserWindow, ipcMain } from 'electron';",
        'type DesktopActionHandlers = Record<string, unknown>;',
        'export function createWindow() { return new BrowserWindow({}); }',
        'export function registerDesktopContract() { ipcMain.handle("desktop-shell:invoke", () => undefined); }',
        'export async function handleDesktopAction(request: { action: string }) {',
        '  switch (request.action) { default: return { ok: false }; }',
        '}',
        'export function startEverything() {',
        '  startRuntimeStreamWatcher();',
        '  startTaskBoardWatcher();',
        '  startTaskRecoveryController();',
        '  cleanupStalePipelineState();',
        '  schedulePipelineAutoStart();',
        '}',
        '',
      ].join('\n'),
    );

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('app/windowManager.ts');
    expect(result.errors.join('\n')).toContain('ipc/contract.ts');
    expect(result.errors.join('\n')).toContain('ipc/desktopActionRouter.ts');
    expect(result.errors.join('\n')).toContain('ipc/desktopActionHandlers.ts');
    expect(result.errors.join('\n')).toContain('app/appController.ts');
    expect(result.errors.join('\n')).toContain('app/startupRecovery.ts');
  });

  it('allows the repoObservability public facade and barrel shape', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }
    const facadePath = path.join(tmpDir, 'src/frontend/desktop/electron/repoObservability.ts');
    const indexPath = path.join(tmpDir, 'src/frontend/desktop/electron/repoObservability/index.ts');
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(
      facadePath,
      [
        'export {',
        '  probePidLiveness,',
        '  inferGuardrailIdentity,',
        '  readQueueStatusSnapshot,',
        '  readObservabilitySnapshot,',
        "} from './repoObservability/index';",
        '',
      ].join('\n'),
    );
    await fs.promises.writeFile(
      indexPath,
      [
        "export { probePidLiveness } from './sessionHealth';",
        "export { inferGuardrailIdentity } from './guardrails';",
        "export { readQueueStatusSnapshot } from './queueSnapshot';",
        "export { readObservabilitySnapshot } from './snapshot';",
        '',
      ].join('\n'),
    );

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects repoObservability implementation code in the public facade or barrel', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }
    const facadePath = path.join(tmpDir, 'src/frontend/desktop/electron/repoObservability.ts');
    const indexPath = path.join(tmpDir, 'src/frontend/desktop/electron/repoObservability/index.ts');
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(
      facadePath,
      [
        "import { readFile } from 'node:fs/promises';",
        'export async function readObservabilitySnapshot() {',
        "  return readFile('/tmp/receipt.json', 'utf-8');",
        '}',
        '',
      ].join('\n'),
    );
    await fs.promises.writeFile(
      indexPath,
      [
        "export { probePidLiveness } from './sessionHealth';",
        "export { readObservabilitySnapshot } from './snapshot';",
        "export function helperThatShouldStayInternal() { return true; }",
        '',
      ].join('\n'),
    );

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('repoObservability.ts must remain a four-export facade');
    expect(result.errors.join('\n')).toContain('repoObservability/index.ts must remain a four-export public barrel');
  });

  it('rejects production imports from internal repoObservability modules', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }
    const facadePath = path.join(tmpDir, 'src/frontend/desktop/electron/repoObservability.ts');
    const indexPath = path.join(tmpDir, 'src/frontend/desktop/electron/repoObservability/index.ts');
    const consumerPath = path.join(tmpDir, 'src/frontend/desktop/electron/app/environmentStatus.ts');
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(
      facadePath,
      [
        'export {',
        '  probePidLiveness,',
        '  inferGuardrailIdentity,',
        '  readQueueStatusSnapshot,',
        '  readObservabilitySnapshot,',
        "} from './repoObservability/index';",
        '',
      ].join('\n'),
    );
    await fs.promises.writeFile(
      indexPath,
      [
        "export { probePidLiveness } from './sessionHealth';",
        "export { inferGuardrailIdentity } from './guardrails';",
        "export { readQueueStatusSnapshot } from './queueSnapshot';",
        "export { readObservabilitySnapshot } from './snapshot';",
        '',
      ].join('\n'),
    );
    await fs.promises.mkdir(path.dirname(consumerPath), { recursive: true });
    await fs.promises.writeFile(
      consumerPath,
      "import { readObservabilitySnapshot } from './repoObservability/snapshot';\n",
    );

    const result = await validateStructure(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('must import the public ./repoObservability facade');
  });

  it('normalizes Windows-style structure paths before architecture comparisons', () => {
    expect(normalizeStructureRelativePath('src\\frontend\\desktop\\electron\\repoObservability.ts'))
      .toBe('src/frontend/desktop/electron/repoObservability.ts');
    expect(normalizeStructureRelativePath('src\\frontend\\desktop\\electron\\repoObservability\\snapshot.ts'))
      .toBe('src/frontend/desktop/electron/repoObservability/snapshot.ts');
  });
});
