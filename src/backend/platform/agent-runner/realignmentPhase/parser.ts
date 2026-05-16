import { parseSections } from '../../workflow-policy/artifacts.js';

const REALIGNMENT_SECTION_HEADING = /^(#{2,6})\s+(.+?)[ \t]*(?:#+[ \t]*)?$/u;

export interface ParsedRealignmentAnalysis {
  failureAnalysis: string;
  rootCause: string;
  correctiveActions: string[];
  validationNotes: string;
  meetingNotes: string;
}

export function parseRealignmentAnalysis(markdown: string): ParsedRealignmentAnalysis {
  const sections = parseSections(markdown);
  mergeNestedRealignmentSections(sections, markdown);
  const failureAnalysis = requiredText(sections, 'Failure Analysis');
  const rootCause = requiredText(sections, 'Root Cause');
  const correctiveActions = requiredBullets(sections, 'Corrective Actions', 'Corrective Action');
  const validationNotes = requiredText(sections, 'Validation Notes');
  const meetingNotes = sectionText(sections, 'Meeting Notes');

  return {
    failureAnalysis,
    rootCause,
    correctiveActions,
    validationNotes,
    meetingNotes,
  };
}

function requiredText(sections: Record<string, string[]>, ...sectionNames: string[]): string {
  const value = sectionText(sections, ...sectionNames);
  if (!value) {
    throw new Error(`Realignment analysis missing required section: ${sectionNames[0]}`);
  }
  return value;
}

function requiredBullets(sections: Record<string, string[]>, ...sectionNames: string[]): string[] {
  const lines = findSectionLines(sections, sectionNames);
  const bullets = lines
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim())
    .map((line) => line.replace(/^\[[ xX]\]\s+/, '').trim())
    .filter((line) => line.length > 0);
  if (bullets.length === 0) {
    throw new Error(`Realignment analysis missing required bullets: ${sectionNames[0]}`);
  }
  return bullets;
}

function sectionText(sections: Record<string, string[]>, ...sectionNames: string[]): string {
  return findSectionLines(sections, sectionNames)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function findSectionLines(sections: Record<string, string[]>, sectionNames: string[]): string[] {
  const expected = new Set(sectionNames.map(normalizeSectionName));
  for (const [sectionName, lines] of Object.entries(sections)) {
    if (expected.has(normalizeSectionName(sectionName))) {
      return lines;
    }
  }
  return [];
}

function normalizeSectionName(sectionName: string): string {
  return sectionName
    .trim()
    .replace(/:+$/u, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function mergeNestedRealignmentSections(sections: Record<string, string[]>, markdown: string): void {
  for (const [sectionName, lines] of Object.entries(parseAnyHeadingSections(markdown))) {
    sections[sectionName] ??= lines;
  }
}

function parseAnyHeadingSections(markdown: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection: string | null = null;
  let currentLevel = 0;
  let inFence: string | null = null;

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (inFence && trimmed === inFence) {
      inFence = null;
    } else if (!inFence) {
      const fenceMatch = /^(```+|~~~+)/u.exec(trimmed);
      if (fenceMatch?.[1]) {
        inFence = fenceMatch[1];
      }
    }

    const match = inFence ? null : REALIGNMENT_SECTION_HEADING.exec(trimmed);
    if (match?.[1] && match[2]) {
      const level = match[1].length;
      if (level <= currentLevel || !currentSection) {
        currentSection = match[2];
        currentLevel = level;
        sections[currentSection] ??= [];
        continue;
      }
    }

    if (currentSection) {
      sections[currentSection]!.push(rawLine);
    }
  }

  return sections;
}
