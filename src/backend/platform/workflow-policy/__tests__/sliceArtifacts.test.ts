import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  describeSliceArtifactFormat,
  listSliceArtifactFiles,
  listWrongFormatSliceFiles,
  sliceIdFromFilename,
  normalizeParallelSliceReference,
  parseSliceArtifactContent,
  repairXmlSliceStructure,
  missingRequiredSliceFields,
  missingRequiredAttributeFields,
  extractSliceValidationCommands,
} from '../sliceArtifacts.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal complete XML slice — all required fields populated. */
const COMPLETE_XML_SLICE = `<?xml version="1.0" encoding="UTF-8"?>
<executionSlice id="slice-1" version="1.0">
  <metadata>
    <format>xml</format>
    <sliceId>slice-1</sliceId>
    <title required="true"><![CDATA[
Implement foo feature
    ]]></title>
    <status>draft</status>
  </metadata>
  <sourceTrace>
    <implementationSpecPath>AgentWorkSpace/tasks/task-001/handoffs/implementation-spec.md</implementationSpecPath>
    <notes><![CDATA[
None
    ]]></notes>
  </sourceTrace>
  <objective>
    <purpose required="true"><![CDATA[
Add foo support to bar module so it can handle baz inputs.
    ]]></purpose>
    <inputsToRead required="true"><![CDATA[
src/backend/foo.ts, src/backend/bar.ts
    ]]></inputsToRead>
  </objective>
  <dependenciesAndOrder>
    <dependsOn required="true"><![CDATA[
None
    ]]></dependsOn>
  </dependenciesAndOrder>
  <executionScope>
    <scope required="true"><![CDATA[
Add foo method to bar module. Handle baz input validation.
    ]]></scope>
    <currentSymbols required="true"><![CDATA[
Bar
    ]]></currentSymbols>
    <includedSymbols required="true"><![CDATA[
Bar
    ]]></includedSymbols>
    <excludedSymbols required="true"><![CDATA[
None
    ]]></excludedSymbols>
    <requirementCoverage required="true"><![CDATA[
CR-001
    ]]></requirementCoverage>
    <allowedChanges required="true"><![CDATA[
src/backend/bar.ts, src/backend/__tests__/bar.test.ts
    ]]></allowedChanges>
    <outOfScope required="true"><![CDATA[
NOT: database migrations, UI changes
    ]]></outOfScope>
    <preservedBehavior required="true"><![CDATA[
Existing bar API remains unchanged
    ]]></preservedBehavior>
  </executionScope>
  <implementation>
    <requiredChanges required="true"><![CDATA[
1. Add foo method to Bar class
2. Add unit tests
    ]]></requiredChanges>
  </implementation>
  <filesAndInterfaces>
    <files required="true"><![CDATA[
src/backend/bar.ts - new foo method
src/backend/__tests__/bar.test.ts - unit tests
    ]]></files>
    <unitTests required="true"><![CDATA[
src/backend/__tests__/bar.test.ts - tests for foo method
    ]]></unitTests>
  </filesAndInterfaces>
  <acceptanceAndValidation>
    <acceptanceCriteria required="true"><![CDATA[
- foo method returns correct result for baz input
    ]]></acceptanceCriteria>
    <validationCommands required="true"><![CDATA[
\`\`\`bash
pnpm test
\`\`\`
    ]]></validationCommands>
    <staleAssumptionHandling required="true"><![CDATA[
If bar.ts moved, find current location and update accordingly.
    ]]></staleAssumptionHandling>
  </acceptanceAndValidation>
  <guardsAndCoordination>
    <guards required="true"><![CDATA[
None
    ]]></guards>
    <coordination required="true"><![CDATA[
None
    ]]></coordination>
    <closeoutRequirements required="true"><![CDATA[
Report: files changed, tests run, validation results
    ]]></closeoutRequirements>
  </guardsAndCoordination>
</executionSlice>`;

