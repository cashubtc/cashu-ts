import { resolve } from 'path';
import { defineConfig } from 'vite';
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
						fileName: (format) => `cashu-ts.${format}.js`,
					},
					sourcemap: true,
				},
				plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })],
			})
		: defineConfig({
				build: {
					outDir: 'lib',
					target: 'es2020',
					lib: {
						entry: {
							'cashu-ts': resolve(__dirname, 'src/index.ts'),
							// Main crypto submodules
							'crypto/client': resolve(__dirname, 'src/crypto/client/index.ts'),
							'crypto/common': resolve(__dirname, 'src/crypto/common/index.ts'),
							'crypto/mint': resolve(__dirname, 'src/crypto/mint/index.ts'),
							'crypto/util': resolve(__dirname, 'src/crypto/util/utils.ts'),

							// Individual client files
							'crypto/client/NUT09': resolve(__dirname, 'src/crypto/client/NUT09.ts'),
							'crypto/client/NUT11': resolve(__dirname, 'src/crypto/client/NUT11.ts'),
							'crypto/client/NUT12': resolve(__dirname, 'src/crypto/client/NUT12.ts'),
							'crypto/client/NUT20': resolve(__dirname, 'src/crypto/client/NUT20.ts'),

							// Individual common files
							'crypto/common/NUT11': resolve(__dirname, 'src/crypto/common/NUT11.ts'),

							// Individual mint files
							'crypto/mint/NUT11': resolve(__dirname, 'src/crypto/mint/NUT11.ts'),
							'crypto/mint/NUT12': resolve(__dirname, 'src/crypto/mint/NUT12.ts'),
						},
						name: 'cashuts',
						formats: ['es', 'cjs'],
						fileName: (format, entryName) => `${entryName}.${format}.js`,
					},
					rollupOptions: {
						external: (id) =>
							Object.keys(require('./package.json').dependencies || {}).some(
								(dep) => id === dep || id.startsWith(`${dep}/`),
							),
					},
					sourcemap: true,
				},
				plugins: [dts({ tsconfigPath: './tsconfig.json', outDir: 'lib/types' })],
			});

export default config;
