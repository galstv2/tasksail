/**
 * Archived task listing for the planner child-task parent selection dropdown.
 */
import { open as fsOpen, readdir as fsReadDir, readFile as fsReadFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type {
  ArchivedTaskEntry,
  ContextPackListResponse,
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

type ContextPackLister = () => Promise<ContextPackListResponse>;

const HEAD_BYTES = 2048;

async function readFileHead(filePath: string): Promise<string> {
  const handle = await fsOpen(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function extractTitle(head: string): string {
  const match = head.match(/^#\s+(.+?)$/m);
  return match?.[1]?.trim() ?? '';
}

function extractTaskId(head: string): string {
  const match = head.match(/^- Task ID:\s*(.+?)$/m);
  return match?.[1]?.trim() ?? '';
}

type JsonSidecar = {
  record_id?: string;
  task_id?: string;
  root_task_id?: string;
  followup_reason?: string;
  completed_work_summary?: string;
  task_summary?: string;
};

async function readJsonSidecar(mdPath: string): Promise<JsonSidecar> {
  const jsonPath = mdPath.replace(/\.md$/, '.json');
  try {
    const raw = await fsReadFile(jsonPath, 'utf-8');
    return JSON.parse(raw) as JsonSidecar;
  } catch {
    return {};
  }
}

export async function listArchivedTasksAction(
  listContextPacks: ContextPackLister,
): Promise<DesktopInvokeResult> {
  try {
    const catalog = await listContextPacks();
    const activeEntry = catalog.contextPacks.find((entry) => entry.isActive);
    if (!activeEntry) {
      const response: PlannerListArchivedTasksResponse = {
        action: 'planner.listArchivedTasks',
        mode: 'no-context-pack',
        message: 'No active context pack.',
        tasks: [],
      };
      return { ok: true, response };
    }

    // Use directory basename — archive paths are built from the directory name,
    // not contextPackId which may be overridden by the manifest.
    const contextPackName = basename(activeEntry.contextPackDir);
    const archiveRoot = join(
      REPO_ROOT,
      'AgentWorkSpace',
      'qmd',
      'context-packs',
      contextPackName,
      'archive',
      'tasks',
    );

    let yearDirs: string[];
    try {
      const entries = await fsReadDir(archiveRoot, { withFileTypes: true });
      yearDirs = entries
        .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
        .map((e) => e.name);
    } catch {
      const response: PlannerListArchivedTasksResponse = {
        action: 'planner.listArchivedTasks',
        mode: 'empty',
        message: `No task archive found for context pack ${contextPackName}.`,
        tasks: [],
      };
      return { ok: true, response };
    }

    const tasks: ArchivedTaskEntry[] = [];

    for (const year of yearDirs) {
      const yearPath = join(archiveRoot, year);
      let files: string[];
      try {
        files = (await fsReadDir(yearPath)).filter((f) => f.endsWith('.md'));
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = join(yearPath, file);
        try {
          const [head, sidecar] = await Promise.all([
            readFileHead(filePath),
            readJsonSidecar(filePath),
          ]);
          const taskId = sidecar.task_id || extractTaskId(head) || basename(file, '.md');
          const title = extractTitle(head) || basename(file, '.md');
          const summary = sidecar.completed_work_summary || sidecar.task_summary || '';
          tasks.push({
            taskId,
            title,
            summary,
            rootTaskId: sidecar.root_task_id || taskId,
            qmdRecordId: sidecar.record_id || '',
            followupReason: sidecar.followup_reason || '',
            year,
            archivePath: filePath,
            contextPackName,
          });
        } catch {
          continue;
        }
      }
    }

    if (tasks.length === 0) {
      const response: PlannerListArchivedTasksResponse = {
        action: 'planner.listArchivedTasks',
        mode: 'empty',
        message: `No archived completed tasks found for context pack ${contextPackName}.`,
        tasks: [],
      };
      return { ok: true, response };
    }

    const response: PlannerListArchivedTasksResponse = {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: `Found ${tasks.length} archived task(s) in ${contextPackName}.`,
      tasks,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.listArchivedTasks',
      error: error instanceof Error ? error.message : 'Failed to list archived tasks.',
    };
  }
}
