/**
 * §6.3 + F34 — containerNaming tests.
 *
 * Covers: passthrough path (F34-safe slugs), sanitization, fallback to sha256
 * when sanitization fails, determinism, Docker 63-char container-name limit.
 *
 * Run: pnpm vitest run src/backend/platform/container/__tests__/containerNaming.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  taskContainerSlug,
  composeProjectName,
  repoContextMcpContainerName,
  COMPOSE_PROJECT_NAME_PREFIX,
  REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX,
  TASK_SLUG_MAX_LEN,
} from '../containerNaming.js';

describe('§6.3 containerNaming constants', () => {
  it('exports the canonical prefixes verbatim', () => {
    expect(COMPOSE_PROJECT_NAME_PREFIX).toBe('tasksail-');
    expect(REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX).toBe('repo-context-mcp-');
    expect(TASK_SLUG_MAX_LEN).toBe(46);
  });
});

describe('§6.3 taskContainerSlug — passthrough', () => {
  it('returns a lowercase [a-z0-9-] id unchanged when F34-safe', () => {
    expect(taskContainerSlug('feature-x')).toBe('feature-x');
    expect(taskContainerSlug('fix-123')).toBe('fix-123');
  });

  it('lowercases uppercase ids', () => {
    expect(taskContainerSlug('Feature-X')).toBe('feature-x');
  });

  it('replaces underscores and other specials with dashes', () => {
    expect(taskContainerSlug('feature_x_y')).toBe('feature-x-y');
    expect(taskContainerSlug('a/b.c')).toBe('a-b-c');
  });

  it('collapses consecutive dashes', () => {
    expect(taskContainerSlug('feature---x')).toBe('feature-x');
  });

  it('trims leading/trailing dashes before validating F34', () => {
    expect(taskContainerSlug('--foo--')).toBe('foo');
  });
});

describe('§6.3 taskContainerSlug — sha256 fallback', () => {
  it('falls back to 16-char hex when sanitized is empty (all specials)', () => {
    const slug = taskContainerSlug('!!!');
    expect(slug).toMatch(/^[a-f0-9]{16}$/);
  });

  it('falls back when sanitized exceeds 46 chars', () => {
    const long = 'a'.repeat(60);
    const slug = taskContainerSlug(long);
    expect(slug).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic: same input → same fallback slug', () => {
    const a = taskContainerSlug('!!!');
    const b = taskContainerSlug('!!!');
    expect(a).toBe(b);
  });
});

describe('§6.3 F34 boundary — 46-char input passes, 47-char triggers fallback', () => {
  it('46-char lowercase alnum id passes through untouched', () => {
    const id = 'a'.repeat(46);
    expect(taskContainerSlug(id)).toBe(id);
  });

  it('47-char lowercase alnum id falls back to sha256', () => {
    const id = 'a'.repeat(47);
    const slug = taskContainerSlug(id);
    expect(slug).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('§6.3 composeProjectName + repoContextMcpContainerName', () => {
  it('prepends tasksail- and stays inside 63-char Docker cap for max slug', () => {
    const id = 'a'.repeat(46);
    const project = composeProjectName(id);
    expect(project).toBe(`tasksail-${id}`);
    expect(project.length).toBeLessThanOrEqual(63);
  });

  it('prepends repo-context-mcp- and exact-fits 63-char cap for max slug', () => {
    const id = 'a'.repeat(46);
    const name = repoContextMcpContainerName(id);
    expect(name).toBe(`repo-context-mcp-${id}`);
    expect(name.length).toBe(63);
  });

  it('fallback-slug container name is 33 chars (prefix 17 + sha256 16)', () => {
    const name = repoContextMcpContainerName('!!!');
    expect(name.length).toBe(33);
    expect(name).toMatch(/^repo-context-mcp-[a-f0-9]{16}$/);
  });
});
