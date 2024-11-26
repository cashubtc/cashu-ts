import { resolve } from 'path';
import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
	build: {
		outDir: 'lib',
		target: 'esnext',
		lib: {
			entry: resolve(__dirname, 'src/index.ts'),
			name: 'cashuts',
			// the proper extensions will be added
			fileName: 'cashuts',
			formats: ['es', 'cjs', 'iife']
		},
		rollupOptions: {
			// make sure to externalize deps that shouldn't be bundled
			// into your library
			output: {},
			external: ['@cashu/crypto']
		}
	}
});
