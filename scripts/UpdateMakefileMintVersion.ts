import fs from 'fs';
import fetch from 'node-fetch';

// -----------------------------
// Config per dependency
// -----------------------------
const MAKEFILE = 'Makefile';

type Dep = {
	name: string;
	stableVar: string;
	rcVar: string;
};

const DEPENDENCIES: Dep[] = [
	{ name: 'cashubtc/mintd', stableVar: 'CDK_IMAGE', rcVar: 'CDK_IMAGE_RC' },
	{ name: 'cashubtc/nutshell', stableVar: 'NUT_IMAGE', rcVar: 'NUT_IMAGE_RC' },
];

// for github output
interface Update {
	name: string;
	version: string;
}

const updates: Update[] = [];
// -----------------------------
// Helpers
// -----------------------------
function setGithubOutput(name: string, value: string) {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) return;
	fs.appendFileSync(outputPath, `${name}<<EOF\n${value}\nEOF\n`);
}

// Write PR outputs
function writePrOutputs(updates: Update[]): void {
	if (updates.length === 0) {
		setGithubOutput('changed', 'false');
		return;
	}

	setGithubOutput('changed', 'true');

	const summary = updates.map((u) => `- ${u.name} -> ${u.version}`).join('\n');
	setGithubOutput('summary', summary);

	const title =
		updates.length === 1
			? `chore(docker): update ${updates[0].name} to ${updates[0].version}`
			: 'chore(docker): update mint images';
	setGithubOutput('title', title);

	setGithubOutput('branch', 'automation/update-mint-images');
}

type DockerTag = {
	name: string;
};

type DockerHubResponse = {
	results: DockerTag[];
	next?: string | null;
};

async function fetchTags(repo: string): Promise<string[]> {
	let url: string | null = `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100`;
	const tags: string[] = [];

	while (url) {
		const resp = await fetch(url);
		if (!resp.ok) {
			throw new Error(`Failed to fetch tags for ${repo}: ${resp.statusText}`);
		}

		const data = (await resp.json()) as DockerHubResponse;
		tags.push(...data.results.map((t) => t.name));
		url = data.next ?? null;
	}

	return tags;
}

function semverKey(tag: string): number[] {
	const base = tag.split('-')[0];
	return base.split('.').map((x) => parseInt(x, 10));
}

function isPureSemver(tag: string): boolean {
	return /^\d+\.\d+\.\d+$/.test(tag);
}

function isRc(tag: string): boolean {
	return /^\d+\.\d+\.\d+-rc\.\d+$/.test(tag);
}

function getLatestStable(tags: string[]): string | null {
	const stable = tags.filter(isPureSemver);
	if (stable.length === 0) return null;
	return stable.sort(compareSemver).pop()!;
}

function getLatestRc(tags: string[]): string | null {
	const rcs = tags.filter(isRc);
	if (rcs.length === 0) return null;
	return rcs.sort(compareSemver).pop()!;
}

function compareSemver(a: string, b: string): number {
	const parse = (v: string) => {
		const [base, suffix] = v.split('-');
		const parts = base.split('.').map((x) => parseInt(x, 10));
		const rcMatch = suffix?.match(/^rc\.(\d+)$/);
		const rc = rcMatch ? parseInt(rcMatch[1], 10) : null;
		return { parts, rc };
	};

	const av = parse(a);
	const bv = parse(b);

	for (let i = 0; i < 3; i++) {
		if (av.parts[i] !== bv.parts[i]) return av.parts[i] - bv.parts[i];
	}

	if (av.rc !== null && bv.rc !== null) return av.rc - bv.rc;

	return 0;
}

function updateMakefile(varName: string, newTag: string) {
	const content = fs.readFileSync(MAKEFILE, 'utf-8');
	const regex = new RegExp(`^${varName}\\s*\\?=.*$`, 'm');
	const updated = content.replace(regex, `${varName} ?= ${newTag}`);
	if (updated !== content) {
		fs.writeFileSync(MAKEFILE, updated);
		console.log(`Updated ${varName} to ${newTag}`);

		// Only writes in CI
		updates.push({ name: varName, version: newTag });

		return true;
	} else {
		console.log(`No update needed for ${varName}`);

		return false;
	}
}

// -----------------------------
// Main
// -----------------------------
async function main() {
	for (const dep of DEPENDENCIES) {
		const tags = await fetchTags(dep.name);
		const stable = getLatestStable(tags);
		const rc = getLatestRc(tags);

		if (stable) updateMakefile(dep.stableVar, `${dep.name}:${stable}`);

		if (rc) {
			const stableVer = stable ? semverKey(stable) : [0, 0, 0];
			const rcVer = semverKey(rc.split('-')[0]);
			if (rcVer.some((v, i) => v > (stableVer[i] || 0))) {
				updateMakefile(dep.rcVar, `${dep.name}:${rc}`);
			} else {
				console.log(`RC ${rc} is not newer than stable ${stable}, skipping RC update`);
			}
		}
	}
	writePrOutputs(updates);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
