import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { configDefaults } from 'vitest/config';

export default defineConfig({
	build: {
		outDir: 'lib',
		target: 'es2020',
		lib: {
			entry:
				process.env.BUILD_FORMAT === 'iife'
					? resolve(__dirname, 'src/index.ts')
					: {
							'cashu-ts': resolve(__dirname, 'src/index.ts'),
							crypto: resolve(__dirname, 'src/crypto/core.ts'),
							'crypto/NUT01': resolve(__dirname, 'src/crypto/NUT01.ts'),
							'crypto/NUT09': resolve(__dirname, 'src/crypto/NUT09.ts'),
							'crypto/NUT11': resolve(__dirname, 'src/crypto/NUT11.ts'),
							'crypto/NUT12': resolve(__dirname, 'src/crypto/NUT12.ts'),
							'crypto/NUT20': resolve(__dirname, 'src/crypto/NUT20.ts'),
						},
			name: 'cashuts',
			formats: process.env.BUILD_FORMAT === 'iife' ? ['iife'] : ['es', 'cjs'],
			fileName: (format, entryName) =>
				process.env.BUILD_FORMAT === 'iife'
					? `cashu-ts.${format}.js`
					: `${entryName}.${format === 'es' ? 'es.js' : 'cjs'}`,
		},
		rollupOptions: {
			external:
				process.env.BUILD_FORMAT === 'iife'
					? []
					: (id) =>
							Object.keys(require('./package.json').dependencies || {}).some(
								(dep) => id === dep || id.startsWith(`${dep}/`),
							),
		},
		sourcemap: true,
	},
	plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })],
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
						'test/consumer-*/**/*.test.ts',
						...configDefaults.exclude,
					],
					coverage: {
						provider: 'v8',
						include: ['test/**/*.test.ts'],
						exclude: [
							'test/{auth,integration}.test.ts',
							'test/consumer-*/**/*.test.ts',
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
					},
					include: ['test/**/*.test.ts'],
					exclude: [
						'test/{auth,integration}.test.ts',
						'test/consumer-*/**/*.test.ts',
						'test/**/**.node.test.ts',
						...configDefaults.exclude,
					],
					coverage: {
						provider: 'v8',
						include: ['test/**/*.test.ts'],
						exclude: [
							'test/{auth,integration}.test.ts',
							'test/consumer-*/**/*.test.ts',
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
});
