import type { NamedWorkflowAgentKey } from '../../../shared/agentRoster';

import { LilySprite } from './LilySprite';
import { AliceSprite } from './AliceSprite';
import { DaltonSprite } from './DaltonSprite';
import { DaltonVerifySprite } from './DaltonVerifySprite';
import { RonSprite } from './RonSprite';

export type AgentSpriteProps = { size?: number };

type SpriteAgentKey = NamedWorkflowAgentKey | 'software-engineer-verify';

export const agentSpriteMap: Record<SpriteAgentKey, (props: AgentSpriteProps) => JSX.Element> = {
  'planning-agent': LilySprite,
  'product-manager': AliceSprite,
  'software-engineer': DaltonSprite,
  'software-engineer-verify': DaltonVerifySprite,
  'qa': RonSprite,
};

export { LilySprite, AliceSprite, DaltonSprite, DaltonVerifySprite, RonSprite };
