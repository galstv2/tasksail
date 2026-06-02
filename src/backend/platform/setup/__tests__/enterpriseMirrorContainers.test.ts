import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createSharedMcpComposeBootstrapEnv } from '../../container/sharedMcp.js';

// Repo root is five levels above this file (setup/__tests__).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf-8');

const REPO_CONTEXT_FILES = [
  'runtime/docker/repo-context-mcp/Dockerfile',
  'runtime/podman/repo-context-mcp/Containerfile',
];
const APP_FILES = ['runtime/docker/app/Dockerfile', 'runtime/podman/app/Containerfile'];
const COMPOSE_FILES = [
  'runtime/docker/compose/docker-compose.yml',
  'runtime/podman/compose/podman-compose.yml',
];

describe('enterprise mirror container build-arg contract (static)', () => {
  it('repo-context files declare ARG TASKSAIL_PYTHON_BASE_IMAGE before FROM with the public default', () => {
    for (const file of REPO_CONTEXT_FILES) {
      expect(read(file)).toMatch(
        /ARG TASKSAIL_PYTHON_BASE_IMAGE=python:3\.12-alpine\s*\nFROM \$\{TASKSAIL_PYTHON_BASE_IMAGE\}/,
      );
    }
  });

  it('app placeholder files declare ARG TASKSAIL_ALPINE_BASE_IMAGE before FROM with the public default', () => {
    for (const file of APP_FILES) {
      expect(read(file)).toMatch(
        /ARG TASKSAIL_ALPINE_BASE_IMAGE=alpine:3\.20\s*\nFROM \$\{TASKSAIL_ALPINE_BASE_IMAGE\}/,
      );
    }
  });

  it('compose files pass TASKSAIL_PYTHON_BASE_IMAGE build.arg defaulting to python:3.12-alpine', () => {
    for (const file of COMPOSE_FILES) {
      expect(read(file)).toContain(
        'TASKSAIL_PYTHON_BASE_IMAGE: ${TASKSAIL_PYTHON_BASE_IMAGE:-python:3.12-alpine}',
      );
    }
  });

  it('defines no app build service and no ALPINE compose path (direct-build only)', () => {
    for (const file of COMPOSE_FILES) {
      const content = read(file);
      // The only service is repo-context-mcp; no top-level "app:" service entry.
      expect(content).not.toMatch(/^ {2}app:\s*$/m);
      expect(content).not.toContain('TASKSAIL_ALPINE_BASE_IMAGE');
    }
  });

  it('adds no container registry credential management to any changed container file', () => {
    for (const file of [...REPO_CONTEXT_FILES, ...APP_FILES, ...COMPOSE_FILES]) {
      const content = read(file);
      expect(content).not.toMatch(
        /docker login|podman login|TASKSAIL_DOCKER_AUTH_TOKEN|TASKSAIL_PODMAN_AUTH_TOKEN/,
      );
    }
  });
});

describe('createSharedMcpComposeBootstrapEnv (base-image propagation)', () => {
  let repoTmp: string;

  beforeEach(async () => {
    repoTmp = await mkdtemp(join(tmpdir(), 'tasksail-compose-env-'));
  });
  afterEach(async () => {
    await rm(repoTmp, { recursive: true, force: true });
  });

  it('carries TASKSAIL_PYTHON_BASE_IMAGE from process env and does not let the scrub list strip it', async () => {
    await writeFile(join(repoTmp, '.env'), '', 'utf-8');
    const env = await createSharedMcpComposeBootstrapEnv(8811, repoTmp, {
      PATH: '/usr/bin',
      TASKSAIL_PYTHON_BASE_IMAGE: 'registry.example.internal/python:3.12-alpine',
      COMPOSE_PROJECT_NAME: 'scrub-me',
    });
    expect(env['TASKSAIL_PYTHON_BASE_IMAGE']).toBe('registry.example.internal/python:3.12-alpine');
    expect(env['COMPOSE_PROJECT_NAME']).toBeUndefined();
    expect(env['REPO_CONTEXT_MCP_PORT']).toBe('8811');
  });

  it('fills TASKSAIL_PYTHON_BASE_IMAGE from repo .env when absent from process env', async () => {
    await writeFile(
      join(repoTmp, '.env'),
      'TASKSAIL_PYTHON_BASE_IMAGE=mirror.internal/python:3.12-alpine\n',
      'utf-8',
    );
    const env = await createSharedMcpComposeBootstrapEnv(8811, repoTmp, { PATH: '/usr/bin' });
    expect(env['TASKSAIL_PYTHON_BASE_IMAGE']).toBe('mirror.internal/python:3.12-alpine');
  });

  it('lets process env win over repo .env', async () => {
    await writeFile(join(repoTmp, '.env'), 'TASKSAIL_PYTHON_BASE_IMAGE=from-file\n', 'utf-8');
    const env = await createSharedMcpComposeBootstrapEnv(8811, repoTmp, {
      PATH: '/usr/bin',
      TASKSAIL_PYTHON_BASE_IMAGE: 'from-process',
    });
    expect(env['TASKSAIL_PYTHON_BASE_IMAGE']).toBe('from-process');
  });
});