/** Complete markdown slice fixture. */
const COMPLETE_MARKDOWN_SLICE = `# slice-1

## Purpose

Add foo support to bar module.

## Depends On

None

## Scope

Full implementation of foo.

### Current Symbols

Bar

### Included Symbols

Bar

### Excluded Symbols

None

## Files

- src/backend/bar.ts
- src/backend/__tests__/bar.test.ts

## Acceptance Criteria

- foo returns the correct result

## Unit Tests

src/backend/__tests__/bar.test.ts

## Validation Commands

\`\`\`bash
pnpm test
\`\`\`

## Guards

None
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'slice-artifacts-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function writeFile(dir: string, name: string, content: string): string {
  const fullPath = path.join(dir, name);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

// ---------------------------------------------------------------------------
// describeSliceArtifactFormat
// ---------------------------------------------------------------------------

describe('describeSliceArtifactFormat', () => {
  it('returns markdown descriptor for markdown format', () => {
    const desc = describeSliceArtifactFormat('markdown');
    expect(desc.format).toBe('markdown');
    expect(desc.extension).toBe('.md');
    expect(desc.templateFilename).toBe('slice-template.md');
    expect(desc.displayGlob).toBe('slice-*.md');
    expect(desc.filenamePattern.test('slice-1.md')).toBe(true);
    expect(desc.filenamePattern.test('slice-10.md')).toBe(true);
    expect(desc.filenamePattern.test('slice-1.xml')).toBe(false);
    expect(desc.filenamePattern.test('slice-template.md')).toBe(false);
  });

  it('returns xml descriptor for xml format', () => {
    const desc = describeSliceArtifactFormat('xml');
    expect(desc.format).toBe('xml');
    expect(desc.extension).toBe('.xml');
    expect(desc.templateFilename).toBe('slice-template.xml');
    expect(desc.displayGlob).toBe('slice-*.xml');
    expect(desc.filenamePattern.test('slice-1.xml')).toBe(true);
    expect(desc.filenamePattern.test('slice-10.xml')).toBe(true);
    expect(desc.filenamePattern.test('slice-1.md')).toBe(false);
    expect(desc.filenamePattern.test('slice-template.xml')).toBe(false);
  });

  it('markdown filenamePattern rejects slice-0.md', () => {
    const desc = describeSliceArtifactFormat('markdown');
    expect(desc.filenamePattern.test('slice-0.md')).toBe(false);
  });

  it('xml filenamePattern rejects slice-0.xml', () => {
    const desc = describeSliceArtifactFormat('xml');
    expect(desc.filenamePattern.test('slice-0.xml')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listSliceArtifactFiles
// ---------------------------------------------------------------------------

describe('listSliceArtifactFiles', () => {
  it('lists only slice-N.md files in markdown mode, excluding templates', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-1.md', '');
    writeFile(dir, 'slice-2.md', '');
    writeFile(dir, 'slice-template.md', '');  // excluded
    writeFile(dir, 'slice-1.xml', '');         // wrong format
    writeFile(dir, 'other.md', '');            // not a slice

    const files = await listSliceArtifactFiles(dir, 'markdown');
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(['slice-1.md', 'slice-2.md']);
  });

  it('lists only slice-N.xml files in xml mode, excluding templates', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-1.xml', '');
    writeFile(dir, 'slice-2.xml', '');
    writeFile(dir, 'slice-template.xml', '');  // excluded
    writeFile(dir, 'slice-1.md', '');           // wrong format
    writeFile(dir, 'other.xml', '');            // not a slice

    const files = await listSliceArtifactFiles(dir, 'xml');
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(['slice-1.xml', 'slice-2.xml']);
  });

  it('returns empty array when directory does not exist', async () => {
    const files = await listSliceArtifactFiles('/nonexistent-dir-12345', 'markdown');
    expect(files).toEqual([]);
  });

  it('returns sorted results', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-3.xml', '');
    writeFile(dir, 'slice-1.xml', '');
    writeFile(dir, 'slice-2.xml', '');

    const files = await listSliceArtifactFiles(dir, 'xml');
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(['slice-1.xml', 'slice-2.xml', 'slice-3.xml']);
  });
});

// ---------------------------------------------------------------------------
// listWrongFormatSliceFiles
// ---------------------------------------------------------------------------

describe('listWrongFormatSliceFiles', () => {
  it('in xml mode, finds stray slice-N.md files, excludes templates', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-1.md', '');
    writeFile(dir, 'slice-template.md', '');  // excluded
    writeFile(dir, 'slice-1.xml', '');         // correct format, excluded
    writeFile(dir, 'slice-2.xml', '');         // correct format, excluded

    const files = await listWrongFormatSliceFiles(dir, 'xml');
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(['slice-1.md']);
  });

  it('in markdown mode, finds stray slice-N.xml files, excludes templates', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-1.xml', '');
    writeFile(dir, 'slice-template.xml', '');  // excluded
    writeFile(dir, 'slice-1.md', '');           // correct format, excluded

    const files = await listWrongFormatSliceFiles(dir, 'markdown');
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(['slice-1.xml']);
  });

  it('returns empty array when no wrong-format files exist', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-1.xml', '');

    const files = await listWrongFormatSliceFiles(dir, 'xml');
    expect(files).toEqual([]);
  });

  it('returns empty array when directory does not exist', async () => {
    const files = await listWrongFormatSliceFiles('/nonexistent-dir-12345', 'xml');
    expect(files).toEqual([]);
  });

  it('excludes slice-template.md from wrong-format detection in xml mode', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-template.md', '');

    const files = await listWrongFormatSliceFiles(dir, 'xml');
    expect(files).toEqual([]);
  });

  it('excludes slice-template.xml from wrong-format detection in markdown mode', async () => {
    const dir = makeTmpDir();
    writeFile(dir, 'slice-template.xml', '');

    const files = await listWrongFormatSliceFiles(dir, 'markdown');
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sliceIdFromFilename
// ---------------------------------------------------------------------------

describe('sliceIdFromFilename', () => {
  it('extracts slice-N from a .md path in markdown mode', () => {
    expect(sliceIdFromFilename('/some/dir/slice-1.md', 'markdown')).toBe('slice-1');
    expect(sliceIdFromFilename('/some/dir/slice-10.md', 'markdown')).toBe('slice-10');
  });

  it('extracts slice-N from a .xml path in xml mode', () => {
    expect(sliceIdFromFilename('/some/dir/slice-1.xml', 'xml')).toBe('slice-1');
    expect(sliceIdFromFilename('/some/dir/slice-10.xml', 'xml')).toBe('slice-10');
  });

  it('handles filename-only paths', () => {
    expect(sliceIdFromFilename('slice-3.md', 'markdown')).toBe('slice-3');
    expect(sliceIdFromFilename('slice-3.xml', 'xml')).toBe('slice-3');
  });

  it('strips the correct extension for the given format', () => {
    // .xml path given to markdown mode: strips .xml via fallback
    expect(sliceIdFromFilename('slice-1.xml', 'markdown')).toBe('slice-1');
  });
});

// ---------------------------------------------------------------------------
// normalizeParallelSliceReference
// ---------------------------------------------------------------------------

describe('normalizeParallelSliceReference', () => {
  it('markdown mode strips .md suffix', () => {
    expect(normalizeParallelSliceReference('slice-1.md', 'markdown')).toBe('slice-1');
    expect(normalizeParallelSliceReference('slice-1', 'markdown')).toBe('slice-1');
  });

  it('xml mode accepts bare slice-N (no suffix)', () => {
    expect(normalizeParallelSliceReference('slice-1', 'xml')).toBe('slice-1');
  });

  it('xml mode accepts slice-N.xml and strips .xml', () => {
    expect(normalizeParallelSliceReference('slice-1.xml', 'xml')).toBe('slice-1');
  });

  it('xml mode rejects slice-N.md by returning an empty (dropped) reference', () => {
    // A wrong-format .md reference must not normalize to the bare id, which would
    // silently match the existing slice-N.xml. Returning '' lets callers drop it.
    expect(normalizeParallelSliceReference('slice-1.md', 'xml')).toBe('');
  });

  it('markdown mode does not strip .xml', () => {
    // .xml in a markdown context isn't stripped — it's simply not a valid ref
    const result = normalizeParallelSliceReference('slice-1.xml', 'markdown');
    expect(result).not.toContain('.md');
  });
});

// ---------------------------------------------------------------------------
// parseSliceArtifactContent — markdown
// ---------------------------------------------------------------------------

describe('parseSliceArtifactContent (markdown)', () => {
  it('parses a complete markdown slice and populates requiredFields', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.md',
      text: COMPLETE_MARKDOWN_SLICE,
      format: 'markdown',
    });
    expect(content.sliceId).toBe('slice-1');
    expect(content.text).toBe(COMPLETE_MARKDOWN_SLICE);
    // Has required section content
    expect(content.requiredFields['purpose']).toBeTruthy();
    expect(content.requiredFields['scope']).toBeTruthy();
    expect(content.requiredFields['current-symbols']).toBe('Bar');
    expect(content.requiredFields['included-symbols']).toBe('Bar');
    expect(content.requiredFields['excluded-symbols']).toBe('None');
    expect(content.requiredFields['files']).toBeTruthy();
    expect(content.requiredFields['acceptance-criteria']).toBeTruthy();
    expect(content.requiredFields['validation-commands']).toBeTruthy();
  });

  it('validationSurfaceText combines acceptance-criteria and validation-commands for markdown', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.md',
      text: COMPLETE_MARKDOWN_SLICE,
      format: 'markdown',
    });
    expect(content.validationSurfaceText).toContain('foo returns');
    expect(content.validationCommandsText).toContain('pnpm test');
  });
});

// ---------------------------------------------------------------------------
// parseSliceArtifactContent — XML
// ---------------------------------------------------------------------------

describe('parseSliceArtifactContent (xml)', () => {
  it('parses a complete XML slice', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    expect(content.sliceId).toBe('slice-1');
    expect(content.requiredFields['metadata/title']).toContain('foo feature');
    expect(content.requiredFields['objective/purpose']).toContain('foo support');
    expect(content.requiredFields['acceptanceAndValidation/validationCommands']).toContain('pnpm test');
  });

  it('validationSurfaceText includes acceptanceCriteria and validationCommands', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    expect(content.validationSurfaceText).toContain('pnpm test');
    expect(content.validationSurfaceText).toContain('foo method returns correct result');
  });

  it('validationCommandsText contains only validationCommands element body', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    expect(content.validationCommandsText).toContain('pnpm test');
    // should not include acceptance criteria text
    expect(content.validationCommandsText).not.toContain('foo returns');
  });

  it('decodes CDATA markers from field bodies', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    // CDATA wrappers should not appear in requiredFields values
    expect(content.requiredFields['metadata/title']).not.toContain('CDATA');
    expect(content.requiredFields['metadata/title']).not.toContain(']]>');
  });

  it('decodes XML entities (&lt; &gt; &amp; &quot; &apos;)', () => {
    const xmlWithEntities = COMPLETE_XML_SLICE.replace(
      /Add foo support to bar module so it can handle baz inputs\./,
      'Handle &lt;foo&gt; &amp; &quot;bar&quot; &apos;baz&apos; inputs.',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: xmlWithEntities,
      format: 'xml',
    });
    expect(content.requiredFields['objective/purpose']).toContain('<foo>');
    expect(content.requiredFields['objective/purpose']).toContain('&');
    expect(content.requiredFields['objective/purpose']).toContain('"bar"');
    expect(content.requiredFields['objective/purpose']).toContain("'baz'");
  });

  it('strips XML comments from field bodies', () => {
    const xmlWithComment = COMPLETE_XML_SLICE.replace(
      /Add foo support to bar module so it can handle baz inputs\./,
      '<!-- this is a comment -->Add foo support.',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: xmlWithComment,
      format: 'xml',
    });
    // The comment is stripped in the text but the body still has content
    expect(content.requiredFields['objective/purpose']).toContain('Add foo support');
  });

  it('sourceTrace/notes as None is not included in requiredFields', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    // sourceTrace fields are not in XML_REQUIRED_FIELD_PATHS
    expect(Object.keys(content.requiredFields)).not.toContain('sourceTrace/notes');
    expect(Object.keys(content.requiredFields)).not.toContain('sourceTrace/implementationSpecPath');
  });
});

// ---------------------------------------------------------------------------
// missingRequiredSliceFields
// ---------------------------------------------------------------------------

describe('missingRequiredSliceFields', () => {
  it('returns empty array for a complete XML slice', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).toEqual([]);
  });

  it('flags missing XML source-inventory elements (markdown/xml parity)', () => {
    const noCurrent = COMPLETE_XML_SLICE.replace(/<currentSymbols[\s\S]*?<\/currentSymbols>/, '');
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: noCurrent,
      format: 'xml',
    });
    expect(missingRequiredSliceFields(content)).toContain('executionScope/currentSymbols');
  });

  it('accepts the template shape: plain-text prose fields, CDATA only for validationCommands', () => {
    const plainTextSlice = `<?xml version="1.0" encoding="UTF-8"?>
