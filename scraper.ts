import { fetch } from 'undici';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { parseISO, isValid } from 'date-fns';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
	Idol, Group, GroupMember, DataSet,
	BloodType, IdolPosition, GroupStatus, GroupType
} from '@/types';

// Base URL and endpoints
export const BASE_URL = 'https://kpopping.com';
const ENDPOINTS = {
	femaleIdols: '/profiles/the-idols/women',
	maleIdols: '/profiles/the-idols/men',
	girlGroups: '/profiles/the-groups/women',
	boyGroups: '/profiles/the-groups/men',
	coedGroups: '/profiles/the-groups/coed'
} as const;

export const URLS = Object.fromEntries(
	Object.entries(ENDPOINTS).map(([key, value]) => [key, `${BASE_URL}${value}`])
) as Record<keyof typeof ENDPOINTS, string>;

// Configuration
const CONFIG = {
	retryAttempts: 3,
	retryDelay: 2000,
	requestTimeout: 10000,
	rateLimitDelay: 1000,
	userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
} as const;

// Helper Functions
async function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text: string): string {
	return text.trim()
		.replace(/\s+/g, ' ')
		.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Remove zero-width spaces
}

function normalizeDate(dateStr: string): string | undefined {
	if (!dateStr) return undefined;

	// Try parsing various date formats
	const formats = [
		dateStr,
		dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1'), // Remove ordinals
		dateStr.split('(')[0].trim() // Remove parenthetical info
	];

	for (const format of formats) {
		const date = parseISO(format);
		if (isValid(date)) {
			return date.toISOString().split('T')[0];
		}
	}

	return undefined;
}

function parsePosition(pos: string): IdolPosition[] {
	const positions = pos.split(/[,\/&]/).map(p => {
		const cleaned = cleanText(p).toLowerCase();
		// Map common variations to standard positions
		const positionMap: Record<string, IdolPosition> = {
			'leader': 'Leader',
			'main vocal': 'Main Vocalist',
			'main vocalist': 'Main Vocalist',
			'lead vocal': 'Lead Vocalist',
			'lead vocalist': 'Lead Vocalist',
			'vocal': 'Vocalist',
			'vocalist': 'Vocalist',
			'main rap': 'Main Rapper',
			'main rapper': 'Main Rapper',
			'lead rap': 'Lead Rapper',
			'lead rapper': 'Lead Rapper',
			'rap': 'Rapper',
			'rapper': 'Rapper',
			'main dance': 'Main Dancer',
			'main dancer': 'Main Dancer',
			'lead dance': 'Lead Dancer',
			'lead dancer': 'Lead Dancer',
			'dance': 'Dancer',
			'dancer': 'Dancer',
			'visual': 'Visual',
			'center': 'Center',
			'face': 'Face of the Group',
			'maknae': 'Maknae'
		};

		return positionMap[cleaned] || undefined;
	}).filter((p): p is IdolPosition => p !== undefined);

	return [...new Set(positions)]; // Remove duplicates
}

