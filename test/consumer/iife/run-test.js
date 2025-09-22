import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { setupIIFETest } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runIIFETest() {
	const { htmlPath, cleanupTemp, projectRoot } = await setupIIFETest(
		'IIFE',
		path.resolve(__dirname, '.'), // Local fixtures (index.html)
	);

	let browser = null;
	try {
		// Step 6: Launch headless browser
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		page.on('console', (msg) => console.log('Browser console:', msg.text()));
		page.on('pageerror', (error) => {
			throw new Error(`Browser error: ${error.message}`);
		});

		await page.goto(`file://${htmlPath}`);
		await page.waitForTimeout(1000);
		await browser.close();
		browser = null;

		console.log('IIFE test passed!');
	} catch (error) {
		console.error('IIFE test failed:', error);
		process.exit(1);
	} finally {
		if (browser) await browser.close();
		process.chdir(projectRoot);
		if (cleanupTemp) {
			try {
				await cleanupTemp();
			} catch (cleanupError) {
				console.warn('Failed to clean up temp dir:', cleanupError);
			}
		}
	}
}

runIIFETest();
