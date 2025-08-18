import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import tmp from 'tmp-promise';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright'; // Use Playwright for browser testing (project has it via Vitest)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..'); // From test/consumer-iife/ to root

async function runIIFETest() {
	let iifePath = null; // Track the IIFE bundle path
	let cleanupTemp = null; // For explicit temp dir cleanup
	try {
		// Step 1: Build the IIFE bundle (in root)
		process.chdir(projectRoot);
		execSync('npm run compile:standalone', { stdio: 'inherit' });
		console.log('IIFE build completed.');

		iifePath = path.resolve(projectRoot, 'lib/cashu-ts.iife.js'); // Assuming standard output path

		// Step 2: Create temp consumer dir (capture cleanup function)
		const { path: tempDir, cleanup } = await tmp.dir({ unsafeCleanup: true });
		cleanupTemp = cleanup; // Assign for finally block

		// Step 3: Copy fixture files (from nested dir)
		const fixtureDir = path.resolve(__dirname, '.'); // Current dir for fixtures
		await fs.cp(fixtureDir, tempDir, {
			recursive: true,
			filter: (src) => !src.endsWith('run-test.js'),
		}); // Exclude script itself

		// Step 4: Update index.html to point to the actual IIFE bundle
		const htmlPath = path.join(tempDir, 'index.html');
		let htmlContent = await fs.readFile(htmlPath, 'utf8');
		htmlContent = htmlContent.replace('../../lib/cashu-ts.iife.js', iifePath); // Fix relative path to absolute
		await fs.writeFile(htmlPath, htmlContent);

		// Step 5: Launch headless browser with Playwright and load HTML
		const browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		page.on('console', (msg) => console.log('Browser console:', msg.text())); // Log console output
		page.on('pageerror', (error) => {
			throw new Error(`Browser error: ${error.message}`);
		}); // Fail on errors

		await page.goto(`file://${htmlPath}`);
		await page.waitForTimeout(1000); // Give time for script execution

		await browser.close();
		console.log('IIFE test passed!');
	} catch (error) {
		console.error('IIFE test failed:', error);
		process.exit(1);
	} finally {
		process.chdir(projectRoot); // Reset cwd
		if (cleanupTemp) {
			try {
				await cleanupTemp(); // Explicitly clean up the temp dir
			} catch (cleanupError) {
				console.warn('Failed to clean up temp dir:', cleanupError);
			}
		}
	}
}

runIIFETest();
