import { LetterSprite } from './LetterSprite';

export function VerifierSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="V" gender="masculine" />;
}
