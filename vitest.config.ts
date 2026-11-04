import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * `execArgv: ['--expose-gc']` gives the worker threads access to the garbage
 * collector, which the performance suite needs in order to measure real heap
 * growth instead of everything that merely has not been collected yet.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--expose-gc'],
      },
    },
  },
});
