import type { AutonomyProfile } from '../../../core/index.js';

export const REPO_EXECUTOR_DENY_FLOOR: readonly string[] = [
  'shell(git add)',
  'shell(git commit)',
  'shell(git push)',
  'shell(gh pr create)',
  'shell(rm:*)',
  'shell(sudo)',
  'shell(su)',
  'shell(doas)',
  'shell(chown:*)',
];

export const ARTIFACT_AUTHOR_DENY_FLOOR: readonly string[] = ['shell'];

export function hasShellAccess(profile: AutonomyProfile): boolean {
  return profile === 'repo-executor' || profile === 'qa-executor';
}
