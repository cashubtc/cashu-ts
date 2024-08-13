#!/usr/bin/env node

const esbuild = require('esbuild');

esbuild
	.build({
		entryPoints: ['src/index.ts'],
		outdir: 'lib/esm',
		bundle: true,
		sourcemap: 'external',
		format: 'esm'
	})
	.catch(() => process.exit(1));

esbuild
	.build({
		entryPoints: ['src/index.ts'],
		outdir: 'lib/cjs',
		bundle: true,
		sourcemap: 'external',
		format: 'cjs'
	})
	.catch(() => process.exit(1));

esbuild
	.build({
		bundle: true,
		sourcemap: 'external',
		entryPoints: ['src/index.ts'],
		outfile: 'lib/cashu.bundle.js',
		format: 'iife',
		globalName: 'CashuTs',
		define: {
			window: 'self',
			global: 'self',
			process: '{"env": {}}'
		}
	})
	.then(() => console.log('standalone build success.'));
