import { readTextFile } from '../../core/index.js';
import { resolveConventionsContext } from '../conventions.js';
import { resolveCorrectionsContext } from '../corrections.js';
import { resolveReinforcementContext } from '../reinforcement.js';
import type { ResolvedContext } from '../types.js';

async function resolveOptionalOverlay(
  resolver: () => Promise<ResolvedContext>,
): Promise<ResolvedContext | undefined> {
  try {
    return await resolver();
  } catch {
    return undefined;
  }
}

async function readOptionalOverlayContent(
  resolved: ResolvedContext | undefined,
): Promise<string | undefined> {
  if (!resolved?.contextFile) {
    return undefined;
  }
  try {
    const content = await readTextFile(resolved.contextFile);
    const trimmed = content?.trim();
    return trimmed ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export async function formatRegularDaltonOverlaySections(
  contextPackDir: string | undefined,
  repoRoot: string | undefined,
): Promise<string> {
  if (!repoRoot) {
    return '';
  }

  const overlays = await Promise.all([
    resolveOptionalOverlay(() => resolveConventionsContext('dalton', contextPackDir, repoRoot)),
    resolveOptionalOverlay(() => resolveCorrectionsContext('dalton', contextPackDir, repoRoot)),
    resolveOptionalOverlay(() => resolveReinforcementContext('dalton', contextPackDir, repoRoot)),
  ]);

  const [conventions, corrections, reinforcement] = await Promise.all([
    readOptionalOverlayContent(overlays[0]),
    readOptionalOverlayContent(overlays[1]),
    readOptionalOverlayContent(overlays[2]),
  ]);

  const sections: string[] = [];
  if (conventions) {
    sections.push('---', '', '### Conventions', '', conventions, '');
  }
  if (corrections) {
    sections.push('---', '', '### Corrections', '', corrections, '');
  }
  if (reinforcement) {
    sections.push('---', '', '### Reinforcement', '', reinforcement, '');
  }

  if (sections.length === 0) {
    return '';
  }

  return [
    '## Behavioral Overlays',
    '',
    'Supplemental behavioral guidance begins below. Apply these overlays in addition to the primary task content above.',
    '',
    ...sections,
  ].join('\n');
}
