import * as fs from 'fs';
import * as path from 'path';
import { URLS, fetchHtml, extractProfileLinks, parseIdolProfile, parseGroupProfile } from './scraper';
import type { DataSet, Idol, Group } from './types';

const DATA_DIR = path.join(__dirname, 'data');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface ProfileUrls {
	femaleIdols: string[];
	maleIdols: string[];
	girlGroups: string[];
	boyGroups: string[];
	coedGroups: string[];
}

async function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeProfiles<T>(urls: string[], parser: (url: string) => Promise<T | null>): Promise<T[]> {
	const results: T[] = [];

	for (const url of urls) {
		try {
			// Add delay between requests to avoid rate limiting
			await delay(1000);

			console.log(`Scraping: ${url}`);
			const profile = await parser(url);
			if (profile) {
				results.push(profile);
				console.log(`✅ Successfully scraped ${url}`);
			}
		} catch (error) {
			console.error(`❌ Error scraping ${url}:`, error);
		}
	}

	return results;
}

async function getAllProfileUrls(categoryUrl: string): Promise<string[]> {
	console.log(`Fetching all profiles from ${categoryUrl}`);
	const html = await fetchHtml(categoryUrl);
	return extractProfileLinks(html);
}

function saveToJSON<T>(data: T, filename: string): void {
	const filePath = path.join(DATA_DIR, filename);
	try {
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
		console.log(`✅ Saved data to ${filePath}`);
	} catch (error) {
		console.error(`❌ Error saving data to ${filePath}:`, error);
	}
}

function mergeProfiles<T extends { name: string }>(profiles: T[][]): T[] {
	const profileMap = new Map<string, T>();

	for (const profileArray of profiles) {
		for (const profile of profileArray) {
			if (!profileMap.has(profile.name)) {
				profileMap.set(profile.name, profile);
			}
		}
	}

	return Array.from(profileMap.values());
}

async function getUrlsForCategory(
	categoryUrl: string,
	debugUrls?: string[]
): Promise<string[]> {
	if (debugUrls && debugUrls.length > 0) {
		console.log(`Using ${debugUrls.length} debug URLs for ${categoryUrl}`);
		return debugUrls;
	}

	return getAllProfileUrls(categoryUrl);
}

export async function cleanAndUpdate(debugUrls?: ProfileUrls): Promise<void> {
	const isDebugMode = !!debugUrls;
	console.log(`🧹 Running in ${isDebugMode ? 'debug' : 'production'} mode`);

	const data: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: []
	};

	// Get profile URLs (either debug samples or all)
	const urls = {
		femaleIdols: await getUrlsForCategory(URLS.femaleIdols, debugUrls?.femaleIdols),
		maleIdols: await getUrlsForCategory(URLS.maleIdols, debugUrls?.maleIdols),
		girlGroups: await getUrlsForCategory(URLS.girlGroups, debugUrls?.girlGroups),
		boyGroups: await getUrlsForCategory(URLS.boyGroups, debugUrls?.boyGroups),
		coedGroups: await getUrlsForCategory(URLS.coedGroups, debugUrls?.coedGroups)
	};

	// Scrape idol profiles
	console.log('\n👩 Scraping female idols...');
	data.femaleIdols = await scrapeProfiles(urls.femaleIdols, parseIdolProfile);

	console.log('\n👨 Scraping male idols...');
	data.maleIdols = await scrapeProfiles(urls.maleIdols, parseIdolProfile);

	// Scrape group profiles
	console.log('\n👯‍♀️ Scraping girl groups...');
	data.girlGroups = await scrapeProfiles(urls.girlGroups, parseGroupProfile);

	console.log('\n👯‍♂️ Scraping boy groups...');
	data.boyGroups = await scrapeProfiles(urls.boyGroups, parseGroupProfile);

	console.log('\n👯 Scraping co-ed groups...');
	data.coedGroups = await scrapeProfiles(urls.coedGroups, parseGroupProfile);

	// Merge and save results
	console.log('\n🔄 Merging and saving data...');

	const allIdols = mergeProfiles([data.femaleIdols, data.maleIdols]);
	const allGroups = mergeProfiles([data.girlGroups, data.boyGroups, data.coedGroups]);

	saveToJSON(allIdols, isDebugMode ? 'debug_idols.json' : 'idols.json');
	saveToJSON(allGroups, isDebugMode ? 'debug_groups.json' : 'groups.json');

	// Save metadata
	const metadata = {
		lastUpdated: new Date().toISOString(),
		totalCount: {
			femaleIdols: data.femaleIdols.length,
			maleIdols: data.maleIdols.length,
			girlGroups: data.girlGroups.length,
			boyGroups: data.boyGroups.length,
			coedGroups: data.coedGroups.length,
			total: allIdols.length + allGroups.length
		}
	};

	saveToJSON(metadata, 'metadata.json');

	console.log('\n📊 Summary:', metadata.totalCount);
}