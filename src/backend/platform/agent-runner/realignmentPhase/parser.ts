import { parseSections } from '../../workflow-policy/artifacts.js';

export interface ParsedRealignmentAnalysis {
  failureAnalysis: string;
  rootCause: string;
  correctiveActions: string[];
  validationNotes: string;
  meetingNotes: string;
}

export function parseRealignmentAnalysis(markdown: string): ParsedRealignmentAnalysis {
  const sections = parseSections(markdown);
  const failureAnalysis = requiredText(sections, 'Failure Analysis');
  const rootCause = requiredText(sections, 'Root Cause');
  const correctiveActions = requiredBullets(sections, 'Corrective Actions');
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

function requiredText(sections: Record<string, string[]>, sectionName: string): string {
  const value = sectionText(sections, sectionName);
  if (!value) {
    throw new Error(`Realignment analysis missing required section: ${sectionName}`);
  }
  return value;
}

function requiredBullets(sections: Record<string, string[]>, sectionName: string): string[] {
  const bullets = (sections[sectionName] ?? [])
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);
  if (bullets.length === 0) {
    throw new Error(`Realignment analysis missing required bullets: ${sectionName}`);
  }
  return bullets;
}

function sectionText(sections: Record<string, string[]>, sectionName: string): string {
  return (sections[sectionName] ?? [])
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
