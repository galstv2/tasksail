// Dalton — Software Engineer — capital "D", masculine tint.

import { LetterSprite } from './LetterSprite';

export function DaltonSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="D" gender="masculine" />;
}
