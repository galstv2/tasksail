import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const logIsolationPath = fileURLToPath(
  new URL('./src/backend/platform/vitest.logIsolation.ts', import.meta.url),
);

export default defineConfig({
  test: {
    setupFiles: [logIsolationPath],
  },
});
