import type {
  ContextPackApplyResponse, ContextPackClearResponse, ContextPackDeepFocusDerivedRoot,
  ContextPackFocusTargetKind, ContextPackPreviewResponse, ContextPackPrimaryFocusTarget,
  ContextPackSwitchExecutionResult, ContextPackSwitchPayload, DesktopInvokeResult,
} from '../../../src/shared/desktopContract';
import { setActiveContextPackEnv } from '../../../../../backend/platform/context-pack/activate';
import { REPO_ROOT } from '../../paths';
import { stringOrNull } from '../../utils';
import { readDeepFocusPath, stringArray } from '../shared';
import {
  cloneFocusTarget, mirrorSinglePrimaryScopedFields, normalizeDeepFocusTarget,
  normalizePrimaryFocusTargets, normalizeRelativePath, normalizeSupportTargets,
  runContextPackWorkspaceScript, toWorkspaceSyncPrimaryTarget, toWorkspaceSyncTarget, validateTestTarget,
  type ContextPackWorkspaceScriptRunner,
} from './shared';
import { createLogger } from '../../log/logger';

export { buildContextPackWorkspaceArgs, runContextPackWorkspaceScript, type ContextPackWorkspaceScriptRunner };

const log = createLogger('electron/contextPackActions/workspace');

