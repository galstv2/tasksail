// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('planner finalize child scope override authority boundary', () => {
  it('keeps Planner Planning Reload Scope out of finalization and upload authority paths', () => {
    const stagingSource = readFileSync(join(process.cwd(), 'electron/planner/staging.ts'), 'utf8');
    const routerSource = readFileSync(join(process.cwd(), 'electron/ipc/desktopActionRouter.ts'), 'utf8');
    const queueSource = readFileSync(join(process.cwd(), 'electron/__tests__/main.taskQueue.test.ts'), 'utf8');

    expect(stagingSource).not.toContain('plannerPlanningReloadScope');
    expect(routerSource).not.toContain('plannerPlanningReloadScope');
    expect(queueSource).not.toContain('plannerPlanningReloadScope');
    expect(stagingSource).toContain('contextPackBinding: childTaskExecutionScope ?? defaultContextPackBinding');
    expect(routerSource).toContain('metadata.contextPackBinding');
    expect(routerSource).toContain('repositoryTypes: metadata.contextPackBinding.repositoryTypes');
  });
});
