import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

// Forbidden remote-font markers are assembled from fragments so this test file
// itself stays clean for the source-wide font-host grep gates, which scan the
// electron/ directory this file lives in. A literal occurrence here would fail
// those gates as a false positive.
const HOST_APIS = ['fonts', 'googleapis', 'com'].join('.');
const HOST_STATIC = ['fonts', 'gstatic', 'com'].join('.');
const PROTO_FONTS = ['https:/', '/fonts'].join('');
const DM_SPACED = ['DM', 'Sans'].join(' ');
const DM_ENCODED = ['DM', 'Sans'].join('+');

const FORBIDDEN = [HOST_APIS, HOST_STATIC, PROTO_FONTS, DM_SPACED, DM_ENCODED];

// Section D command runs vitest with cwd = desktop package root, so paths are
// relative to that root (no src/frontend/desktop/ prefix).
const readSource = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');

const SOURCES = {
  'index.html': 'index.html',
  'variables.css': 'src/renderer/styles/variables.css',
  'app/windowManager.ts': 'electron/app/windowManager.ts',
};

describe('desktop fonts are self-hosted (no remote font dependency)', () => {
  for (const [name, rel] of Object.entries(SOURCES)) {
    it(`${name} has no remote font-host or legacy remote-sans references`, () => {
      const content = readSource(rel);
      for (const marker of FORBIDDEN) {
        expect(content).not.toContain(marker);
      }
    });
  }

  it('variables.css declares local @font-face for Outfit and Source Code Pro via woff2', () => {
    const css = readSource(SOURCES['variables.css']);
    expect(css).toContain('@font-face');
    expect(css).toMatch(/font-family:\s*['"]Outfit['"]/);
    expect(css).toMatch(/font-family:\s*['"]Source Code Pro['"]/);
    expect(css).toMatch(/\.woff2/);
  });

  it("production CSP keeps font-src 'self' and drops Google font hosts", () => {
    const csp = readSource(SOURCES['app/windowManager.ts']);
    expect(csp).toMatch(/font-src 'self'/);
    for (const marker of FORBIDDEN) {
      expect(csp).not.toContain(marker);
    }
  });
});
