import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  enumerateProductionRendererCssFiles,
  findCssColorLiterals,
  formatCssColorLiteralViolations,
  scanCssFiles,
  scanProductionRendererCss,
  stripCssComments,
} from '../cssColorTokenDiscipline';

describe('css color token discipline scanner', () => {
  it('strips CSS comments without shifting literal line reporting', () => {
    const filePath = path.join(process.cwd(), 'src/renderer/styles/comment-fixture.css');
    const css = [
      '.tokenized { color: var(--ts-text); }',
      '/* .commented { color: #fff; }',
      '   .also-commented { background: rgba(0, 0, 0, 0.2); } */',
      '.literal {',
      '  background: rgb(1, 2, 3);',
      '}',
    ].join('\n');

    const stripped = stripCssComments(css);
    const violations = findCssColorLiterals(css, { filePath, rootDir: process.cwd() });

    expect(stripped.split('\n')).toHaveLength(css.split('\n').length);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      line: 5,
      match: 'rgb(1, 2, 3)',
      declaration: 'background: rgb(1, 2, 3);',
    });
  });

  it('excludes variables.css from filesystem scans', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'tasksail-css-token-'));

    try {
      const stylesDir = path.join(tempRoot, 'styles');
      mkdirSync(stylesDir);
      writeFileSync(path.join(stylesDir, 'variables.css'), ':root { --ts-fixture: #fff; }\n');
      writeFileSync(path.join(stylesDir, 'product.css'), '.product { color: #123456; }\n');

      const files = enumerateProductionRendererCssFiles(stylesDir);
      const violations = scanCssFiles(files, { rootDir: tempRoot });

      expect(files.map((filePath) => path.basename(filePath))).toEqual(['product.css']);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        relativePath: path.join('styles', 'product.css'),
        match: '#123456',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('detects literal fallback colors inside var calls', () => {
    const filePath = path.join(process.cwd(), 'src/renderer/styles/fallback-fixture.css');
    const css = '.fallback { color: var(--ts-success, #22c55e); }\n';

    const violations = findCssColorLiterals(css, { filePath, rootDir: process.cwd() });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      match: '#22c55e',
      declaration: 'color: var(--ts-success, #22c55e);',
    });
  });

  it('detects named color literals without flagging token names, urls, or strings', () => {
    const filePath = path.join(process.cwd(), 'src/renderer/styles/named-color-fixture.css');
    const css = [
      '.named {',
      '  color: white;',
      '  background: rebeccapurple;',
      '  border-color: var(--ts-brand-gray);',
      '  background-image: url("/assets/white-icon.svg");',
      '  content: "black";',
      '}',
    ].join('\n');

    const violations = findCssColorLiterals(css, { filePath, rootDir: process.cwd() });

    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.match)).toEqual(['white', 'rebeccapurple']);
    expect(violations[0]).toMatchObject({
      line: 2,
      declaration: 'color: white;',
    });
    expect(violations[1]).toMatchObject({
      line: 3,
      declaration: 'background: rebeccapurple;',
    });
  });

  it('reports file, line, declaration, and match text', () => {
    const filePath = path.join(process.cwd(), 'src/renderer/styles/reporting-fixture.css');
    const css = [
      '.safe { color: var(--ts-text); }',
      '.literal {',
      '  border-color: hsl(12 50% 50%);',
      '}',
    ].join('\n');

    const violations = findCssColorLiterals(css, { filePath, rootDir: process.cwd() });
    const report = formatCssColorLiteralViolations(violations);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      relativePath: path.join('src', 'renderer', 'styles', 'reporting-fixture.css'),
      line: 3,
      column: 17,
      match: 'hsl(12 50% 50%)',
      declaration: 'border-color: hsl(12 50% 50%);',
    });
    expect(report).toContain(
      `${path.join('src', 'renderer', 'styles', 'reporting-fixture.css')}:3:17 hsl(12 50% 50%) :: border-color: hsl(12 50% 50%);`,
    );
  });
});

it('production renderer CSS has zero color literals outside variables.css', () => {
  const violations = scanProductionRendererCss();

  expect(violations, formatCssColorLiteralViolations(violations)).toHaveLength(0);
});
