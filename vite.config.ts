import { resolve } from 'path';
import { defineConfig } from 'vite';
import pkg from './package.json';
import dts from 'vite-plugin-dts';

const config =
	process.env.BUILD_FORMAT === 'iife'
		? defineConfig({
				build: {
					outDir: 'lib',
					target: 'es2020',
					lib: {
						entry: resolve(__dirname, 'src/index.ts'),
						name: 'cashuts',
						formats: ['iife'],
						fileName: (format) => `cashu-ts.${format}.js`
					}
				},
				plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })]
		  })
		: defineConfig({
				build: {
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
						external: (id) => {
							return Object.keys((pkg as any).dependencies).includes(id);
						}
					}
				},
				plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })]
		  });

export default config;
