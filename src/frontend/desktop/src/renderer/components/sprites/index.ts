import type { RoleKind } from '../../../shared/desktopContractProvider';

import { PlannerSprite } from './PlannerSprite';
import { ProductManagerSprite } from './ProductManagerSprite';
import { BuilderSprite } from './BuilderSprite';
import { VerifierSprite } from './VerifierSprite';
import { QaSprite } from './QaSprite';

export type AgentSpriteProps = { size?: number };

export const roleKindSpriteMap: Record<RoleKind, (props: AgentSpriteProps) => JSX.Element> = {
  planner: PlannerSprite,
  pm: ProductManagerSprite,
  builder: BuilderSprite,
  verifier: VerifierSprite,
  qa: QaSprite,
};

export { PlannerSprite, ProductManagerSprite, BuilderSprite, VerifierSprite, QaSprite };
