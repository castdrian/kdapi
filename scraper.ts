import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import type { Idol, Group } from './types';

// Base URL and endpoints
export const BASE_URL = 'https://kpopping.com';
export const URLS = {
	femaleIdols: `${BASE_URL}/profiles/the-idols/women`,
	maleIdols: `${BASE_URL}/profiles/the-idols/men`,
	girlGroups: `${BASE_URL}/profiles/the-groups/women`,
	boyGroups: `${BASE_URL}/profiles/the-groups/men`,
	coedGroups: `${BASE_URL}/profiles/the-groups/coed`,
};

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const REQUEST_TIMEOUT = 10000;

async function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string> {
	try {
		const response = await axios.get(url, {
			timeout: REQUEST_TIMEOUT,
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
				'Cache-Control': 'no-cache',
				'Pragma': 'no-cache'
			}
		});
		return response.data;
	} catch (error) {
		if (retries > 0) {
			console.log(`Retrying ${url} (${retries} attempts remaining)...`);
			await delay(RETRY_DELAY);
			return fetchWithRetry(url, retries - 1);
		}
		throw error;
	}
}

export async function fetchHtml(url: string): Promise<string> {
	try {
		console.log(`Fetching: ${url}`);
		const html = await fetchWithRetry(url);
		await delay(1000); // Rate limiting delay
		return html;
	} catch (error) {
		console.error(`Error fetching ${url}:`, error);
		return '';
	}
}

export function extractProfileLinks(html: string): string[] {
	const $ = cheerio.load(html);
	const links = new Set<string>();

	// Find all profile links
	$('a[href*="/profiles/"]').each((_, element) => {
		const href = $(element).attr('href');
		if (href && (href.includes('/idol/') || href.includes('/group/'))) {
			const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
			if (!fullUrl.includes('/submission') && !fullUrl.includes('/sign-in')) {
				links.add(fullUrl);
			}
		}
	});

	return Array.from(links);
}

export async function parseIdolProfile(url: string): Promise<Idol | null> {
	try {
		const html = await fetchHtml(url);
		if (!html) return null;

		const $ = cheerio.load(html);

		// Extract basic info
		const name = $('h1').first().text().trim()
			.replace(/\s+profile,\s+age\s+&\s+facts.*$/i, '');

		// Get image URL
		let imageUrl = '';
		$('img').each((_, element) => {
			const src = $(element).attr('src');
			if (src && !src.includes('logo') && !imageUrl) {
				imageUrl = src.startsWith('http') ? src : `${BASE_URL}${src}`;
			}
		});

		// Extract social media links
		const socialMedia: Record<string, string> = {};
		$('a[href*="instagram.com"], a[href*="twitter.com"], a[href*="facebook.com"], a[href*="youtube.com"], a[href*="tiktok.com"]').each((_, element) => {
			const href = $(element).attr('href');
			if (!href) return;

			if (href.includes('instagram.com')) socialMedia.instagram = href;
			else if (href.includes('twitter.com')) socialMedia.twitter = href;
			else if (href.includes('facebook.com')) socialMedia.facebook = href;
			else if (href.includes('youtube.com')) socialMedia.youtube = href;
			else if (href.includes('tiktok.com')) socialMedia.tiktok = href;
		});

		// Extract profile data
		const profileData: Record<string, string> = {};
		$('.profile-info dt, .info-section strong').each((_, element) => {
			const key = $(element).text().trim().replace(/[:：]$/, '');
			const value = $(element).next().text().trim();
			if (key && value) {
				profileData[key.toLowerCase().replace(/\s+/g, '_')] = value;
			}
		});

		// Extract facts
		const facts: string[] = [];
		$('.facts-section li, .profile-facts li').each((_, element) => {
			const fact = $(element).text().trim();
			if (fact && fact.length > 3) {
				facts.push(fact);
			}
		});

		// Build idol object
		const idol: Idol = {
			id: uuidv4(),
			name,
			imageUrl: imageUrl || undefined,
			stageName: profileData.stage_name,
			birthName: profileData.birth_name,
			koreanName: profileData.korean_name,
			nicknames: profileData.nickname?.split(/[,;\/]/).map(n => n.trim()),
			birthDate: profileData.birthday || profileData.birth_date,
			birthplace: profileData.birthplace ? {
				city: profileData.birthplace.split(',')[0]?.trim(),
				country: profileData.birthplace.split(',').pop()?.trim()
			} : undefined,
			nationality: profileData.nationality,
			height: profileData.height,
			weight: profileData.weight,
			bloodType: profileData.blood_type,
			mbti: profileData.mbti,
			agency: profileData.agency,
			position: profileData.position,
			positions: profileData.position?.split(/[,;\/]/).map(p => p.trim()),
			socialMedia: Object.keys(socialMedia).length > 0 ? socialMedia : undefined,
			facts: facts.length > 0 ? facts : undefined
		};

		// Clean up undefined values
		Object.keys(idol).forEach(key => {
			if (idol[key] === undefined) {
				delete idol[key];
			}
		});

		return idol;
	} catch (error) {
		console.error(`Error parsing idol profile ${url}:`, error);
		return null;
	}
}

