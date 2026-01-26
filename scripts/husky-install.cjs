const { existsSync } = require('fs');
const { execSync } = require('child_process');

if (existsSync('.git') && !process.env.CI) {
	try {
		console.log('Installing Husky...');
		execSync('npx husky', { stdio: 'inherit' });
	} catch (e) {
		console.warn('Husky installation failed, skipping...');
	}
} else {
	console.log('Skipping Husky: Not a git repo or in CI environment.');
}
