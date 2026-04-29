import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('backend platform tsconfig', () => {
  it('includes cli-provider in the backend compile surface', () => {
    const tsconfigPath = path.resolve('src/backend/platform/tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8')) as { include?: string[] };

    expect(tsconfig.include).toContain('cli-provider');
  });
});
