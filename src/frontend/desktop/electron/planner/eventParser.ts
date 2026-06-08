import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';
import type { PlannerChunkParser as ProviderPlannerChunkParser } from '../../../../backend/platform/cli-provider/types.js';
import { REPO_ROOT } from '../paths';
import type { PlannerEventParseResult } from './session.types';

export class PlannerEventParser {
  private readonly parser: ProviderPlannerChunkParser;

  constructor() {
    const provider = getActiveProvider(REPO_ROOT);
    const parser = provider.createPlannerParser?.() ?? null;
    if (!parser) {
      throw new Error(`Active provider "${provider.id}" does not support planner event parsing.`);
    }
    this.parser = parser;
  }

  parseChunk(chunk: string): PlannerEventParseResult[] {
    return this.parser.parseChunk(chunk) as PlannerEventParseResult[];
  }

  flush(): PlannerEventParseResult[] {
    return this.parser.flush() as PlannerEventParseResult[];
  }
}
