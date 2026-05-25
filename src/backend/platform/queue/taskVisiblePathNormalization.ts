import path from 'node:path';
import { canonicalRoot, escapeRegExp } from '../core/index.js';

export type SelectedRepoRootAlias = {
  repoId: string;
  originalRoot: string;
  worktreeRoot?: string;
};

export function normalizeSelectedRepoPathsInText(options: {
  text: string;
  aliases: readonly SelectedRepoRootAlias[];
  mode: 'human-readable' | 'agent-executable';
}): string {
  let output = options.text;
  const aliases = [...options.aliases]
    .map((alias) => ({ ...alias, originalRoot: canonicalRoot(alias.originalRoot) }))
    .sort((a, b) => b.originalRoot.length - a.originalRoot.length);

  for (const alias of aliases) {
    output = output.replace(absolutePathPattern(alias.originalRoot), (match) => {
      const relative = toPosixRelative(alias.originalRoot, match);
      if (options.mode === 'agent-executable') {
        if (!alias.worktreeRoot) {
          throw new Error(`Cannot normalize selected repo path for "${alias.repoId}": worktreeRoot is missing.`);
        }
        return relative
          ? path.join(alias.worktreeRoot, relative)
          : alias.worktreeRoot;
      }
      return relative ? `${alias.repoId}/${relative}` : alias.repoId;
    });
  }

  return output;
}

function absolutePathPattern(root: string): RegExp {
  const escaped = escapeRegExp(root);
  return new RegExp(`${escaped}(?=$|[\\s\`'")\\]}>,.:;]|/)` + `(?:/[^\\s\`'")\\]}>,.:;]*)?`, 'g');
}

function toPosixRelative(root: string, candidate: string): string {
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate === root) return '';
  const relative = path.relative(root, normalizedCandidate);
  return relative.split(path.sep).join('/');
}
