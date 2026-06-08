import { LetterSprite } from './LetterSprite';

export function PlannerSprite({ size = 36 }: { size?: number }): JSX.Element {
  return <LetterSprite size={size} letter="P" gender="feminine" />;
}