export async function parseGroupProfile(url: string): Promise<Group | null> {
	try {
		const html = await fetchHtml(url);
		if (!html) return null;

		const $ = cheerio.load(html);

		// Extract basic info
		const name = $('h1').first().text().trim()
			.replace(/\s+profile.*$/i, '');

		// Get image URL
		let imageUrl = '';
		$('img').each((_, element) => {
			const src = $(element).attr('src');
			if (src && !src.includes('logo') && !imageUrl) {
				imageUrl = src.startsWith('http') ? src : `${BASE_URL}${src}`;
			}
		});

		// Extract social media links
		const socialMedia: Record<string, string> = {};
		$('a[href*="instagram.com"], a[href*="twitter.com"], a[href*="facebook.com"], a[href*="youtube.com"], a[href*="tiktok.com"]').each((_, element) => {
			const href = $(element).attr('href');
			if (!href) return;

			if (href.includes('instagram.com')) socialMedia.instagram = href;
			else if (href.includes('twitter.com')) socialMedia.twitter = href;
			else if (href.includes('facebook.com')) socialMedia.facebook = href;
			else if (href.includes('youtube.com')) socialMedia.youtube = href;
			else if (href.includes('tiktok.com')) socialMedia.tiktok = href;
		});

		// Extract member information
		const memberHistory: Group['memberHistory'] = {};

		// Current members
		const currentMembers: typeof memberHistory.currentMembers = [];
		$('.current-members li, .member-list li').each((_, element) => {
			const text = $(element).text().trim();
			if (!text.toLowerCase().includes('former')) {
				const match = text.match(/^([^(]+)(?:\s*\(([^)]+)\))?/);
				if (match) {
					currentMembers.push({
						name: match[1].trim(),
						position: match[2]?.trim()
					});
				}
			}
		});
		if (currentMembers.length > 0) {
			memberHistory.currentMembers = currentMembers;
		}

		// Former members
		const formerMembers: typeof memberHistory.formerMembers = [];
		$('.former-members li').each((_, element) => {
			const text = $(element).text().trim();
			const match = text.match(/^([^(]+)(?:\s*\(([^)]+)\))?/);
			if (match) {
				formerMembers.push({
					name: match[1].trim(),
					position: match[2]?.trim()
				});
			}
		});
		if (formerMembers.length > 0) {
			memberHistory.formerMembers = formerMembers;
		}

		// Extract facts
		const facts: string[] = [];
		$('.facts-section li, .group-facts li').each((_, element) => {
			const fact = $(element).text().trim();
			if (fact && fact.length > 3) {
				facts.push(fact);
			}
		});

		// Extract fandom info
		const fandom: Group['fandom'] = {};
		$('.fandom-info, .profile-info').find('dt, strong').each((_, element) => {
			const key = $(element).text().trim().toLowerCase();
			const value = $(element).next().text().trim();

			if (key.includes('fandom') && value) {
				fandom.name = value;
			} else if ((key.includes('color') || key.includes('colours')) && value) {
				fandom.color = value;
			}
		});

		// Build group object
		const group: Group = {
			id: uuidv4(),
			name,
			imageUrl: imageUrl || undefined,
			memberHistory,
			formation: {
				debutDate: $('.profile-info').find('dt:contains("Debut"), strong:contains("Debut")').next().text().trim(),
				company: $('.profile-info').find('dt:contains("Agency"), strong:contains("Agency")').next().text().trim(),
				status: 'active' // Default to active
			},
			socialMedia: Object.keys(socialMedia).length > 0 ? socialMedia : undefined,
			fandom: Object.keys(fandom).length > 0 ? fandom : undefined,
			facts: facts.length > 0 ? facts : undefined
		};

		// Clean up undefined values
		Object.keys(group).forEach(key => {
			if (group[key] === undefined) {
				delete group[key];
			}
		});

		return group;
	} catch (error) {
		console.error(`Error parsing group profile ${url}:`, error);
		return null;
	}
}