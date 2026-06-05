import { describe, expect, it } from 'vitest';

import {
  isValidDesktopActionRequest,
  validateDesktopActionRequest,
} from './desktopContractValidators';

describe('logExplorer request validation', () => {
  it('accepts listFiles with no payload and rejects any payload', () => {
    expect(validateDesktopActionRequest({ action: 'logExplorer.listFiles' })).toEqual([]);
    expect(isValidDesktopActionRequest({ action: 'logExplorer.listFiles' })).toBe(true);
    expect(validateDesktopActionRequest({ action: 'logExplorer.listFiles', payload: {} })).toEqual([
      'payload must be omitted.',
    ]);
  });

  it('accepts readFile for safe categories, basenames, filters, limits, and cursor modes', () => {
    for (const category of ['info', 'warn', 'error']) {
      expect(validateDesktopActionRequest({
        action: 'logExplorer.readFile',
        payload: { category, fileName: `${category}.jsonl` },
      })).toEqual([]);
    }
    for (const levelFilter of ['all', 'debug', 'info', 'warn', 'error', 'other']) {
      expect(validateDesktopActionRequest({
        action: 'logExplorer.readFile',
        payload: { category: 'info', fileName: 'backend-ts-20260603.jsonl', levelFilter },
      })).toEqual([]);
    }
    for (const cursorPayload of [{ limit: 1 }, { limit: 1000 }, { startLine: 1 }, { beforeLine: 2 }, { tail: true }]) {
      expect(validateDesktopActionRequest({
        action: 'logExplorer.readFile',
        payload: { category: 'info', fileName: 'backend-ts-20260603.jsonl', ...cursorPayload },
      })).toEqual([]);
    }
  });

  it('rejects unsafe categories, filenames, filters, limits, and cursor conflicts', () => {
    const invalidPayloads = [
      { category: 'debug', fileName: 'debug.jsonl' },
      { category: 'info', fileName: 'logs/debug/foo.jsonl' },
      { category: 'info', fileName: '../foo.jsonl' },
      { category: 'info', fileName: 'nested/foo.jsonl' },
      { category: 'info', fileName: '/tmp/foo.jsonl' },
      { category: 'info', fileName: 'C:\\tmp\\foo.jsonl' },
      { category: 'info', fileName: 'C:foo.jsonl' },
      { category: 'info', fileName: 'foo\\bar.jsonl' },
      { category: 'info', fileName: '' },
      { category: 'info', fileName: 'foo.log' },
      { category: 'info', fileName: 'foo.jsonl', limit: 0 },
      { category: 'info', fileName: 'foo.jsonl', limit: 1001 },
      { category: 'info', fileName: 'foo.jsonl', limit: 1.5 },
      { category: 'info', fileName: 'foo.jsonl', startLine: 0 },
      { category: 'info', fileName: 'foo.jsonl', beforeLine: 0 },
      { category: 'info', fileName: 'foo.jsonl', startLine: 1.5 },
      { category: 'info', fileName: 'foo.jsonl', beforeLine: 1.5 },
      { category: 'info', fileName: 'foo.jsonl', levelFilter: 'trace' },
      { category: 'info', fileName: 'foo.jsonl', tail: true, startLine: 1 },
      { category: 'info', fileName: 'foo.jsonl', tail: true, beforeLine: 1 },
      { category: 'info', fileName: 'foo.jsonl', startLine: 1, beforeLine: 2 },
    ];

    for (const payload of invalidPayloads) {
      expect(validateDesktopActionRequest({ action: 'logExplorer.readFile', payload })).not.toEqual([]);
    }
  });
});
