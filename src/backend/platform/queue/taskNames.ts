import { slugify } from '../core/index.js';
import { assertValidTaskId, TASK_ID_PATTERN } from './paths.js';

const LEGACY_PREFIX = /^\d{8}t\d{6}z[-_]/i;
const READABLE_PREFIX = /^\d{4}-\d{2}-\d{2}_/;
const READABLE_TIME_SUFFIX = /-\d{6}(?:-\d+)?$/;
const MAX_TASK_ID_LENGTH = 64;

export function stripGeneratedTaskPrefix(value: string): string {
  const withoutLegacy = value.replace(LEGACY_PREFIX, '');
  if (withoutLegacy !== value) {
    return withoutLegacy;
  }

  const withoutReadable = value.replace(READABLE_PREFIX, '');
  if (withoutReadable !== value) {
    return withoutReadable.replace(READABLE_TIME_SUFFIX, '');
  }

  return value;
}

export function isGeneratedTaskFileName(value: string): boolean {
  const stem = value.replace(/\.md$/i, '');
  const hasGeneratedShape = LEGACY_PREFIX.test(stem)
    || (READABLE_PREFIX.test(stem) && READABLE_TIME_SUFFIX.test(stem));
  return hasGeneratedShape && TASK_ID_PATTERN.test(stem);
}

function utcParts(now: Date): { date: string; time: string } {
  const iso = now.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 19).replace(/:/g, ''),
  };
}

function normalizedSlug(rawTitle: string): string {
  return slugify(stripGeneratedTaskPrefix(rawTitle)).replace(/^[-_]+|[-_]+$/g, '') || 'task';
}

function buildCandidate(
  rawTitle: string,
  now: Date,
  collisionSuffix = '',
): string {
  const { date, time } = utcParts(now);
  const fixedLength = date.length + 1 + 1 + time.length + collisionSuffix.length;
  const maxSlugLength = MAX_TASK_ID_LENGTH - fixedLength;
  if (maxSlugLength < 1) {
    throw new Error('readable-task-id-generation-failed: fixed task id parts leave no room for a slug');
  }
  const slug = normalizedSlug(rawTitle)
    .slice(0, maxSlugLength)
    .replace(/[-_]+$/g, '');
  if (!slug) {
    throw new Error('readable-task-id-generation-failed: slug was empty after trimming');
  }
  return `${date}_${slug}-${time}${collisionSuffix}`;
}

export function buildReadableTaskId(input: {
  rawTitle: string;
  now?: Date;
  existingIds?: ReadonlySet<string>;
}): string {
  const now = input.now ?? new Date();
  const existingIds = input.existingIds ?? new Set<string>();
  let suffixNumber = 1;
  while (true) {
    const collisionSuffix = suffixNumber === 1 ? '' : `-${suffixNumber}`;
    const candidate = buildCandidate(input.rawTitle, now, collisionSuffix);
    assertValidTaskId(candidate);
    if (!existingIds.has(candidate)) {
      return candidate;
    }
    suffixNumber++;
  }
}

export function buildReadableTaskFileName(input: {
  rawTitle: string;
  now?: Date;
  existingFileNames?: ReadonlySet<string>;
}): string {
  const existingIds = new Set(
    [...(input.existingFileNames ?? new Set<string>())]
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, '')),
  );
  return `${buildReadableTaskId({
    rawTitle: input.rawTitle,
    now: input.now,
    existingIds,
  })}.md`;
}
