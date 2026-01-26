const { existsSync } = require('fs');
const { execSync } = require('child_process');

// We ONLY care if the .git folder exists.
// If it doesn't (like in your smoke tests), we exit 0 immediately.
if (existsSync('.git')) {
	try {
		// Use 'husky' instead of 'npx husky' to avoid npx overhead/network lookups
		execSync('husky', { stdio: 'inherit' });
	} catch (e) {
		// Even if it fails, we do NOT throw an error.
		// We want the 'prepare' lifecycle to think everything is fine.
	}
}

// Always exit 0 no matter what happened above.
process.exit(0);
