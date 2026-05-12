import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { canonicalize } from '../packSchemas.canonical';
import { assertManifest, assertAnswers, assertPlan } from '../packSchemas.runtime';

const FIXTURES_DIR = resolve(__dirname, '../../../../../../tests/fixtures/pack_schemas');

function loadFixtures(subdir: string): { name: string; raw: unknown }[] {
  const dir = join(FIXTURES_DIR, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      name: f,
      raw: JSON.parse(readFileSync(join(dir, f), 'utf8')),
    }));
}

describe('RepoSourcesManifest round-trip', () => {
  for (const { name, raw } of loadFixtures('manifest')) {
    it(`canonicalize is stable for ${name}`, () => {
      assertManifest(raw);
      expect(canonicalize(raw)).toBe(canonicalize(JSON.parse(JSON.stringify(raw))));
    });
  }
});

describe('BootstrapAnswers round-trip', () => {
  for (const { name, raw } of loadFixtures('answers')) {
    it(`canonicalize is stable for ${name}`, () => {
      assertAnswers(raw);
      expect(canonicalize(raw)).toBe(canonicalize(JSON.parse(JSON.stringify(raw))));
    });
  }
});

describe('SeedPlan round-trip', () => {
  for (const { name, raw } of loadFixtures('plan')) {
    it(`canonicalize is stable for ${name}`, () => {
      assertPlan(raw);
      expect(canonicalize(raw)).toBe(canonicalize(JSON.parse(JSON.stringify(raw))));
    });
  }
});

describe('canonicalize Python parity', () => {
  it('sorts nested keys recursively', () => {
    const obj = { z: 1, a: { z: 2, a: 3 } };
    const result = canonicalize(obj);
    expect(result).toBe('{\n  "a": {\n    "a": 3,\n    "z": 2\n  },\n  "z": 1\n}');
  });

  // The wire contract: Python's canonicalize output is committed as a snapshot per
  // fixture. TS asserts byte-identical output. If this fails, either (a) TS drifted
  // from Python, or (b) the fixture changed and the committed canonical snapshot
  // needs an intentional update. The Python side asserts the same snapshot, so
  // either-side drift is caught.
  for (const shape of ['manifest', 'answers', 'plan'] as const) {
    for (const { name, raw } of loadFixtures(shape)) {
      it(`TS canonicalize matches Python snapshot for ${shape}/${name}`, () => {
        const stem = name.replace(/\.json$/, '');
        const snapshotPath = join(FIXTURES_DIR, 'canonical', shape, `${stem}.canonical.txt`);
        const snapshot = readFileSync(snapshotPath, 'utf8');
        expect(canonicalize(raw)).toBe(snapshot);
      });
    }
  }
});
