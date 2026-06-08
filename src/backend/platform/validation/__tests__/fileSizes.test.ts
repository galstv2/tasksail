import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadBaseline } from '../fileSizes.js';

describe('loadBaseline', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-sizes-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('parses pmseline file correctly', async () => {
    const pmselinePath = path.join(tmpDir, 'pmseline.txt');
    await fs.promises.writeFile(pmselinePath, [
      '# Comment line',
      '500 src/app.py',
      '1000 scripts/deploy.sh',
      '',
      '750 src/index.ts',
    ].join('\n'));

    const map = await loadBaseline(pmselinePath);
    expect(map.size).toBe(3);
    expect(map.get('src/app.py')).toBe(500);
    expect(map.get('scripts/deploy.sh')).toBe(1000);
    expect(map.get('src/index.ts')).toBe(750);
  });

  it('returns empty map for missing file', async () => {
    const map = await loadBaseline(path.join(tmpDir, 'nonexistent.txt'));
    expect(map.size).toBe(0);
  });
});
