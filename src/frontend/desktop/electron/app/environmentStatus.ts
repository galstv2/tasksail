import type {
  EnvironmentStatusResponse,
  ObservabilitySnapshotResponse,
  QueueStatusResponse,
} from '../../src/shared/desktopContract';

import {
  readObservabilitySnapshot as readObservabilitySnapshotImpl,
  readQueueStatusSnapshot as readQueueStatusSnapshotImpl,
} from '../repoObservability';
import * as plannerSession from '../planner/session';
import { REPO_ROOT, DESKTOP_ROOT } from '../paths';
import { toRepoRelativePath } from '../main.textUtils';
import {
  getPackageArtifactName,
  getPackageCommand,
  getPackageOutputDir,
} from './packaging';
import { pathExists, repoFs, type ReadOnlyRepoFs } from '../utils';
import { join } from 'node:path';

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const PENDING_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const RELEASE_DIR = join(DESKTOP_ROOT, 'release');

const HELPER_STATUSES = [
  {
    label: 'Dropbox task helper',
    path: 'src/backend/platform/queue/createDropboxTask.ts',
    available: true,
    detail: 'Platform TypeScript module for standard planner submission through AgentWorkSpace/dropbox/.',
  },
  {
    label: 'Follow-up task helper',
    path: 'src/backend/platform/queue/createFollowupTask.ts',
    available: true,
    detail: 'Platform TypeScript module for completed-task child-task follow-up creation.',
  },
  {
    label: 'Context-pack activation helper',
    path: 'src/backend/platform/context-pack/switch.ts',
    available: true,
    detail: 'Platform TypeScript module for the default operator startup activation flow.',
  },
];

export async function readQueueStatusSnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<QueueStatusResponse> {
  return readQueueStatusSnapshotImpl(fsAdapter);
}

export async function readEnvironmentStatus(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<EnvironmentStatusResponse> {
  const repoArtifactsReady = await Promise.all([
    pathExists(REPO_ROOT, fsAdapter),
    pathExists(DROPBOX_DIR, fsAdapter),
    pathExists(PENDING_DIR, fsAdapter),
  ]);
  const platformLabel = `Native packaging guidance is available for the current host platform (${process.platform}).`;
  const validationSummary =
    repoArtifactsReady.every(Boolean)
      ? 'Repo root, workflow queue directories, and platform modules are available for host-native desktop operation.'
      : 'Desktop startup requires the repo root and queue directories to remain available on the host before native launch.';

  return {
    action: 'environment.readStatus',
    mode: 'read-only',
    message: 'Desktop packaging and startup guidance remain read-only and host-native against the repo root.',
    platform: process.platform,
    repoRoot: REPO_ROOT,
    packageOutputDir: toRepoRelativePath(getPackageOutputDir(RELEASE_DIR)),
    packageArtifactName: getPackageArtifactName(),
    packageCommand: getPackageCommand(),
    hostMode: 'repo-root-native',
    validationSummary: `${platformLabel} ${validationSummary}`,
    launchPolicy:
      'Launch the desktop shell host-native against the repo root. Repo workflow artifacts remain authoritative and are never relocated into the packaged app bundle.',
    helperStatuses: HELPER_STATUSES,
    contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts switch --context-pack-dir /path/to/context-pack --preview',
    contextPackWritePlanHint:
      'Use the backend-owned context-pack switch and QMD seed dry-run flows; the desktop shell should not reimplement workspace or seeding logic.',
    bootstrapFlowHint:
      'Structured context-pack creation remains backend-owned and is launched through the desktop create flow, not desktop-specific setup commands.',
  };
}

export async function readObservabilitySnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<ObservabilitySnapshotResponse> {
  const snapshot = await readObservabilitySnapshotImpl(fsAdapter);
  return {
    ...snapshot,
    plannerBroker: plannerSession.getObservability(),
  };
}
