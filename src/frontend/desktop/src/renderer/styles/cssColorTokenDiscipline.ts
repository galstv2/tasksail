import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const COLOR_LITERAL_PATTERN =
  /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{2})?)?\b|\b(?:rgba?|hsla?)\([\s\S]*?\)/gi;
const CSS_NAMED_COLOR_LITERALS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
];
const NAMED_COLOR_LITERAL_PATTERN = new RegExp(`\\b(?:${CSS_NAMED_COLOR_LITERALS.join('|')})\\b`, 'gi');
const CSS_DECLARATION_PATTERN = /(?:^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]+)(?=;|})/g;
const CSS_CUSTOM_PROPERTY_REFERENCE_PATTERN = /--[-\w]+/g;
const CSS_STRING_PATTERN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const CSS_URL_FUNCTION_PATTERN = /\burl\([\s\S]*?\)/gi;

export interface CssColorLiteralViolation {
  filePath: string;
  relativePath: string;
  line: number;
  column: number;
  match: string;
  declaration: string;
}

interface ScanCssContentOptions {
  filePath: string;
  rootDir?: string;
}

interface ScanCssFilesOptions {
  rootDir?: string;
}

interface ScanProductionCssOptions {
  stylesDir?: string;
  rootDir?: string;
}

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

export function findCssColorLiterals(
  css: string,
  { filePath, rootDir = process.cwd() }: ScanCssContentOptions,
): CssColorLiteralViolation[] {
  const strippedCss = stripCssComments(css);
  const numericViolations = Array.from(strippedCss.matchAll(COLOR_LITERAL_PATTERN), (match) => {
    const index = match.index ?? 0;
    const location = getLineColumn(strippedCss, index);

    return {
      filePath,
      relativePath: path.relative(rootDir, filePath),
      line: location.line,
      column: location.column,
      match: match[0],
      declaration: getDeclarationText(strippedCss, index),
    };
  });

  return [
    ...numericViolations,
    ...findNamedColorLiteralViolations(strippedCss, { filePath, rootDir }),
  ].sort((a, b) => a.line - b.line || a.column - b.column);
}

export function enumerateProductionRendererCssFiles(stylesDir = resolveProductionRendererStylesDir()): string[] {
  return walkCssFiles(stylesDir)
    .filter((filePath) => path.basename(filePath) !== 'variables.css')
    .sort();
}

export function scanCssFiles(
  filePaths: string[],
  { rootDir = process.cwd() }: ScanCssFilesOptions = {},
): CssColorLiteralViolation[] {
  return filePaths.flatMap((filePath) =>
    findCssColorLiterals(readFileSync(filePath, 'utf8'), { filePath, rootDir }),
  );
}

export function scanProductionRendererCss({
  stylesDir = resolveProductionRendererStylesDir(),
  rootDir = resolveProductionRendererReportRoot(stylesDir),
}: ScanProductionCssOptions = {}): CssColorLiteralViolation[] {
  return scanCssFiles(enumerateProductionRendererCssFiles(stylesDir), { rootDir });
}

export function formatCssColorLiteralViolations(violations: CssColorLiteralViolation[]): string {
  if (violations.length === 0) {
    return 'No CSS color literals found outside variables.css.';
  }

  const affectedFiles = new Set(violations.map((violation) => violation.relativePath));

  return [
    `${violations.length} CSS color literal(s) found in ${affectedFiles.size} file(s) outside variables.css:`,
    ...violations.map(
      (violation) =>
        `${violation.relativePath}:${violation.line}:${violation.column} ${violation.match} :: ${violation.declaration}`,
    ),
  ].join('\n');
}

function resolveProductionRendererStylesDir(cwd = process.cwd()): string {
  const candidates = [
    path.resolve(cwd, 'src/renderer/styles'),
    path.resolve(cwd, 'src/frontend/desktop/src/renderer/styles'),
  ];

  return candidates.find(isDirectory) ?? candidates[0];
}

function resolveProductionRendererReportRoot(stylesDir: string): string {
  const repoRoot = path.resolve(stylesDir, '../../../../../..');
  if (isDirectory(path.join(repoRoot, 'src/frontend/desktop/src/renderer/styles'))) {
    return repoRoot;
  }

  const desktopRoot = path.resolve(stylesDir, '../../..');
  if (isDirectory(path.join(desktopRoot, 'src/renderer/styles'))) {
    return desktopRoot;
  }

  return process.cwd();
}

function walkCssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkCssFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith('.css') ? [entryPath] : [];
  });
}

function getLineColumn(text: string, index: number): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const line = prefix.split('\n').length;
  const lastLineBreak = prefix.lastIndexOf('\n');
  return {
    line,
    column: index - lastLineBreak,
  };
}

function getDeclarationText(css: string, index: number): string {
  const declarationStart =
    Math.max(css.lastIndexOf('{', index), css.lastIndexOf(';', index), css.lastIndexOf('}', index)) + 1;
  const nextSemicolon = css.indexOf(';', index);
  const nextBlockEnd = css.indexOf('}', index);
  const declarationEndCandidates = [nextSemicolon, nextBlockEnd].filter((candidate) => candidate >= 0);
  const declarationEnd =
    declarationEndCandidates.length > 0 ? Math.min(...declarationEndCandidates) + 1 : css.length;

  return css.slice(declarationStart, declarationEnd).replace(/\s+/g, ' ').trim();
}

function findNamedColorLiteralViolations(
  css: string,
  { filePath, rootDir = process.cwd() }: ScanCssContentOptions,
): CssColorLiteralViolation[] {
  return Array.from(css.matchAll(CSS_DECLARATION_PATTERN)).flatMap((declarationMatch) => {
    const value = declarationMatch[2] ?? '';
    const valueOffset = declarationMatch[0].indexOf(value);
    if (valueOffset < 0 || declarationMatch.index === undefined) return [];

    const valueStart = declarationMatch.index + valueOffset;
    const searchableValue = value
      .replace(CSS_URL_FUNCTION_PATTERN, (urlFunction) => ' '.repeat(urlFunction.length))
      .replace(CSS_STRING_PATTERN, (stringLiteral) => ' '.repeat(stringLiteral.length))
      .replace(CSS_CUSTOM_PROPERTY_REFERENCE_PATTERN, (customProperty) => ' '.repeat(customProperty.length));

    return Array.from(searchableValue.matchAll(NAMED_COLOR_LITERAL_PATTERN), (colorMatch) => {
      const matchIndex = valueStart + (colorMatch.index ?? 0);
      const location = getLineColumn(css, matchIndex);

      return {
        filePath,
        relativePath: path.relative(rootDir, filePath),
        line: location.line,
        column: location.column,
        match: colorMatch[0],
        declaration: getDeclarationText(css, matchIndex),
      };
    });
  });
}

function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}