<executionSlice id="slice-1" version="1.0">
  <metadata>
    <format>xml</format>
    <sliceId>slice-1</sliceId>
    <title required="true">Implement foo feature</title>
    <status>draft</status>
  </metadata>
  <sourceTrace>
    <implementationSpecPath>AgentWorkSpace/tasks/t/handoffs/implementation-spec.md</implementationSpecPath>
    <notes>None</notes>
  </sourceTrace>
  <objective>
    <purpose required="true">Add foo support to bar module.</purpose>
    <inputsToRead required="true">src/backend/bar.ts</inputsToRead>
  </objective>
  <dependenciesAndOrder>
    <dependsOn required="true">None</dependsOn>
  </dependenciesAndOrder>
  <executionScope>
    <scope required="true">Add a foo() method; guard when count &lt; 10 and A &amp; B both hold.</scope>
    <currentSymbols required="true">Bar</currentSymbols>
    <includedSymbols required="true">Bar</includedSymbols>
    <excludedSymbols required="true">None</excludedSymbols>
    <requirementCoverage required="true">CR-001</requirementCoverage>
    <allowedChanges required="true">src/backend/bar.ts</allowedChanges>
    <outOfScope required="true">NOT: database migrations</outOfScope>
    <preservedBehavior required="true">Existing bar API unchanged</preservedBehavior>
  </executionScope>
  <implementation>
    <requiredChanges required="true">1. Add foo method to bar.ts</requiredChanges>
  </implementation>
  <filesAndInterfaces>
    <files required="true">src/backend/bar.ts - new foo method</files>
    <unitTests required="true">src/backend/__tests__/bar.test.ts</unitTests>
  </filesAndInterfaces>
  <acceptanceAndValidation>
    <acceptanceCriteria required="true">- foo returns correct result</acceptanceCriteria>
    <validationCommands required="true"><![CDATA[
\`\`\`bash
pnpm test
\`\`\`
    ]]></validationCommands>
    <staleAssumptionHandling required="true">Find bar.ts if moved.</staleAssumptionHandling>
  </acceptanceAndValidation>
  <guardsAndCoordination>
    <guards required="true">None</guards>
    <coordination required="true">None</coordination>
    <closeoutRequirements required="true">Report files changed.</closeoutRequirements>
  </guardsAndCoordination>
</executionSlice>`;
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: plainTextSlice,
      format: 'xml',
    });
    // Plain-text prose fields validate as complete — no CDATA required.
    expect(missingRequiredSliceFields(content)).toEqual([]);
    // Escaped entities in prose decode back to literal characters.
    expect(content.requiredFields['executionScope/scope']).toContain('count < 10');
    expect(content.requiredFields['executionScope/scope']).toContain('A & B');
    // validationCommands keeps CDATA and still extracts.
    expect(extractSliceValidationCommands({ text: plainTextSlice, format: 'xml' }).join('\n')).toContain('pnpm test');
  });

  it('accepts a prose field wrapped in CDATA when it carries a code snippet with < > &', () => {
    const slice = COMPLETE_XML_SLICE.replace(
      /<scope required="true">[\s\S]*?<\/scope>/,
      '<scope required="true"><![CDATA[Add foo<T>(x: T): T; guard when count < 10 && flag. See `bar()`.]]></scope>',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: slice,
      format: 'xml',
    });
    // CDATA-wrapped code in a prose field validates as complete and round-trips literally.
    expect(missingRequiredSliceFields(content)).toEqual([]);
    expect(content.requiredFields['executionScope/scope']).toContain('foo<T>(x: T): T');
    expect(content.requiredFields['executionScope/scope']).toContain('count < 10 && flag');
  });

  it('reports missing element when required field is absent', () => {
    // Remove the title element entirely
    const noTitle = COMPLETE_XML_SLICE.replace(
      /<title required="true">[\s\S]*?<\/title>/,
      '',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: noTitle,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).toContain('metadata/title');
  });

  it('reports field as missing when body is placeholder-only (template comment)', () => {
    const templateCommentSlice = COMPLETE_XML_SLICE.replace(
      /<title required="true"><!\[CDATA\[\s*\nImplement foo feature\s*\n\s*\]\]><\/title>/,
      '<title required="true"><![CDATA[\n<!-- concise slice title; do not leave template-only -->\n    ]]></title>',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: templateCommentSlice,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).toContain('metadata/title');
  });

  it('reports field as missing when body is whitespace-only', () => {
    const whitespaceSlice = COMPLETE_XML_SLICE.replace(
      /Add foo support to bar module so it can handle baz inputs\./,
      '   ',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: whitespaceSlice,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).toContain('objective/purpose');
  });

  it('reports field as missing when body is a placeholder token', () => {
    const placeholderSlice = COMPLETE_XML_SLICE.replace(
      /Add foo support to bar module so it can handle baz inputs\./,
      'tbd',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: placeholderSlice,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).toContain('objective/purpose');
  });

  it('sourceTrace is not included in missingRequiredSliceFields even when notes is None/comment-only', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    // sourceTrace fields must not appear in missing list
    expect(missing).not.toContain('sourceTrace/notes');
    expect(missing).not.toContain('sourceTrace/implementationSpecPath');
  });

  it('reports validationCommands as missing when fenced block is empty', () => {
    const emptyFencedSlice = COMPLETE_XML_SLICE.replace(
      /pnpm test/,
      '# commands here',
    );
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: emptyFencedSlice,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).toContain('acceptanceAndValidation/validationCommands');
  });

  it('does not report validationCommands as missing when fenced block has actual commands', () => {
    const content = parseSliceArtifactContent({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    const missing = missingRequiredSliceFields(content);
    expect(missing).not.toContain('acceptanceAndValidation/validationCommands');
  });
});

