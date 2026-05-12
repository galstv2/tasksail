import type { RoleKind } from '../../../shared/desktopContractProvider';

import { LilySprite } from './LilySprite';
import { AliceSprite } from './AliceSprite';
import { DaltonSprite } from './DaltonSprite';
import { DaltonVerifySprite } from './DaltonVerifySprite';
import { RonSprite } from './RonSprite';

export type AgentSpriteProps = { size?: number };

export const roleKindSpriteMap: Record<RoleKind, (props: AgentSpriteProps) => JSX.Element> = {
  planner: LilySprite,
  pm: AliceSprite,
  builder: DaltonSprite,
  verifier: DaltonVerifySprite,
  qa: RonSprite,
};

export { LilySprite, AliceSprite, DaltonSprite, DaltonVerifySprite, RonSprite };
