// Lily — Planning Specialist — capital "L", feminine tint.

import { LetterSprite } from './LetterSprite';

export function LilySprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="L" gender="feminine" />;
}
