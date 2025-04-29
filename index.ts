import { cleanAndUpdate } from './cleanAndUpdateData';
import { URLS, fetchHtml, extractProfileLinks } from './scraper';
import * as fs from 'fs';
import * as path from 'path';
import type { Idol, Group } from './types';

const DATA_DIR = path.join(__dirname, 'data');
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ANALYSIS_DIR)) {
	fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
}

interface DebugOptions {
	sampleSize?: number;
	excludeProfiles?: string[];
	saveRawHtml?: boolean;
}

async function getRandomProfiles(url: string, count: number, exclude: string[] = []): Promise<string[]> {
	console.log(`Fetching profiles from ${url}`);
	const html = await fetchHtml(url);
	let links = extractProfileLinks(html);

	// Filter out excluded profiles
	links = links.filter(link =>
		!exclude.some(ex => link.toLowerCase().includes(ex.toLowerCase()))
	);

	// Shuffle array
	for (let i = links.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[links[i], links[j]] = [links[j], links[i]];
	}

	return links.slice(0, count);
}

export async function runDebugMode(options: DebugOptions = {}) {
	const {
		sampleSize = 3,
		excludeProfiles = ['bts', 'blackpink'],
		saveRawHtml = true
	} = options;

	console.log('🔍 Running in debug mode...');
	console.log(`Sample size: ${sampleSize} profiles per category`);
	console.log(`Excluded profiles: ${excludeProfiles.join(', ')}`);

	// Get random profile URLs
	const profileUrls = {
		femaleIdols: await getRandomProfiles(URLS.femaleIdols, sampleSize, excludeProfiles),
		maleIdols: await getRandomProfiles(URLS.maleIdols, sampleSize, excludeProfiles),
		girlGroups: await getRandomProfiles(URLS.girlGroups, sampleSize, excludeProfiles),
		boyGroups: await getRandomProfiles(URLS.boyGroups, sampleSize, excludeProfiles),
		coedGroups: await getRandomProfiles(URLS.coedGroups, sampleSize, excludeProfiles)
	};

	// Save selected URLs for reference
	fs.writeFileSync(
		path.join(DATA_DIR, 'debug_urls.json'),
		JSON.stringify(profileUrls, null, 2)
	);

	// Run scraper with debug URLs
	await cleanAndUpdate(profileUrls);

	console.log('\n✅ Debug scraping complete!');
	console.log('Check data/debug_urls.json for scraped profiles');
	console.log('Check data/idols.json and data/groups.json for results');
}

export async function runProductionMode() {
	console.log('🚀 Running in production mode...');
	await cleanAndUpdate();
	console.log('\n✅ Production scraping complete!');
}

async function main() {
	const args = process.argv.slice(2);
	const mode = args[0] || 'production';
	const sampleSize = args[1] ? parseInt(args[1]) : 3;

	if (mode === 'debug') {
		await runDebugMode({ sampleSize });
	} else {
		await runProductionMode();
	}
}

// Run if called directly
if (require.main === module) {
	main().catch(error => {
		console.error('Error:', error);
		process.exit(1);
	});
}

// Export for use as a module
export default {
	runDebugMode,
	runProductionMode
};