// ---------------------------------------------------------------------------
// missingRequiredAttributeFields
// ---------------------------------------------------------------------------

describe('missingRequiredAttributeFields', () => {
  it('returns empty when every required leaf element carries required="true"', () => {
    expect(missingRequiredAttributeFields(COMPLETE_XML_SLICE)).toEqual([]);
  });

  it('flags a required field whose leaf element is missing required="true"', () => {
    const stripped = COMPLETE_XML_SLICE.replace(
      '<title required="true">',
      '<title>',
    );
    const missing = missingRequiredAttributeFields(stripped);
    expect(missing).toContain('metadata/title');
    expect(missing).toHaveLength(1);
  });

  it('does not double-report a fully absent required element (body check owns that)', () => {
    const withoutTitle = COMPLETE_XML_SLICE
      .replace(/<title required="true">[\s\S]*?<\/title>/, '');
    expect(missingRequiredAttributeFields(withoutTitle)).not.toContain('metadata/title');
  });
});

// ---------------------------------------------------------------------------
// extractSliceValidationCommands
// ---------------------------------------------------------------------------

describe('extractSliceValidationCommands', () => {
  it('extracts commands from markdown validation-commands section', () => {
    const commands = extractSliceValidationCommands({
      text: COMPLETE_MARKDOWN_SLICE,
      format: 'markdown',
    });
    expect(commands).toContain('pnpm test');
  });

  it('extracts commands from XML validationCommands CDATA', () => {
    const commands = extractSliceValidationCommands({
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    expect(commands).toContain('pnpm test');
  });

  it('returns empty array when markdown slice has no validation commands section', () => {
    const noValCmds = '# slice-1\n\n## Purpose\n\nSome content\n';
    const commands = extractSliceValidationCommands({
      text: noValCmds,
      format: 'markdown',
    });
    expect(commands).toEqual([]);
  });

  it('returns empty array when xml slice has no validationCommands element', () => {
    const noValCmds = COMPLETE_XML_SLICE.replace(
      /<validationCommands required="true">[\s\S]*?<\/validationCommands>/,
      '',
    );
    const commands = extractSliceValidationCommands({
      text: noValCmds,
      format: 'xml',
    });
    expect(commands).toEqual([]);
  });

  it('extracts multiple commands from multiple fenced blocks in markdown', () => {
    const multiCmd = COMPLETE_MARKDOWN_SLICE.replace(
      '```bash\npnpm test\n```',
      '```bash\npnpm test\n```\n\n```bash\npnpm lint\n```',
    );
    const commands = extractSliceValidationCommands({
      text: multiCmd,
      format: 'markdown',
    });
    expect(commands).toContain('pnpm test');
    expect(commands).toContain('pnpm lint');
  });

  it('xml extraction reads ONLY acceptanceAndValidation/validationCommands, not acceptanceCriteria', () => {
    const commands = extractSliceValidationCommands({
      text: COMPLETE_XML_SLICE,
      format: 'xml',
    });
    // Should only contain commands, not acceptance criteria text
    expect(commands).not.toContain('foo returns the correct result');
  });
});

// ---------------------------------------------------------------------------
// repairXmlSliceStructure
// ---------------------------------------------------------------------------

describe('repairXmlSliceStructure', () => {
  it('returns repaired:false and original text when no issues found', () => {
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: COMPLETE_XML_SLICE,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(false);
    expect(result.reason).toContain('no structural');
  });

  it('rejects markdown files', () => {
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.md',
      text: COMPLETE_XML_SLICE,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(false);
    expect(result.reason).toContain('markdown');
  });

  it('rejects text without executionSlice element', () => {
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: '<?xml version="1.0"?><someOtherRoot/>',
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(false);
    expect(result.reason).toContain('executionSlice');
  });

  it('rejects text with markdown headings (## pattern) mixed with executionSlice', () => {
    // Contains executionSlice tag but also markdown heading structure
    const mixedContent = '<executionSlice id="slice-1">\n## Purpose\n\nSome content\n</executionSlice>';
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: mixedContent,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(false);
    expect(result.reason).toContain('markdown');
  });

  it('adds missing XML declaration', () => {
    const noDecl = COMPLETE_XML_SLICE.replace(XML_DECLARATION_RE_LITERAL, '');
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: noDecl,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(true);
    expect(result.text).toContain('<?xml');
  });

  it('adds missing id attribute to executionSlice', () => {
    const noId = COMPLETE_XML_SLICE.replace(
      '<executionSlice id="slice-1" version="1.0">',
      '<executionSlice version="1.0">',
    );
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: noId,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(true);
    expect(result.text).toContain('id="slice-1"');
  });

  it('fixes wrong id attribute on executionSlice', () => {
    const wrongId = COMPLETE_XML_SLICE.replace(
      'id="slice-1"',
      'id="slice-99"',
    );
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: wrongId,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(true);
    expect(result.text).toContain('id="slice-1"');
    expect(result.text).not.toContain('id="slice-99"');
  });

  it('adds missing closing tag', () => {
    const noClose = COMPLETE_XML_SLICE.replace('</executionSlice>', '');
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: noClose,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(true);
    expect(result.text).toContain('</executionSlice>');
  });

  it('rejects ambiguous duplicate required fields', () => {
    // Insert a duplicate <title> element
    const duplicateTitle = COMPLETE_XML_SLICE.replace(
      '</metadata>',
      '<title required="true"><![CDATA[duplicate]]></title>\n  </metadata>',
    );
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.xml',
      text: duplicateTitle,
      expectedSliceId: 'slice-1',
    });
    expect(result.repaired).toBe(false);
    expect(result.reason).toContain('ambiguous');
  });

  it('does not modify the original text when repair fails', () => {
    const result = repairXmlSliceStructure({
      filePath: '/steps/slice-1.md',
      text: 'some text',
      expectedSliceId: 'slice-1',
    });
    expect(result.text).toBe('some text');
  });
});

// ---------------------------------------------------------------------------
// Regex helper used in repair tests
// ---------------------------------------------------------------------------
const XML_DECLARATION_RE_LITERAL = /^<\?xml[^?]*\?>\s*/;
