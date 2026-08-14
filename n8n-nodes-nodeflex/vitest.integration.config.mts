import { defineConfig } from 'vitest/config';

// Separate from vitest.config.mts on purpose: `npm run test` (the default,
// CI-safe suite) must never discover or attempt these files, since they make
// real network calls to the live NodeFlex hub and require NODEFLEX_TEST_API_KEY.
// Run via `npm run test:integration`, which loads that key from a gitignored
// local file — see scripts/run-integration-tests.mjs and docs/testing.md.
export default defineConfig({
	logLevel: 'error',
	test: {
		environment: 'node',
		include: ['tests/integration/**/*.test.ts'],
		testTimeout: 20000,
	},
});
