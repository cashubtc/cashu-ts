import { replaceInFileSync } from 'replace-in-file';

try {
	const options = {
		files: 'lib/types/**/*.d.ts',
		from: /from\s+["'](\.\/[^"']+)["']/g,
		to: "from '$1.js'",
	};

	const results = replaceInFileSync(options);
	const changed = results.filter((r) => r.hasChanged).map((r) => r.file);
	if (changed.length) console.log('Post processed .js imports in:', changed);
} catch (error) {
	console.error('Error:', error);
}
