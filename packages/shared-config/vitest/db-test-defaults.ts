/**
 * Shared vitest knobs for packages whose tests touch Postgres via
 * `withTestDb` (CREATE/DROP DATABASE per test file).
 *
 * History: the harness used to run with `fileParallelism: false` because
 * each per-test DB clone exhausted Postgres's default `max_connections=100`
 * when turbo fanned out packages concurrently — surfaced as cascading
 * `FATAL 57P01 admin_shutdown` errors.
 *
 * Current setup: `pg-container.ts` runs Postgres with `max_connections=400`
 * and `.withReuse()` so one shared container backs every package and every
 * `pnpm test` invocation. That headroom unlocks `fileParallelism: true`,
 * cutting per-package wall time roughly in half on a typical laptop.
 *
 * If you see `57P01` again, lower `maxWorkers` here OR bump max_connections
 * in `pg-container.ts` (and restart the reusable container).
 */
import { fileURLToPath } from 'node:url';
import type { ViteUserConfig } from 'vitest/config';

const setupDbTest = fileURLToPath(new URL('./setup-db-test.ts', import.meta.url));

export const dbTestDefaults: NonNullable<ViteUserConfig['test']> = {
  pool: 'forks',
  fileParallelism: true,
  maxWorkers: 4,
  testTimeout: 60_000,
  hookTimeout: 120_000,
  setupFiles: [setupDbTest],
};
