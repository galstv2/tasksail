// Alice — Product Manager — capital "A", feminine tint.

import { LetterSprite } from './LetterSprite';

export function AliceSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="A" gender="feminine" />;
}
