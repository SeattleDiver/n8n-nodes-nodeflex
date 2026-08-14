import { defineConfig } from 'vitest/config';

export default defineConfig({
	logLevel: 'error', // n8n-workflow ships .js files with sourcemaps pointing at .ts sources it doesn't publish; silence the harmless warning noise
	test: {
		environment: 'node',
		include: ['**/*.test.ts'],
		// tests/integration/** requires a live NodeFlex API key and real network
		// access — it has its own config (vitest.integration.config.mts) and its
		// own script (`npm run test:integration`) so the default suite stays hermetic.
		exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
	},
});
