import { LetterSprite } from './LetterSprite';

export function BuilderSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="B" gender="masculine" />;
}
