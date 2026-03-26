import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { configDefaults } from 'vitest/config';
import { createRequire } from 'node:module';

type BuildFormat = 'es' | 'iife';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { dependencies?: Record<string, string> };
const deps = Object.keys(pkg.dependencies || {});

function resolveFormat(command: 'build' | 'serve'): BuildFormat {
	if (command !== 'build') return 'es';

	const fmt = process.env.BUILD_FORMAT;
	if (fmt === 'es' || fmt === 'iife') return fmt;

	return 'es';
}

function isDependencyImport(id: string) {
	return deps.some((dep) => id === dep || id.startsWith(`${dep}/`));
}

function makeExternal(format: BuildFormat) {
	if (format === 'iife') return [];
	return (id: string) => isDependencyImport(id);
}

export default defineConfig(({ command }) => {
	const format = resolveFormat(command);

	// Emit types on ES and IIFE builds.
	// IIFE consumer test relies on compile:standalone producing types for the packed tgz.
	const shouldEmitTypes = format === 'es' || format === 'iife';

	return {
		build: {
			outDir: 'lib',
			target: 'es2020',
			emptyOutDir: true,
			lib: {
				entry: { 'cashu-ts': resolve(__dirname, 'src/index.ts') },
				name: 'cashuts',
				formats: [format],
				fileName: (outFormat) =>
					format === 'iife' ? `cashu-ts.${outFormat}.js` : `cashu-ts.es.js`,
			},
			rollupOptions: {
				external: makeExternal(format),
			},
			sourcemap: true,
		},

		plugins: [
			...(shouldEmitTypes
				? [
						dts({
							tsconfigPath: './tsconfig.json',
							outDir: 'lib/types',
							rollupTypes: true,
						}),
					]
				: []),
		],

		test: {
			reporters: ['default', 'junit'],
			outputFile: { junit: 'test-results/junit.xml' },
			projects: [
				{
					test: {
						name: 'node',
						globals: true,
						environment: 'node',
						include: ['test/**/*.test.ts'],
						exclude: [
							'test/{auth,integration}.test.ts',
							'test/**.browser.test.ts',
							'test/consumer/**/*.test.ts',
							...configDefaults.exclude,
						],
						coverage: {
							provider: 'v8',
							reporter: ['text', 'lcov'],
							include: ['test/**/*.test.ts'],
							exclude: [
								'test/{auth,integration}.test.ts',
								'test/consumer/**/*.test.ts',
								'test/**/**.browser.test.ts',
							],
						},
					},
				},
				{
					test: {
						name: 'browser',
						globals: true,
						browser: {
							provider: 'playwright',
							enabled: true,
							headless: true,
							instances: [{ browser: 'chromium' }],
							screenshotFailures: false,
						},
						include: ['test/**/*.test.ts'],
						exclude: [
							'test/{auth,integration}.test.ts',
							'test/consumer/**/*.test.ts',
							'test/**/**.node.test.ts',
							...configDefaults.exclude,
						],
						coverage: {
							provider: 'v8',
							reporter: ['text', 'lcov'],
							include: ['test/**/*.test.ts'],
							exclude: [
								'test/{auth,integration}.test.ts',
								'test/consumer/**/*.test.ts',
								'test/**.node.test.ts',
							],
						},
					},
				},
				{
					test: {
						name: 'integration',
						globals: true,
						environment: 'node',
						include: ['test/integration.test.ts'],
						exclude: [...configDefaults.exclude],
						coverage: {
							provider: 'v8',
							reporter: ['text', 'lcov'],
							include: ['test/integration.test.ts'],
							exclude: [...configDefaults.exclude],
						},
					},
				},
			],
		},
	};
});
