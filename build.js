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
