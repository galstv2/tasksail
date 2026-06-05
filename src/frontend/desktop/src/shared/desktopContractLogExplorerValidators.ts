import {
  isOneOf,
  isRecord,
} from './desktopContractValidationCore';

const LOG_EXPLORER_CATEGORIES = ['info', 'warn', 'error'] as const;
const LOG_EXPLORER_LEVEL_FILTERS = ['all', 'debug', 'info', 'warn', 'error', 'other'] as const;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;

export function validateLogExplorerListFilesPayload(payload: unknown): string[] {
  if (payload !== undefined) {
    return ['payload must be omitted.'];
  }
  return [];
}

function validateFileName(fileName: unknown): string[] {
  if (typeof fileName !== 'string' || fileName.length === 0) {
    return ['payload.fileName must be a non-empty .jsonl basename.'];
  }
  if (
    fileName === '..'
    || fileName.includes('/')
    || fileName.includes('\\')
    || fileName.startsWith('.')
    || WINDOWS_DRIVE_PREFIX.test(fileName)
    || !fileName.endsWith('.jsonl')
  ) {
    return ['payload.fileName must be a direct .jsonl basename.'];
  }
  return [];
}

function validatePositiveInteger(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return [`payload.${field} must be an integer >= 1 when provided.`];
  }
  return [];
}

export function validateLogExplorerReadFilePayload(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ['payload must be an object.'];
  }
  const errors: string[] = [];
  if (!isOneOf(payload.category, LOG_EXPLORER_CATEGORIES)) {
    errors.push('payload.category must be info, warn, or error.');
  }
  errors.push(...validateFileName(payload.fileName));
  if (payload.limit !== undefined) {
    if (typeof payload.limit !== 'number' || !Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 1000) {
      errors.push('payload.limit must be an integer from 1 to 1000 when provided.');
    }
  }
  errors.push(...validatePositiveInteger(payload.startLine, 'startLine'));
  errors.push(...validatePositiveInteger(payload.beforeLine, 'beforeLine'));
  if (payload.tail !== undefined && typeof payload.tail !== 'boolean') {
    errors.push('payload.tail must be a boolean when provided.');
  }
  if (payload.levelFilter !== undefined && !isOneOf(payload.levelFilter, LOG_EXPLORER_LEVEL_FILTERS)) {
    errors.push('payload.levelFilter must be all, debug, info, warn, error, or other when provided.');
  }

  const cursorModes = [
    payload.tail === true ? 'tail' : null,
    payload.startLine !== undefined ? 'startLine' : null,
    payload.beforeLine !== undefined ? 'beforeLine' : null,
  ].filter(Boolean);
  if (cursorModes.length > 1) {
    errors.push('payload may include only one cursor mode: tail, startLine, or beforeLine.');
  }
  return errors;
}
