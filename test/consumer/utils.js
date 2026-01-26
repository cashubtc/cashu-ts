import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..'); // repo root
const sharedFixtureDir = path.resolve(__dirname); // shared index.ts in test/consumer

console.log('[consumer tests] os.tmpdir():', os.tmpdir());

// ---------- small utilities ----------

async function rimrafWithRetry(target, tries = 5, delayMs = 150) {
	if (!target) return;
	let lastErr = null;
	for (let i = 0; i < tries; i++) {
		try {
			await fs.rm(target, { recursive: true, force: true });
			return;
		} catch (err) {
			lastErr = err;
			await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
		}
	}
	console.warn('Failed to clean up path after retries:', target, lastErr);
}

function npmExec(cmd, cwd) {
	const env = {
		...process.env,
		npm_config_fund: 'false',
		npm_config_audit: 'false',
		npm_config_loglevel: 'error',
	};
	execSync(cmd, { stdio: 'inherit', cwd, env });
}

function runnerTmp() {
	return process.env.RUNNER_TEMP || os.tmpdir();
}

// ---------- shared steps ----------

async function packAndBuild({ buildCmd, expectIIFE = false }) {
	// build the lib and produce a .tgz in repo root
	process.chdir(projectRoot);
	npmExec(buildCmd, projectRoot);

	let iifePath = null;
	if (expectIIFE) {
		iifePath = path.resolve(projectRoot, 'lib/cashu-ts.iife.js');
		// ensure IIFE artefact exists
		try {
			await fs.access(iifePath);
		} catch {
			throw new Error('IIFE bundle not found at ' + iifePath);
		}
	}

	const packOutput = execSync('npm pack', { cwd: projectRoot }).toString();
	const tgzFile = packOutput.match(/cashu-cashu-ts-.*\.tgz/)?.[0];
	if (!tgzFile) throw new Error('Failed to find packed .tgz in npm pack output');

	const tgzPath = path.resolve(projectRoot, tgzFile);
	return { tgzPath, iifePath };
}

async function createTempDir(testName) {
	const base = runnerTmp();
	return fs.mkdtemp(path.join(base, `cashu-test-${testName}-`));
}

async function copySharedIndex({ testName, tempDir }) {
	if (testName === 'CommonJS') return;
	const sharedIndexPath = path.join(sharedFixtureDir, 'index.ts');
	const exists = await fs
		.access(sharedIndexPath)
		.then(() => true)
		.catch(() => false);
	if (exists) {
		await fs.cp(sharedIndexPath, path.join(tempDir, 'index.ts'));
		console.log(`Copied shared index.ts for ${testName}: ${sharedIndexPath}`);
	} else {
		console.warn(`Shared index.ts not found for ${testName}: ${sharedIndexPath}`);
	}
}

async function copyFixtureDir({ fixtureDir, tempDir, label }) {
	const files = await fs.readdir(fixtureDir);
	for (const file of files) {
		if (!file.endsWith('run-test.js')) {
			// exclude the test runner
			await fs.cp(path.join(fixtureDir, file), path.join(tempDir, file), { recursive: true });
			console.log(`Copied ${label} file: ${file}`);
		}
	}
	console.log(`Copied files in ${tempDir} for ${label}:`, await fs.readdir(tempDir));
}

function initAndInstall({ tempDir, installDepsCommand, tgzPath }) {
	npmExec('npm init -y', tempDir);
	if (installDepsCommand) npmExec(`${installDepsCommand} --no-fund --no-audit --silent`, tempDir);
	npmExec(`npm i ${tgzPath} --no-fund --no-audit --silent --ignore-scripts`, tempDir);
}

function showTscConfig(tempDir, label) {
	console.log(`${label} tsc config:`);
	try {
		npmExec('npx tsc --showConfig', tempDir);
	} catch (e) {
		console.error('Failed to show tsc config:', e);
	}
}

// ---------- public API ----------

export async function runSmokeTest({
	testName,
	fixtureDir,
	installDepsCommand,
	validationCommands,
	preValidationSteps = [],
}) {
	let tgzPath = null;
	let tempDir = null;

	try {
		// build and pack standard artefacts
		const pack = await packAndBuild({ buildCmd: 'npm run compile' });
		tgzPath = pack.tgzPath;
		console.log('Packed file:', path.basename(tgzPath));

		// prepare temp project with fixtures
		tempDir = await createTempDir(testName);
		await copySharedIndex({ testName, tempDir });
		await copyFixtureDir({ fixtureDir, tempDir, label: testName });

		// init npm and install deps
		initAndInstall({ tempDir, installDepsCommand, tgzPath });

		// pre validation steps, for example npm pkg set type=commonjs
		for (const step of preValidationSteps) npmExec(step, tempDir);

		// helpful debug
		showTscConfig(tempDir, testName);

		// run the validations
		for (const cmd of validationCommands) npmExec(cmd, tempDir);

		console.log(`${testName} test passed!`);
	} catch (err) {
		console.error(`${testName} test failed:`, err);
		process.exit(1);
	} finally {
		process.chdir(projectRoot);
		await rimrafWithRetry(tgzPath).catch(() => {});
		await rimrafWithRetry(tempDir).catch(() => {});
	}
}

export async function setupIIFETest(testName, fixtureDir) {
	let tgzPath = null;
	let iifePath = null;
	let tempDir = null;

	try {
		// build and pack the IIFE artefact as well as the .tgz for types
		const pack = await packAndBuild({ buildCmd: 'npm run compile:standalone', expectIIFE: true });
		tgzPath = pack.tgzPath;
		iifePath = pack.iifePath;
		console.log('IIFE build completed.');
		console.log('Packed file:', path.basename(tgzPath));

		// prepare temp project with fixtures, including shared index.ts
		tempDir = await createTempDir(testName);
		await copySharedIndex({ testName, tempDir });
		await copyFixtureDir({ fixtureDir, tempDir, label: testName });

		// patch the html to point at the built bundle on disk
		const htmlPath = path.join(tempDir, 'index.html');
		let html = await fs.readFile(htmlPath, 'utf8');
		html = html.replace('../../lib/cashu-ts.iife.js', iifePath);
		await fs.writeFile(htmlPath, html);

		// install typescript and the tgz so we can type check
		initAndInstall({ tempDir, installDepsCommand: 'npm i typescript --save-dev', tgzPath });

		// a fast type check to catch dts issues in the browser target
		npmExec('npx tsc --noEmit', tempDir);

		// the packed tarball is installed into the temp project, it is no longer needed
		await rimrafWithRetry(tgzPath).catch(() => {});
		tgzPath = null;

		return {
			tempDir,
			htmlPath,
			cleanupTemp: () => rimrafWithRetry(tempDir),
			projectRoot,
		};
	} catch (err) {
		console.error('IIFE setup failed:', err);
		if (tgzPath) await rimrafWithRetry(tgzPath).catch(() => {});
		if (tempDir) await rimrafWithRetry(tempDir).catch(() => {});
		process.exit(1);
	}
}