function readSnakeOrCamelString(
  value: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): string | undefined {
  const raw = Object.prototype.hasOwnProperty.call(value, snakeKey)
    ? value[snakeKey]
    : value[camelKey];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function withScopedFieldsFromRawTargets(
  normalizedTargets: ContextPackPrimaryFocusTarget[],
  rawTargets: readonly ContextPackPrimaryFocusTarget[] | undefined,
): ContextPackPrimaryFocusTarget[] {
  if (!rawTargets || rawTargets.length === 0) return normalizedTargets;
  const rawByKey = new Map<string, ContextPackPrimaryFocusTarget>();
  for (const rawTarget of rawTargets) {
    rawByKey.set(`${normalizeRelativePath(rawTarget.path)}\0${rawTarget.kind}`, rawTarget);
  }
  return normalizedTargets.map((target) => {
    const rawTarget = rawByKey.get(`${target.path}\0${target.kind}`);
    if (!rawTarget) return target;
    const testTarget = cloneFocusTarget(rawTarget.testTarget);
    return {
      ...target,
      ...(testTarget !== undefined ? { testTarget } : {}),
      ...(rawTarget.supportTargets && rawTarget.supportTargets.length > 0
        ? { supportTargets: rawTarget.supportTargets.map(normalizeDeepFocusTarget) }
        : {}),
    };
  });
}

function readTargetIdentity(value: Record<string, unknown>): {
  repoLocalPath?: string;
  repoId?: string;
  focusId?: string;
} {
  const repoLocalPath = readSnakeOrCamelString(value, 'repo_local_path', 'repoLocalPath');
  const repoId = readSnakeOrCamelString(value, 'repo_id', 'repoId');
  const focusId = readSnakeOrCamelString(value, 'focus_id', 'focusId');
  return {
    ...(repoLocalPath ? { repoLocalPath } : {}),
    ...(repoId ? { repoId } : {}),
    ...(focusId ? { focusId } : {}),
  };
}

function normalizeContextPackSwitchPayload(
  payload: ContextPackSwitchPayload,
): ContextPackSwitchPayload {
  const selectedFocusPath = normalizeRelativePath(payload.selectedFocusPath ?? '');

  if (
    selectedFocusPath
    && payload.selectedFocusTargetKind !== 'directory'
    && payload.selectedFocusTargetKind !== 'file'
    && payload.deepFocusEnabled === true
  ) {
    throw new Error('Deep Focus apply requires selectedFocusTargetKind to be directory or file.');
  }

  const selectedTestTarget = payload.selectedTestTarget === undefined
    ? undefined
    : payload.selectedTestTarget === null
      ? null
      : normalizeDeepFocusTarget(payload.selectedTestTarget);
  const selectedPrimaryKind = payload.selectedFocusTargetKind ?? 'directory';
  const hasExplicitPrimaryTargets = Array.isArray(payload.selectedFocusTargets);
  const normalizedPrimaryTargetsWithoutScopedFields = payload.deepFocusEnabled === true
    ? normalizePrimaryFocusTargets({
        rawTargets: hasExplicitPrimaryTargets ? payload.selectedFocusTargets : undefined,
        legacyPath: selectedFocusPath,
        legacyKind: selectedPrimaryKind,
      }).targets
    : (payload.selectedFocusTargets ?? []).map((target) => ({
        path: normalizeRelativePath(target.path),
        kind: target.kind,
        ...(target.role ? { role: target.role } : {}),
      }));
  const normalizedPrimaryTargets = withScopedFieldsFromRawTargets(
    normalizedPrimaryTargetsWithoutScopedFields as ContextPackPrimaryFocusTarget[],
    payload.selectedFocusTargets,
  );
  const anchorTarget = normalizedPrimaryTargets.find((target) => target.role === 'anchor')
    ?? normalizedPrimaryTargets[0];

  if (payload.deepFocusEnabled === true && selectedTestTarget) {
    const validation = validateTestTarget({
      primaryPath: anchorTarget?.path ?? selectedFocusPath,
      primaryKind: anchorTarget?.kind ?? selectedPrimaryKind,
      testTarget: selectedTestTarget,
    });
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
  }

  const selectedSupportTargets = payload.deepFocusEnabled === true
    ? normalizeSupportTargets({
        primaryPath: selectedFocusPath,
        primaryKind: selectedPrimaryKind,
        primaryTargets: normalizedPrimaryTargets,
        testTarget: selectedTestTarget ?? undefined,
        rawTargets: payload.selectedSupportTargets ?? [],
      }).map(({ path, kind, repoLocalPath, repoId, focusId }) => ({
        path,
        kind,
        ...(repoLocalPath ? { repoLocalPath } : {}),
        ...(repoId ? { repoId } : {}),
        ...(focusId ? { focusId } : {}),
      }))
    : (payload.selectedSupportTargets ?? []).map((t) => ({
        path: normalizeRelativePath(t.path),
        kind: t.kind,
        ...(t.repoLocalPath ? { repoLocalPath: t.repoLocalPath } : {}),
        ...(t.repoId ? { repoId: t.repoId } : {}),
        ...(t.focusId ? { focusId: t.focusId } : {}),
      }));
  const mirrored = mirrorSinglePrimaryScopedFields(
    normalizedPrimaryTargets,
    selectedTestTarget,
    selectedSupportTargets,
  );

  return {
    ...payload,
    deepFocusEnabled: payload.deepFocusEnabled === true,
    selectedFocusPath: hasExplicitPrimaryTargets && anchorTarget ? anchorTarget.path : selectedFocusPath,
    selectedFocusTargetKind: hasExplicitPrimaryTargets && anchorTarget ? anchorTarget.kind : payload.selectedFocusTargetKind ?? null,
    selectedFocusTargets: hasExplicitPrimaryTargets ? normalizedPrimaryTargets as ContextPackPrimaryFocusTarget[] : undefined,
    selectedTestTarget: mirrored.selectedTestTarget,
    selectedSupportTargets: mirrored.selectedSupportTargets,
  };
}

function buildContextPackWorkspaceArgs(
  action: 'preview' | 'apply' | 'clear',
  payload?: ContextPackSwitchPayload,
): string[] {
  const args = ['--action', action];
  if (payload) {
    const normalizedPayload = normalizeContextPackSwitchPayload(payload);
    args.push('--context-pack-dir', normalizedPayload.contextPackDir);
    args.push('--scope-mode', normalizedPayload.scopeMode);
    for (const repoId of normalizedPayload.selectedRepoIds ?? []) {
      args.push('--selected-repo-id', repoId);
    }
    for (const focusId of normalizedPayload.selectedFocusIds ?? []) {
      args.push('--selected-focus-id', focusId);
    }
    if (normalizedPayload.deepFocusEnabled) {
      args.push('--deep-focus-enabled');
      if (normalizedPayload.deepFocusPrimaryRepoId) {
        args.push('--deep-focus-primary-repo-id', normalizedPayload.deepFocusPrimaryRepoId);
      }
      if (normalizedPayload.deepFocusPrimaryFocusId) {
        args.push('--deep-focus-primary-focus-id', normalizedPayload.deepFocusPrimaryFocusId);
      }
    }
    if (normalizedPayload.selectedFocusPath || normalizedPayload.deepFocusEnabled) {
      args.push('--selected-focus-path', normalizedPayload.selectedFocusPath ?? '');
    }
    if (normalizedPayload.selectedFocusTargetKind) {
      args.push('--selected-focus-target-kind', normalizedPayload.selectedFocusTargetKind);
    }
    for (const target of normalizedPayload.selectedFocusTargets ?? []) {
      args.push('--selected-focus-target', JSON.stringify(toWorkspaceSyncPrimaryTarget(target)));
    }
    if (normalizedPayload.deepFocusEnabled) {
      if (normalizedPayload.selectedTestTarget !== undefined) {
        args.push(
          '--selected-test-target',
          JSON.stringify(
            normalizedPayload.selectedTestTarget === null
              ? null
              : toWorkspaceSyncTarget(normalizedPayload.selectedTestTarget),
          ),
        );
      }
      for (const supportTarget of normalizedPayload.selectedSupportTargets ?? []) {
        args.push('--selected-support-target', JSON.stringify(toWorkspaceSyncTarget(supportTarget)));
      }
    }
  }
  return args;
}

function normalizeContextPackExecutionResult(value: unknown): ContextPackSwitchExecutionResult {
  const payload = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const workspace = typeof payload.workspace === 'object' && payload.workspace !== null ? (payload.workspace as Record<string, unknown>) : {};
  const activation = typeof payload.activation === 'object' && payload.activation !== null ? (payload.activation as Record<string, unknown>) : {};
  const wrapperAction = stringOrNull(payload.action);
  const selectedTestTarget = typeof workspace.selected_test_target === 'object' && workspace.selected_test_target !== null
    ? workspace.selected_test_target as Record<string, unknown>
    : null;
  const hasSelectedTestTargetField = Object.prototype.hasOwnProperty.call(workspace, 'selected_test_target');
  const selectedSupportTargets = Array.isArray(workspace.selected_support_targets)
    ? workspace.selected_support_targets.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    : [];
  const selectedFocusTargets = Array.isArray(workspace.selected_focus_targets)
    ? workspace.selected_focus_targets.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    : [];
  const derivedWritableRoots = Array.isArray(workspace.derived_writable_roots)
    ? workspace.derived_writable_roots.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    : [];
  const derivedReadonlyContextRoots = Array.isArray(workspace.derived_readonly_context_roots)
    ? workspace.derived_readonly_context_roots.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    : [];

  const normalizeDerivedRoot = (target: Record<string, unknown>): ContextPackDeepFocusDerivedRoot => {
    const kind: ContextPackFocusTargetKind =
      target.kind === 'directory' || target.kind === 'file' ? target.kind : 'directory';
    const reason: ContextPackDeepFocusDerivedRoot['reason'] =
      target.reason === 'selected-primary'
      || target.reason === 'primary-focus-parent'
      || target.reason === 'test-target'
      || target.reason === 'support-target'
      || target.reason === 'scoped-test-target'
      || target.reason === 'scoped-support-target'
        ? target.reason
        : 'selected-primary';
    const sourceTargets = Array.isArray(target.source_targets) ? target.source_targets
      : Array.isArray(target.sourceTargets) ? target.sourceTargets : [];
    const repoLocalPath = readSnakeOrCamelString(target, 'repo_local_path', 'repoLocalPath');
    return {
      path: stringOrNull(target.path) ?? '',
      kind,
      reason,
      ...(repoLocalPath ? { repoLocalPath } : {}),
      ...(sourceTargets.length > 0
        ? {
            sourceTargets: sourceTargets
              .filter((st): st is Record<string, unknown> => typeof st === 'object' && st !== null)
              .map((st) => {
                const tt = typeof st.test_target === 'object' && st.test_target !== null
                  ? st.test_target as Record<string, unknown>
                  : typeof st.testTarget === 'object' && st.testTarget !== null
                    ? st.testTarget as Record<string, unknown>
                    : null;
                const srcRepoLocalPath = readSnakeOrCamelString(st, 'repo_local_path', 'repoLocalPath');
                const repoId = readSnakeOrCamelString(st, 'repo_id', 'repoId');
                const focusId = readSnakeOrCamelString(st, 'focus_id', 'focusId');
                return {
                  path: stringOrNull(st.path) ?? '',
                  kind: st.kind === 'directory' || st.kind === 'file' ? st.kind : 'directory',
                  ...(srcRepoLocalPath ? { repoLocalPath: srcRepoLocalPath } : {}),
                  ...(repoId ? { repoId } : {}),
                  ...(focusId ? { focusId } : {}),
                  ...(st.role === 'anchor' || st.role === 'primary' ? { role: st.role } : {}),
                  ...(tt ? {
                    testTarget: {
                      path: stringOrNull(tt.path) ?? '',
                      kind: tt.kind === 'directory' || tt.kind === 'file' ? tt.kind : 'directory',
                      ...readTargetIdentity(tt),
                    },
                  } : {}),
                };
              }),
          }
        : {}),
    };
  };

  return {
    ok: payload.ok === true,
    wrapperAction: (wrapperAction === 'apply' || wrapperAction === 'clear' ? wrapperAction : 'preview') as 'preview' | 'apply' | 'clear',
    stage: stringOrNull(payload.stage) ?? '',
    status: stringOrNull(payload.status) ?? '',
    activation: {
      performed: activation.performed === true,
      exitCode: typeof activation.exit_code === 'number' ? activation.exit_code : null,
      output: stringOrNull(activation.output) ?? '',
    },
    envStateCleared: payload.env_state_cleared === true,
    error: stringOrNull(payload.error),
    contextPackId: stringOrNull(workspace.context_pack_id),
    contextPackDir: stringOrNull(workspace.context_pack_dir),
    workspaceFile: stringOrNull(workspace.workspace_file),
    stateFile: stringOrNull(workspace.state_file),
    scopeMode: 'focused' as const,
    selectedRepoIds: stringArray(workspace.selected_repo_ids),
    selectedFocusIds: stringArray(workspace.selected_focus_ids),
    warnings: stringArray(workspace.warnings),
    foldersToAdd: stringArray(workspace.folders_to_add),
    foldersToRemove: stringArray(workspace.folders_to_remove),
    managedFolders: stringArray(workspace.managed_folders),
    targetFolders: stringArray(workspace.target_folders),
    lastSyncedAt: stringOrNull(workspace.last_synced_at),
    deepFocusEnabled: workspace.deep_focus_enabled === true,
    deepFocusPrimaryRepoId: stringOrNull(workspace.deep_focus_primary_repo_id),
    deepFocusPrimaryFocusId: stringOrNull(workspace.deep_focus_primary_focus_id),
    selectedFocusPath: readDeepFocusPath(workspace.selected_focus_path),
    selectedFocusTargetKind:
      workspace.selected_focus_target_kind === 'directory'
      || workspace.selected_focus_target_kind === 'file'
        ? workspace.selected_focus_target_kind as ContextPackFocusTargetKind
        : null,
    selectedFocusTargets: selectedFocusTargets.map((target) => {
      const testTarget = typeof target.test_target === 'object' && target.test_target !== null
        ? target.test_target as Record<string, unknown>
        : typeof target.testTarget === 'object' && target.testTarget !== null
          ? target.testTarget as Record<string, unknown>
          : null;
      const supportTargets = Array.isArray(target.support_targets) ? target.support_targets
        : Array.isArray(target.supportTargets) ? target.supportTargets : [];
      const repoLocalPath = readSnakeOrCamelString(target, 'repo_local_path', 'repoLocalPath');
      const repoId = readSnakeOrCamelString(target, 'repo_id', 'repoId');
      const focusId = readSnakeOrCamelString(target, 'focus_id', 'focusId');
      return {
        path: stringOrNull(target.path) ?? '',
        kind: target.kind === 'directory' || target.kind === 'file' ? target.kind : 'directory',
        ...(repoLocalPath ? { repoLocalPath } : {}),
        ...(repoId ? { repoId } : {}),
        ...(focusId ? { focusId } : {}),
        ...(target.role === 'anchor' || target.role === 'primary' ? { role: target.role } : {}),
        ...(testTarget ? {
          testTarget: {
            path: stringOrNull(testTarget.path) ?? '',
            kind: testTarget.kind === 'directory' || testTarget.kind === 'file' ? testTarget.kind : 'directory',
            ...readTargetIdentity(testTarget),
          },
        } : {}),
        ...(supportTargets.length > 0
          ? {
              supportTargets: supportTargets
                .filter((st): st is Record<string, unknown> => typeof st === 'object' && st !== null)
                .map((st) => ({
                  path: stringOrNull(st.path) ?? '',
                  kind: st.kind === 'directory' || st.kind === 'file' ? st.kind : 'directory',
                  ...readTargetIdentity(st),
                })),
            }
          : {}),
      };
    }),
    selectedTestTarget: !hasSelectedTestTargetField
      ? undefined
      : selectedTestTarget
        ? {
            path: stringOrNull(selectedTestTarget.path) ?? '',
            kind: selectedTestTarget.kind === 'directory' || selectedTestTarget.kind === 'file'
              ? selectedTestTarget.kind as ContextPackFocusTargetKind
              : 'directory' as ContextPackFocusTargetKind,
            ...readTargetIdentity(selectedTestTarget),
          }
        : null,
    selectedSupportTargets: selectedSupportTargets.map((t) => ({
      path: stringOrNull(t.path) ?? '',
      kind: t.kind === 'directory' || t.kind === 'file' ? t.kind as ContextPackFocusTargetKind : 'directory' as ContextPackFocusTargetKind,
      ...readTargetIdentity(t),
    })),
    derivedWritableRoots: derivedWritableRoots.map(normalizeDerivedRoot),
    derivedReadonlyContextRoots: derivedReadonlyContextRoots.map(normalizeDerivedRoot),
  };
}

export async function executeContextPackWorkspaceAction(
  desktopAction: 'contextPack.previewSwitch' | 'contextPack.applySwitch' | 'contextPack.clearActive',
  wrapperAction: 'preview' | 'apply' | 'clear',
  payload?: ContextPackSwitchPayload,
  runner: ContextPackWorkspaceScriptRunner = runContextPackWorkspaceScript,
): Promise<DesktopInvokeResult> {
  try {
    const result = await runner(buildContextPackWorkspaceArgs(wrapperAction, payload));
    const normalized = normalizeContextPackExecutionResult(JSON.parse(result.stdout));
    if (!normalized.ok) {
      return {
        ok: false,
        action: desktopAction,
        error: normalized.error ?? 'Context-pack workspace command reported a structured failure.',
        details: normalized.warnings,
        contextPackResult: normalized,
      };
    }
    if (wrapperAction === 'apply' && normalized.contextPackDir) {
      try {
        await setActiveContextPackEnv(REPO_ROOT, normalized.contextPackDir);
      } catch (error: unknown) {
        log.error(
          'context-pack.workspace.activate-env.failed',
          error instanceof Error ? error : { reason: String(error) },
          { wrapperAction, contextPackDir: normalized.contextPackDir },
        );
        throw error;
      }
    }
    if (wrapperAction === 'clear') {
      try {
        await setActiveContextPackEnv(REPO_ROOT, '');
      } catch (error: unknown) {
        log.error(
          'context-pack.workspace.activate-env.failed',
          error instanceof Error ? error : { reason: String(error) },
          { wrapperAction },
        );
        throw error;
      }
    }
    const responseBase = {
      message: wrapperAction === 'preview'
        ? 'Context-pack workspace preview completed through the approved wrapper seam.'
        : wrapperAction === 'apply'
          ? 'Context-pack workspace apply completed through the approved wrapper seam.'
          : 'Active context-pack workspace state cleared through the approved wrapper seam.',
      commandPath: 'src/backend/scripts/python/sync-context-pack-workspace.py',
      result: normalized,
    };
    const response: ContextPackPreviewResponse | ContextPackApplyResponse | ContextPackClearResponse =
      desktopAction === 'contextPack.previewSwitch'
        ? { action: desktopAction, mode: 'preview', ...responseBase }
        : desktopAction === 'contextPack.applySwitch'
          ? { action: desktopAction, mode: 'applied', ...responseBase }
          : { action: desktopAction, mode: 'cleared', ...responseBase };
    return { ok: true, response };
  } catch (error: unknown) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error
      ? String((error as { stdout?: unknown }).stdout ?? '') : '';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    if (stdout.trim().length > 0) {
      try {
        const normalized = normalizeContextPackExecutionResult(JSON.parse(stdout));
        return {
          ok: false,
          action: desktopAction,
          error: (normalized.error ?? stderr) || 'Context-pack workspace command failed.',
          details: normalized.warnings,
          contextPackResult: normalized,
        };
      } catch { /* fall through */ }
    }
    return {
      ok: false,
      action: desktopAction,
      error: stderr || (error instanceof Error ? error.message : 'Context-pack workspace command failed unexpectedly.'),
    };
  }
}
