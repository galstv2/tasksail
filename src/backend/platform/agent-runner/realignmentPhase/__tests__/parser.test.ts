import { describe, expect, it } from 'vitest';

import { parseRealignmentAnalysis } from '../parser.js';

describe('parseRealignmentAnalysis', () => {
  it('parses required sections, action bullets, optional meeting notes, and ignores behavioral guidance', () => {
    const parsed = parseRealignmentAnalysis([
      '## Failure Analysis',
      '',
      'Ron observed recurring closure gaps.',
      '',
      '## Root Cause',
      '',
      'The workflow lacked explicit validation ownership.',
      '',
      '## Corrective Actions',
      '',
      '- Add reusable validation ownership guidance.',
      '* Keep analysis abstract.',
      '',
      '## Validation Notes',
      '',
      'Validated against recent retrospectives.',
      '',
      '## Behavioral Guidance',
      '',
      '- This must not be parsed separately.',
      '',
      '## Meeting Notes',
      '',
      'Operator requested expedited handling.',
      '',
    ].join('\n'));

    expect(parsed).toEqual({
      failureAnalysis: 'Ron observed recurring closure gaps.',
      rootCause: 'The workflow lacked explicit validation ownership.',
      correctiveActions: [
        'Add reusable validation ownership guidance.',
        'Keep analysis abstract.',
      ],
      validationNotes: 'Validated against recent retrospectives.',
      meetingNotes: 'Operator requested expedited handling.',
    });
  });

  it('defaults meeting notes to empty', () => {
    const parsed = parseRealignmentAnalysis([
      '## Failure Analysis',
      'Failure.',
      '## Root Cause',
      'Cause.',
      '## Corrective Actions',
      '- Action.',
      '## Validation Notes',
      'Validated.',
    ].join('\n'));

    expect(parsed.meetingNotes).toBe('');
  });

  it('accepts numbered corrective action lists from Ron output', () => {
    const parsed = parseRealignmentAnalysis([
      '## Failure Analysis',
      'Failure.',
      '',
      '## Root Cause',
      'Cause.',
      '',
      '## Corrective Actions',
      '',
      '1. Require end-to-end proof at the true interaction boundary.',
      '2. Treat stated limitations as sign-off risks.',
      '',
      '## Validation Notes',
      'Validated.',
    ].join('\n'));

    expect(parsed.correctiveActions).toEqual([
      'Require end-to-end proof at the true interaction boundary.',
      'Treat stated limitations as sign-off risks.',
    ]);
  });

  it('accepts nested headings, heading case differences, and trailing colons', () => {
    const parsed = parseRealignmentAnalysis([
      '### Failure analysis:',
      'Failure.',
      '',
      '### ROOT CAUSE',
      'Cause.',
      '',
      '### Corrective Actions:',
      '- Action.',
      '',
      '### validation notes:',
      'Validated.',
      '',
      '### meeting notes:',
      'Notes.',
    ].join('\n'));

    expect(parsed).toEqual({
      failureAnalysis: 'Failure.',
      rootCause: 'Cause.',
      correctiveActions: ['Action.'],
      validationNotes: 'Validated.',
      meetingNotes: 'Notes.',
    });
  });

  it('accepts singular corrective action heading and checkbox bullets', () => {
    const parsed = parseRealignmentAnalysis([
      '## Failure Analysis',
      'Failure.',
      '## Root Cause',
      'Cause.',
      '## Corrective Action',
      '- [ ] Add validation ownership guidance.',
      '- [x] Keep analysis abstract.',
      '## Validation Notes',
      'Validated.',
    ].join('\n'));

    expect(parsed.correctiveActions).toEqual([
      'Add validation ownership guidance.',
      'Keep analysis abstract.',
    ]);
  });

  it.each([
    ['Failure Analysis'],
    ['Root Cause'],
    ['Validation Notes'],
  ])('rejects an empty %s section', (sectionName) => {
    const markdown = [
      '## Failure Analysis',
      sectionName === 'Failure Analysis' ? '' : 'Failure.',
      '## Root Cause',
      sectionName === 'Root Cause' ? '' : 'Cause.',
      '## Corrective Actions',
      '- Action.',
      '## Validation Notes',
      sectionName === 'Validation Notes' ? '' : 'Validated.',
    ].join('\n');

    expect(() => parseRealignmentAnalysis(markdown)).toThrow(
      `Realignment analysis missing required section: ${sectionName}`,
    );
  });

  it('requires at least one corrective action bullet', () => {
    expect(() => parseRealignmentAnalysis([
      '## Failure Analysis',
      'Failure.',
      '## Root Cause',
      'Cause.',
      '## Corrective Actions',
      'Action without bullet.',
      '## Validation Notes',
      'Validated.',
    ].join('\n'))).toThrow('Realignment analysis missing required bullets: Corrective Actions');
  });
});
