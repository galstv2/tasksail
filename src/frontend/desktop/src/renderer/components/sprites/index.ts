import type { NamedWorkflowAgentKey } from '../../../shared/agentRoster';

import { LilySprite } from './LilySprite';
import { AliceSprite } from './AliceSprite';
import { DaltonSprite } from './DaltonSprite';
import { RonSprite } from './RonSprite';

export type AgentSpriteProps = { size?: number };

export const agentSpriteMap: Record<NamedWorkflowAgentKey, (props: AgentSpriteProps) => JSX.Element> = {
  'planning-agent': LilySprite,
  'product-manager': AliceSprite,
  'software-engineer': DaltonSprite,
  'qa': RonSprite,
};

export { renderPixelGrid } from './renderPixelGrid';
export { LilySprite, AliceSprite, DaltonSprite, RonSprite };