function normalizeBloodType(blood: string): BloodType | undefined {
	const normalized = blood.toUpperCase().replace(/\s+/g, '');
	const validTypes: BloodType[] = ['A', 'B', 'O', 'AB', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
	return validTypes.find(type => type === normalized);
}

async function fetchWithRetry(url: string, retries = CONFIG.retryAttempts): Promise<string> {
	try {
		const response = await fetch(url, {
			headers: {
				'User-Agent': CONFIG.userAgent,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
				'Cache-Control': 'no-cache'
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		return await response.text();
	} catch (error) {
		if (retries > 0) {
			console.log(`Retrying ${url} (${retries} attempts remaining)...`);
			await delay(CONFIG.retryDelay);
			return fetchWithRetry(url, retries - 1);
		}
		throw error;
	}
}

export async function fetchHtml(url: string): Promise<string> {
	try {
		console.log(`Fetching: ${url}`);
		const html = await fetchWithRetry(url);
		await delay(CONFIG.rateLimitDelay);
		return html;
	} catch (error) {
		console.error(`Error fetching ${url}:`, error);
		return '';
	}
}

export function extractProfileLinks($: cheerio.CheerioAPI): string[] {
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

function extractImageUrl($: cheerio.CheerioAPI): string | undefined {
	// Try different image sources in order of preference
	const sources = [
		$('meta[property="og:image"]').attr('content'),
		$('.profile-image img, .member-image img').first().attr('src'),
		$('.wp-block-image img').first().attr('src'),
		$('img[alt*="profile"], img[alt*="Profile"]').first().attr('src'),
		// Avoid small images like logos
		...$('img').toArray()
			.map(img => $(img).attr('src'))
			.filter(src => src && !src.includes('logo') && !src.includes('favicon'))
	];

	const imageUrl = sources.find(src => src && src.length > 0);
	return imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `${BASE_URL}${imageUrl}`) : undefined;
}

function extractSocialMedia($: cheerio.CheerioAPI): NonNullable<Idol['socialMedia']> {
	const socialMedia: NonNullable<Idol['socialMedia']> = {};
	const platforms = {
		'instagram.com': 'instagram',
		'twitter.com': 'twitter',
		'facebook.com': 'facebook',
		'youtube.com': 'youtube',
		'tiktok.com': 'tiktok',
		'weibo.com': 'weibo',
		'melon.com': 'melon',
		'spotify.com': 'spotify'
	} as const;

	$('a[href*="instagram.com"], a[href*="twitter.com"], a[href*="facebook.com"], a[href*="youtube.com"], a[href*="tiktok.com"], a[href*="weibo.com"], a[href*="melon.com"], a[href*="spotify.com"]').each((_, element) => {
		const href = $(element).attr('href');
		if (!href) return;

		for (const [domain, platform] of Object.entries(platforms)) {
			if (href.includes(domain)) {
				socialMedia[platform as keyof typeof socialMedia] = href;
				break;
			}
		}
	});

	return Object.keys(socialMedia).length > 0 ? socialMedia : undefined;
}

function extractFacts($: cheerio.CheerioAPI): string[] {
	const facts: string[] = [];

	// Look for facts in various formats
	$('h2, h3, h4').each((_, heading) => {
		const $heading = $(heading);
		if ($heading.text().toLowerCase().includes('fact')) {
			let $factsList = $heading.nextUntil('h2, h3, h4');

			if ($factsList.find('li').length > 0) {
				// Facts are in a list
				$factsList.find('li').each((_, li) => {
					const text = cleanText($(li).text());
					if (text.length > 4) facts.push(text);
				});
			} else {
				// Facts might be separated by line breaks
				$factsList.each((_, el) => {
					const text = cleanText($(el).text());
					if (text.length > 4 && !text.toLowerCase().includes('fact')) {
						facts.push(text);
					}
				});
			}
		}
	});

	// Look for facts in other common formats
	$('.facts li, .fun-facts li, .profile-facts li').each((_, element) => {
		const text = cleanText($(element).text());
		if (text.length > 4) facts.push(text);
	});

	return [...new Set(facts)]; // Remove duplicates
}

export async function parseIdolProfile(url: string): Promise<Idol | null> {
	try {
		const html = await fetchHtml(url);
		if (!html) return null;

		const $ = cheerio.load(html);

		// Extract basic info
		const name = cleanText($('h1').first().text())
			.replace(/\s+(?:profile|facts|members).*$/i, '');

		// Find the main profile section
		const $profile = $('.profile-section, article');

		const idol: Idol = {
			id: uuidv4(),
			name,
			profileUrl: url,
			imageUrl: extractImageUrl($),
			description: $('meta[name="description"]').attr('content'),

			// Extract all possible name variations
			stageName: (() => {
				const stageName = $profile.find('strong:contains("Stage Name:"), strong:contains("Stage name:")').parent().text();
				return stageName ? cleanText(stageName.split(':')[1]) : undefined;
			})(),
			birthName: (() => {
				const birthName = $profile.find('strong:contains("Birth Name:"), strong:contains("Birth name:")').parent().text();
				return birthName ? cleanText(birthName.split(':')[1]) : undefined;
			})(),
			koreanName: (() => {
				const koreanName = $profile.find('strong:contains("Korean Name:"), strong:contains("Korean name:")').parent().text();
				return koreanName ? cleanText(koreanName.split(':')[1]) : undefined;
			})(),

			// Extract personal details
			birthDate: (() => {
				const birthDate = $profile.find('strong:contains("Birthday:"), strong:contains("Birth date:")').parent().text();
				return birthDate ? normalizeDate(birthDate.split(':')[1]) : undefined;
			})(),
			birthplace: (() => {
				const birthplace = $profile.find('strong:contains("Birthplace:"), strong:contains("Birth place:")').parent().text();
				if (!birthplace) return undefined;

				const parts = birthplace.split(':')[1]?.split(',').map(cleanText);
				return parts ? {
					city: parts[0],
					region: parts.length > 2 ? parts[1] : undefined,
					country: parts[parts.length - 1]
				} : undefined;
			})(),
			nationality: (() => {
				const nationality = $profile.find('strong:contains("Nationality:")').parent().text();
				return nationality ? cleanText(nationality.split(':')[1]) : undefined;
			})(),

			// Physical attributes
			height: (() => {
				const height = $profile.find('strong:contains("Height:")').parent().text();
				const match = height.match(/(\d+)/);
				return match ? parseInt(match[1]) : undefined;
			})(),
			weight: (() => {
				const weight = $profile.find('strong:contains("Weight:")').parent().text();
				const match = weight.match(/(\d+)/);
				return match ? parseInt(match[1]) : undefined;
			})(),
			bloodType: (() => {
				const bloodType = $profile.find('strong:contains("Blood Type:")').parent().text();
				return bloodType ? normalizeBloodType(bloodType.split(':')[1]) : undefined;
			})(),

			// Career information
			groups: (() => {
				const groups: Idol['groups'] = [];
				$profile.find('strong:contains("Group:")').parent().each((_, el) => {
					const text = $(el).text();
					const status = text.toLowerCase().includes('former') ? 'former' : 'current';
					const name = cleanText(text.split(':')[1].replace(/\([^)]*\)/g, ''));
					if (name) {
						groups.push({ groupName: name, status });
					}
				});
				return groups.length > 0 ? groups : undefined;
			})(),

			// Additional details
			mbti: (() => {
				const mbti = $profile.find('strong:contains("MBTI:")').parent().text();
				return mbti ? cleanText(mbti.split(':')[1]) : undefined;
			})(),

			socialMedia: extractSocialMedia($),
			facts: extractFacts($)
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
		const $profile = $('.profile-section, article');

		// Extract basic info
		const name = cleanText($('h1').first().text())
			.replace(/\s+(?:profile|facts|members).*$/i, '');

		// Determine group type
		let type: GroupType;
		if (url.includes('/boy-group')) type = 'boy';
		else if (url.includes('/girl-group')) type = 'girl';
		else if (url.includes('/co-ed')) type = 'co-ed';
		else type = 'boy'; // Default to boy group if unclear

		// Parse members
		function parseMembers($section: cheerio.CheerioAPI, section: string): GroupMember[] {
			const members: GroupMember[] = [];

			$profile.find(`h3:contains("${section}"), h4:contains("${section}")`).nextUntil('h3, h4').find('li').each((_, el) => {
				const $member = $(el);
				const text = cleanText($member.text());
				const posMatch = text.match(/\((.*?)\)/);

				if (!text) return;

				const member: GroupMember = {
					name: text.split('(')[0].trim(),
					position: posMatch ? parsePosition(posMatch[1]) : undefined
				};

				// Try to find member's profile link
				const profileLink = $member.find('a').attr('href');
				if (profileLink) {
					member.profileUrl = profileLink.startsWith('http') ?
						profileLink : `${BASE_URL}${profileLink}`;
				}

				members.push(member);
			});

			return members;
		}

		const currentMembers = parseMembers($, 'Current Members') ||
			parseMembers($, 'Members');
		const formerMembers = parseMembers($, 'Former Members') ||
			parseMembers($, 'Past Members');

		// Extract debut information
		const debutInfo = (() => {
			const debutText = $profile.find('strong:contains("Debut:")').parent().text();
			const [date, ...details] = debutText.split('with').map(cleanText);
			return {
				date: normalizeDate(date) || '',
				song: details.join(' ').replace(/[""]/g, '')
			};
		})();

		const group: Group = {
			id: uuidv4(),
			name,
			type,
			profileUrl: url,
			imageUrl: extractImageUrl($),
			description: $('meta[name="description"]').attr('content'),
			status: (() => {
				const statusText = $profile.text().toLowerCase();
				if (statusText.includes('disbanded')) return 'disbanded';
				if (statusText.includes('hiatus')) return 'hiatus';
				if (statusText.includes('inactive')) return 'inactive';
				if (statusText.includes('sub-unit')) return 'sub-unit';
				return 'active';
			})(),
			debutDate: debutInfo.date,

			// Member information
			memberCount: {
				current: currentMembers.length,
				peak: Math.max(currentMembers.length, formerMembers?.length || 0)
			},
			memberHistory: {
				currentMembers,
				...(formerMembers?.length ? { formerMembers } : {})
			},

			// Company info
			company: {
				current: (() => {
					const agency = $profile.find('strong:contains("Agency:")').parent().text();
					return agency ? cleanText(agency.split(':')[1]) : 'Unknown';
				})()
			},

			// Debut details
			debut: debutInfo,

			// Fandom info
			fandom: (() => {
				const name = $profile.find('strong:contains("Fandom:")').parent().text();
				const color = $profile.find('strong:contains("Fan Color:")').parent().text();
				return name ? {
					name: cleanText(name.split(':')[1]),
					...(color ? { color: cleanText(color.split(':')[1]) } : {})
				} : undefined;
			})(),

			socialMedia: extractSocialMedia($),
			facts: extractFacts($)
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