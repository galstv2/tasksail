import { readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

import { dialog } from 'electron';

import type {
  DesktopInvokeResult,
  PlannerPickMarkdownFileResponse,
} from '../../src/shared/desktopContract';

const MARKDOWN_FILE_SIZE_LIMIT = 128 * 1024;

export async function pickMarkdownFileAction(): Promise<DesktopInvokeResult> {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select a Markdown file for Lily to review',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile', 'dontAddToRecent'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      const response: PlannerPickMarkdownFileResponse = {
        action: 'planner.pickMarkdownFile',
        mode: 'cancelled',
        message: 'Markdown file selection was cancelled.',
        filename: null,
        path: null,
        content: null,
      };
      return { ok: true, response };
    }

    const filePath = resolve(result.filePaths[0]);
    const ext = extname(filePath).toLowerCase();
    if (ext !== '.md') {
      return {
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: `Selected file must be a Markdown (.md) file, got ${ext || 'no extension'}.`,
      };
    }

    const fileStat = await fsStat(filePath);
    if (fileStat.size > MARKDOWN_FILE_SIZE_LIMIT) {
      return {
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: `Selected file exceeds the 128 KB size limit (${Math.round(fileStat.size / 1024)} KB).`,
      };
    }

    const content = await fsReadFile(filePath, 'utf-8');
    if (content.trim().length === 0) {
      return {
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: 'Selected Markdown file is empty.',
      };
    }

    const response: PlannerPickMarkdownFileResponse = {
      action: 'planner.pickMarkdownFile',
      mode: 'selected',
      message: `Markdown file selected: ${basename(filePath)}`,
      filename: basename(filePath),
      path: filePath,
      content,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.pickMarkdownFile',
      error: error instanceof Error ? error.message : 'Markdown file selection failed unexpectedly.',
    };
  }
}
