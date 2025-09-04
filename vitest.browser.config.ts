import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	server: {
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin',
		},
	},
	worker: {
		plugins: () => [wasm()],
		format: 'es',
	},
	optimizeDeps: {
		exclude: ['stwo-cairo'],
	},
	test: {
		name: 'cairo',
		globals: true,
		include: ['test/cairoIntegration.test.ts'],
		browser: {
			enabled: true,
			provider: 'playwright',
			// https://vitest.dev/guide/browser/playwright
			instances: [
				{ browser: 'chromium' },
				// { browser: "firefox" }
			],
			headless: true,
		},
	},
});
