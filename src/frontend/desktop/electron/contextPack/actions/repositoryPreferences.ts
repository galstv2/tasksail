import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesktopInvokeResult } from '../../../src/shared/desktopContract';
import { UPDATE_PACK_MANIFEST_SCRIPT_PATH, runPythonScriptCommand } from './shared';

export async function executeSetRepoFocusAction(
  payload: { contextPackDir: string; repoId: string; repositoryType: 'primary' | 'support' },
): Promise<DesktopInvokeResult> {
  try {
    // Discriminate: repo list entry vs. focus area (monolith pack).
    // Focus areas are mutated via --primary-focus-area-ids so PackWriter re-derives
    // focusable_areas[].repository_type; repo list entries use --repo-focus directly.
    let isFocusArea = false;
    let currentPrimaryFocusIds: string[] = [];
    try {
      const manifestPath = join(payload.contextPackDir, 'qmd', 'repo-sources.json');
      const raw = JSON.parse(await fsReadFile(manifestPath, 'utf-8')) as Record<string, unknown>;
      const repos = raw['repositories'];
      const repoMatch =
        Array.isArray(repos) &&
        repos.some(
          (r) =>
            typeof r === 'object' &&
            r !== null &&
            (r as Record<string, unknown>)['repo_id'] === payload.repoId,
        );
      if (!repoMatch) {
        const areas = raw['focusable_areas'];
        if (
          Array.isArray(areas) &&
          areas.some(
            (a) =>
              typeof a === 'object' &&
              a !== null &&
              (a as Record<string, unknown>)['focus_id'] === payload.repoId,
          )
        ) {
          isFocusArea = true;
          const primaryIds = raw['primary_focus_area_ids'];
          currentPrimaryFocusIds = Array.isArray(primaryIds)
            ? primaryIds.filter((id): id is string => typeof id === 'string')
            : [];
        }
      }
    } catch {
      // If the manifest is unreadable, fall through — Python will surface the error.
    }

    let args: string[];
    if (isFocusArea) {
      const newIds =
        payload.repositoryType === 'primary'
          ? Array.from(new Set([...currentPrimaryFocusIds, payload.repoId]))
          : currentPrimaryFocusIds.filter((id) => id !== payload.repoId);
      args = [
        UPDATE_PACK_MANIFEST_SCRIPT_PATH,
        '--context-pack-dir', payload.contextPackDir,
        '--repo-id', payload.repoId,
        '--primary-focus-area-ids', newIds.join(','),
      ];
    } else {
      args = [
        UPDATE_PACK_MANIFEST_SCRIPT_PATH,
        '--context-pack-dir', payload.contextPackDir,
        '--repo-id', payload.repoId,
        '--repo-focus', payload.repositoryType,
      ];
    }

    const result = await runPythonScriptCommand(args);
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    if (parsed['status'] !== 'ok') {
      return { ok: false, action: 'contextPack.setRepositoryType', error: (parsed['message'] as string | undefined) ?? 'Unknown error' };
    }
    return {
      ok: true,
      response: {
        action: 'contextPack.setRepositoryType' as const,
        mode: 'updated' as const,
        message: `Set ${payload.repoId} to ${payload.repositoryType}.`,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'contextPack.setRepositoryType',
      error: error instanceof Error ? error.message : 'Failed to update repository type.',
    };
  }
}

export async function executeSetRepoCategoryAction(
  payload: { contextPackDir: string; repoId: string; repoCategory: string },
): Promise<DesktopInvokeResult> {
  try {
    const args = [
      UPDATE_PACK_MANIFEST_SCRIPT_PATH,
      '--context-pack-dir', payload.contextPackDir,
      '--repo-id', payload.repoId,
      '--repo-category', payload.repoCategory,
    ];
    const result = await runPythonScriptCommand(args);
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    if (parsed['status'] !== 'ok') {
      return { ok: false, action: 'contextPack.setRepoCategory', error: (parsed['message'] as string | undefined) ?? 'Unknown error' };
    }
    return {
      ok: true,
      response: {
        action: 'contextPack.setRepoCategory' as const,
        mode: 'updated' as const,
        message: `Set ${payload.repoId} category to ${payload.repoCategory}.`,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'contextPack.setRepoCategory',
      error: error instanceof Error ? error.message : 'Failed to update repository category.',
    };
  }
}
