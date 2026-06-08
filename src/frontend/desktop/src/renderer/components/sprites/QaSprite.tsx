import { LetterSprite } from './LetterSprite';

export function QaSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="Q" gender="masculine" />;
}
