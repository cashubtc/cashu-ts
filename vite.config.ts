import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { configDefaults } from 'vitest/config';
import { createRequire } from 'node:module';

type BuildFormat = 'es' | 'cjs' | 'iife';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { dependencies?: Record<string, string> };
const deps = Object.keys(pkg.dependencies || {});

// These deps are ESM-only. If they remain external in the CJS build,
// Node will try to `require()` them and crash.
const ESM_ONLY_DEPS = new Set(['@noble/curves', '@noble/hashes', '@scure/bip32']);

function resolveFormat(command: 'build' | 'serve'): BuildFormat {
	// During vitest, command is not “build” in the sense we care about,
	// but Vite still loads this config, so we must not throw.
	if (command !== 'build') return 'es';

	const fmt = process.env.BUILD_FORMAT;
	if (fmt === 'es' || fmt === 'cjs' || fmt === 'iife') return fmt;

	// Default to ES if someone runs `vite build` manually.
	// Official builds should still use npm run compile:es / compile:cjs / compile:standalone.
	return 'es';
}

function isDependencyImport(id: string) {
	return deps.some((dep) => id === dep || id.startsWith(`${dep}/`));
}

function makeExternal(format: BuildFormat) {
	if (format === 'iife') return [];

	return (id: string) => {
		if (!isDependencyImport(id)) return false;

		// In ESM, keep deps external, lets consumers dedupe and tree shake.
		if (format === 'es') return true;

		// In CJS, bundle the ESM-only deps to avoid `require()` exploding.
		for (const esmDep of ESM_ONLY_DEPS) {
			if (id === esmDep || id.startsWith(`${esmDep}/`)) return false;
		}

		return true;
	};
}

export default defineConfig(({ command }) => {
	const format = resolveFormat(command);

	// Build ES first (emptyOutDir true), then CJS (emptyOutDir false),
	// so the second run does not wipe the first output.
	const emptyOutDir = format !== 'cjs';

	// Emit types on ES and IIFE builds.
	// IIFE consumer test relies on compile:standalone producing types for the packed tgz.
	const shouldEmitTypes = format === 'es' || format === 'iife';

	return {
		build: {
			outDir: 'lib',
			target: 'es2020',
			emptyOutDir,
			lib: {
				entry: { 'cashu-ts': resolve(__dirname, 'src/index.ts') },
				name: 'cashuts',
				formats: [format],
				fileName: (outFormat, entryName) =>
					format === 'iife'
						? `cashu-ts.${outFormat}.js`
						: `${entryName}.${outFormat === 'es' ? 'es.js' : 'cjs'}`,
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
							include: ['test/integration.test.ts'],
							exclude: [...configDefaults.exclude],
						},
					},
				},
			],
		},
	};
});
