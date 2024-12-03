import { resolve } from 'path';
import { defineConfig } from 'vite';
import pkg from './package.json';
import dts from 'vite-plugin-dts';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const config =
	process.env.BUILD_FORMAT === 'iife'
		? defineConfig({
				build: {
					emptyOutDir: false,
					outDir: 'lib',
					target: 'es2020',
					lib: {
						entry: resolve(__dirname, 'src/index.ts'),
						name: 'cashuts',
						formats: ['iife'],
						fileName: (format) => `cashu-ts.${format}.js`
					},
					sourcemap: true
				},
				plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })]
		  })
		: defineConfig({
				build: {
					emptyOutDir: false,
					outDir: 'lib',
					target: 'es2020',
					lib: {
						entry: resolve(__dirname, 'src/index.ts'),
						name: 'cashuts',
						fileName: (format) => `cashu-ts.${format}.js`,
						formats: ['es', 'cjs']
					},
					rollupOptions: {
						output: {},
						external: (id) =>
							Object.keys(require('./package.json').dependencies || {}).some(
								(dep) => id === dep || id.startsWith(`${dep}/`)
							)
					},
					sourcemap: true
				},
				plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })]
		  });

export default config;
