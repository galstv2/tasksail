import { readFileSync } from 'node:fs';
import { parseSections, parseMetadata } from '../../../src/backend/platform/workflow-policy/artifacts.js';
import { extractTaskTitle } from '../../../src/backend/platform/queue/markdown.js';

const fixturePath = process.argv[2];
if (!fixturePath) {
  throw new Error('Fixture path is required.');
}

const text = readFileSync(fixturePath, 'utf-8');
const headings = parseSections(text);
const labels = Object.fromEntries(
  Object.entries(headings).map(([heading, lines]) => [heading, parseMetadata(lines)]),
);

console.log(JSON.stringify({ headings, labels, title: extractTaskTitle(text) }));
