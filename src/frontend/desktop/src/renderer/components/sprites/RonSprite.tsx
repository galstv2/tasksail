// Ron — QA — capital "R", masculine tint.

import { LetterSprite } from './LetterSprite';

export function RonSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="R" gender="masculine" />;
}
