import { exitCodeFor } from './errors.js';
import { createLogger, installProcessHandlers } from './logger.js';

export function runCliBoundary(
  module: string,
  main: () => Promise<void> | void,
): void {
  const log = createLogger(module);
  const uninstall = installProcessHandlers(module);

  Promise.resolve()
    .then(main)
    .then(() => uninstall())
    .catch((err: unknown) => {
      log.error('cli.crash', err);
      uninstall();
      process.exit(exitCodeFor(err));
    });
}
