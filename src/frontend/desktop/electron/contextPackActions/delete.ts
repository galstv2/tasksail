import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';

import type { DesktopInvokeResult } from '../../src/shared/desktopContract';
import { loadTaskRegistry } from '../../../../backend/platform/queue/taskRegistry.js';
import { REPO_ROOT } from '../paths';
import { listAvailableContextPacks } from '../main.contextPackCatalog';
import { filterActiveTaskIdsForScope, type ActiveContextPackTaskScope } from '../main.contextPackTaskVisibility';
import { clearDeepFocusSelections } from './deepFocusSelections';
import { removeFocusFiltersForContextPack } from './focusFilters';
import { removeSidebarStateForContextPack } from './contextPackSidebarState';

type CatalogLister = typeof listAvailableContextPacks;

function assertSafeDeletePath(contextPackDir: string): void {
  const resolved = resolve(contextPackDir);
  const name = basename(resolved);
  const repoRoot = resolve(REPO_ROOT);
  const agentWorkspaceRoot = resolve(REPO_ROOT, 'AgentWorkSpace');
  const contextpacksRoot = resolve(REPO_ROOT, 'contextpacks');
  const home = resolve(homedir());
  const root = parse(resolved).root;
  const forbidden = new Set([
    repoRoot,
    agentWorkspaceRoot,
    contextpacksRoot,
    home,
    resolve(root),
  ]);

  if (!name || name === '.' || name === '..' || forbidden.has(resolved)) {
    throw new Error(`Refusing to delete unsafe context pack path: ${contextPackDir}`);
  }
  if (dirname(resolved) === resolved) {
    throw new Error(`Refusing to delete filesystem root: ${contextPackDir}`);
  }
}

export function contextPackMirrorDir(contextPackDir: string): string {
  return join(REPO_ROOT, 'AgentWorkSpace', 'qmd', 'context-packs', basename(resolve(contextPackDir)));
}

async function readActiveTaskIds(): Promise<string[]> {
  try {
    const entries = await readdir(join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items'));
    return entries
      .filter((entry) => !entry.startsWith('.') && !entry.endsWith('.completing'))
      .sort();
  } catch {
    return [];
  }
}

async function activeTaskIdsForContextPack(scope: ActiveContextPackTaskScope): Promise<string[]> {
  const activeTaskIds = await readActiveTaskIds();
  if (activeTaskIds.length === 0) {
    return [];
  }
  const registry = await loadTaskRegistry(REPO_ROOT);
  return filterActiveTaskIdsForScope(activeTaskIds, {
    registry,
    scope,
    pendingDir: join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems'),
  });
}

export async function executeContextPackDeleteAction(
  payload: { contextPackDir: string },
  listContextPacks: CatalogLister = listAvailableContextPacks,
): Promise<DesktopInvokeResult> {
  try {
    if (!payload.contextPackDir || !isAbsolute(payload.contextPackDir)) {
      throw new Error('contextPackDir must be a non-empty absolute path.');
    }
    const requested = resolve(payload.contextPackDir);
    assertSafeDeletePath(requested);
    const catalog = await listContextPacks();
    const matches = catalog.contextPacks.filter((entry) => resolve(entry.contextPackDir) === requested);
    if (matches.length !== 1) {
      throw new Error(`Context pack is not a current catalog entry: ${payload.contextPackDir}`);
    }
    const entry = matches[0]!;
    if (entry.isActive) {
      throw new Error('Active context packs cannot be deleted. Eject the pack first.');
    }
    const activeTaskIds = await activeTaskIdsForContextPack({
      contextPackId: entry.contextPackId,
      contextPackDir: resolve(entry.contextPackDir),
      contextPackName: basename(resolve(entry.contextPackDir)),
    });
    if (activeTaskIds.length > 0) {
      throw new Error(
        `Context pack cannot be deleted while task(s) are active: ${activeTaskIds.join(', ')}. Complete or fail active tasks first.`,
      );
    }

    const mirrorDir = contextPackMirrorDir(entry.contextPackDir);
    assertSafeDeletePath(entry.contextPackDir);
    await rm(entry.contextPackDir, { recursive: true, force: true });
    await rm(mirrorDir, { recursive: true, force: true });
    await removeFocusFiltersForContextPack(entry.contextPackDir);
    await removeSidebarStateForContextPack(entry.contextPackDir);
    await clearDeepFocusSelections({ contextPackDir: entry.contextPackDir });

    return {
      ok: true,
      response: {
        action: 'contextPack.delete' as const,
        mode: 'deleted' as const,
        contextPackDir: entry.contextPackDir,
        mirrorDir,
        message: 'Context pack deleted.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'contextPack.delete',
      error: err instanceof Error ? err.message : 'Failed to delete context pack.',
    };
  }
}
