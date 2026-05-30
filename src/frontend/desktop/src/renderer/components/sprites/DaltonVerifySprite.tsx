// Dalton Verify — Verification Engineer — capital "DV", masculine tint.

import { LetterSprite } from './LetterSprite';

export function DaltonVerifySprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="DV" gender="masculine" />;
}
