import { fetch } from 'undici';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { parseISO, isValid } from 'date-fns';
import * as fs from 'node:fs';
import * as path from 'path';
import type {
	IdolProfile, GroupProfile, GroupMember, DataSet,
	BloodType, IdolPosition, GroupStatus, GroupType, Fandom,
	IdolCareer, Company, SocialMedia
} from './types';

const reset = '\x1b[0m';

const PATHS = {
	DATA_DIR: path.join(process.cwd(), 'data'),
	get GROUPS_FILE() { return path.join(this.DATA_DIR, 'groups.json'); },
	get IDOLS_FILE() { return path.join(this.DATA_DIR, 'idols.json'); },
	get METADATA_FILE() { return path.join(this.DATA_DIR, 'metadata.json'); },
} as const;

// Base URL and endpoints
const BASE_URL = 'https://kpopping.com';
const ENDPOINTS = {
	femaleIdols: '/profiles/the-idols/women',
	maleIdols: '/profiles/the-idols/men',
	girlGroups: '/profiles/the-groups/women',
	boyGroups: '/profiles/the-groups/men',
	coedGroups: '/profiles/the-groups/coed'
} as const;

// Update CONFIG to include concurrentRequests
const CONFIG = {
	debug: true,
	retryAttempts: 3,
	retryDelay: 1000,
	requestTimeout: 20000,
	rateLimitDelay: 1000,
	maxRequestsPerMinute: 60,
	maxConcurrent: 5,
	concurrentRequests: 5,
	debugSampleSize: 5,
	batchLogInterval: 10, // Log batch progress every N items
	saveInterval: 100,    // Save progress every N items
	userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	headers: {
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
		'Accept-Language': 'en-US,en;q=0.9',
		'Accept-Encoding': 'gzip, deflate, br',
		'Cache-Control': 'no-cache',
		'Sec-Ch-Ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
		'Sec-Ch-Ua-Mobile': '?0',
		'Sec-Ch-Ua-Platform': '"macOS"',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Upgrade-Insecure-Requests': '1'
	}
} as const;

// Track failed requests to implement backoff strategy
const failedRequests = new Map<string, { count: number; lastAttempt: number }>();

async function shouldRetry(url: string): Promise<boolean> {
	const failed = failedRequests.get(url);
	if (!failed) return true;

	const now = Date.now();
	const timeSinceLastAttempt = now - failed.lastAttempt;
	const backoffTime = Math.min(CONFIG.retryDelay * Math.pow(2, failed.count), 60000);

	return timeSinceLastAttempt >= backoffTime;
}

function recordFailedRequest(url: string) {
	const failed = failedRequests.get(url) || { count: 0, lastAttempt: 0 };
	failedRequests.set(url, {
		count: failed.count + 1,
		lastAttempt: Date.now()
	});
}

// Helper functions
function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text: string): string {
	return text.trim()
		.replace(/\s+/g, ' ')
		.replace(/[\u200B-\u200D\uFEFF]/g, '')
		.replace(/[""]/g, '"')
		.replace(/['′]/g, "'");
}

function parsePositions(text: string): IdolPosition[] {
	// Enhanced position mapping with common variations
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
		'face of the group': 'Face of the Group',
		'maknae': 'Maknae',
		'youngest': 'Maknae'
	};

	// Split on various delimiters and handle multiple positions
	return text.toLowerCase()
		.split(/[,/&、]/)
		.map(p => {
			const cleaned = p.trim()
				.replace(/\([^)]*\)/g, '') // Remove parenthetical notes
				.replace(/^(is|was)\s+/i, '') // Remove "is/was" prefixes
				.replace(/\s+position$/i, ''); // Remove "position" suffix

			// Try exact match first
			if (positionMap[cleaned]) {
				return positionMap[cleaned];
			}

			// Try partial matches
			for (const [key, value] of Object.entries(positionMap)) {
				if (cleaned.includes(key)) {
					return value;
				}
			}
			return null;
		})
		.filter((p): p is IdolPosition => p !== null);
}

// Rate limiting token bucket
const rateLimiter = {
	tokens: CONFIG.maxRequestsPerMinute as number,
	lastRefill: Date.now(),
	refillRate: CONFIG.maxRequestsPerMinute / 60000, // Tokens per millisecond

	async getToken(): Promise<void> {
		const now = Date.now();
		const timePassed = now - this.lastRefill;
		this.tokens = Math.min(
			CONFIG.maxRequestsPerMinute,
			this.tokens + timePassed * this.refillRate
		);
		this.lastRefill = now;

		if (this.tokens < 1) {
			const waitTime = (1 - this.tokens) / this.refillRate;
			await delay(waitTime);
			return this.getToken();
		}

		this.tokens -= 1;
	}
};

async function fetchWithRetry(url: string): Promise<string> {
	if (!await shouldRetry(url)) {
		throw new Error('Too many recent failures for this URL');
	}

	// Wait for rate limit token
	await rateLimiter.getToken();

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

		const response = await fetch(url, {
			headers: {
				...CONFIG.headers,
				'User-Agent': CONFIG.userAgent,
				'Host': new URL(url).hostname,
				'Referer': 'https://www.google.com/',
				'Connection': 'keep-alive',
				'DNT': '1'
			},
			signal: controller.signal
		});

		clearTimeout(timeoutId);

		if (response.status === 429) {
			// Get retry delay from response headers or use exponential backoff
			const retryAfter = response.headers.get('Retry-After');
			const delay = retryAfter ? parseInt(retryAfter) * 1000 : CONFIG.retryDelay;
			await new Promise(resolve => setTimeout(resolve, delay));
			throw new Error('Rate limited');
		}

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const text = await response.text();
		if (text.length < 1000 ||
			text.includes('Too Many Requests') ||
			text.includes('Access Denied') ||
			text.includes('blocked') ||
			text.includes('Cloudflare')) {
			throw new Error('Invalid response received');
		}

		// Reset failed count on success
		failedRequests.delete(url);
		return text;
	} catch (error) {
		recordFailedRequest(url);

		// Calculate exponential backoff delay
		const failed = failedRequests.get(url);
		const retryCount = failed ? failed.count : 1;
		const backoffDelay = Math.min(
			CONFIG.retryDelay * Math.pow(2, retryCount - 1),
			60000 // Max 1 minute delay
		);

		if (retryCount <= CONFIG.retryAttempts) {
			await delay(backoffDelay);
			return fetchWithRetry(url);
		}

		throw error;
	}
}

function extractProfileLinks($: cheerio.CheerioAPI): string[] {
	const links = new Set<string>();

	// Find profile links with various selectors
	$('a[href*="/profiles/"]').each((_, el) => {
		const href = $(el).attr('href');
		if (href && (href.includes('/idol/') || href.includes('/group/'))) {
			links.add(href.startsWith('http') ? href : `${BASE_URL}${href}`);
		}
	});

	return [...links].filter(url =>
		!url.includes('/submission') &&
		!url.includes('/sign-in')
	);
}

function extractImageUrl($: cheerio.CheerioAPI): string | undefined {
	// Try meta tags first
	const ogImage = $('meta[property="og:image"]').attr('content');
	if (ogImage?.includes('//')) return ogImage;

	// Try profile-specific images
	const profileImage = $('.profile-image img, .profile-pic img').first().attr('src');
	if (profileImage?.includes('//')) return profileImage;

	// Try any large images
	const images = $('img[src*="documents"]').toArray()
		.map(img => $(img).attr('src'))
		.filter((src): src is string =>
			!!src &&
			!src.includes('favicon') &&
			!src.includes('logo') &&
			src.includes('//')
		);

	return images[0];
}

function extractSocialMedia($: cheerio.CheerioAPI): SocialMedia {
	const socialMedia: SocialMedia = {};

	// Find social media links in various locations
	$('.socials a, .social-media a, a[class*="social"]').each((_, el) => {
		const $link = $(el);
		const href = $link.attr('href');
		if (!href) return;

		// Skip kpopping.com links and ads
		if (href.includes('kpopping.com') || href.includes('discord.gg')) return;

		// Validate and clean URL
		try {
			const url = new URL(href);
			const domain = url.hostname.replace('www.', '');

			// Map to proper platform
			if (domain.includes('instagram.com')) socialMedia.instagram = href;
			else if (domain.includes('twitter.com') || domain.includes('x.com')) socialMedia.twitter = href;
			else if (domain.includes('facebook.com')) socialMedia.facebook = href;
			else if (domain.includes('youtube.com')) socialMedia.youtube = href;
			else if (domain.includes('spotify.com')) socialMedia.spotify = href;
			else if (domain.includes('weibo.com')) socialMedia.weibo = href;
			else if (domain.includes('tiktok.com')) socialMedia.tiktok = href;
			else if (domain.includes('vlive.tv')) socialMedia.vlive = href;
			else if (domain.includes('cafe.daum.net')) socialMedia.fancafe = href;
			else if (!domain.includes('google.com')) socialMedia.website = href;
		} catch (e) { }
	});

	return socialMedia;
}

function extractFacts($: cheerio.CheerioAPI): string[] {
	const facts: Set<string> = new Set();

	// Look for facts in various formats
	$('.facts li, .fun-facts li, .funfacts li, .profile-facts li').each((_, el) => {
		const text = cleanText($(el).text());
		if (text.length > 10 && !text.toLowerCase().includes('fact:')) {
			facts.add(text);
		}
	});

	// Look for facts in paragraphs
	$('p').each((_, el) => {
		const $p = $(el);
		const text = cleanText($p.text());
		if (text.toLowerCase().includes('fact:')) {
			const factText = text.split('fact:')[1]?.trim();
			if (factText && factText.length > 10) {
				facts.add(factText);
			}
		}
	});

	return [...facts];
}

// Korean text detection and filtering
const KOREAN_COMMON_WORDS = new Set([
	'그룹', '멤버', '소속사', '가수', '배우', '매니저', '데뷔', '활동', '공식',
	'팬클럽', '팬덤', '컴백', '앨범', '싱글', '음악', '비주얼', '메인', '리더',
	'막내', '보컬', '댄서', '래퍼', '센터', '포지션', '프로필', '본명', '예명',
	'생일', '국적', '혈액형', '키', '체중'
]);

function isLikelyKoreanName(text: string): boolean {
	// Korean names are typically 2-4 characters
	if (text.length < 2 || text.length > 8) return false;

	// Must contain Hangeul
	if (!/[\u3131-\u314E\u314F-\u3163\uAC00-\uD7A3]/.test(text)) return false;

	// Shouldn't be a common word
	if (KOREAN_COMMON_WORDS.has(text)) return false;

	// Shouldn't contain numbers or special characters
	if (/[\d!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/.test(text)) return false;

	return true;
}

function extractKoreanName($: cheerio.CheerioAPI): string | undefined {
	// First try structured data
	$('script[type="application/ld+json"]').each((_, el) => {
		try {
			const data = JSON.parse($(el).html() || '{}');
			if (data.alternateName) {
				const names = Array.isArray(data.alternateName) ? data.alternateName : [data.alternateName];
				for (const name of names) {
					if (isLikelyKoreanName(name)) {
						return name;
					}
				}
			}
		} catch (e) { }
	});

	// Look for explicit Korean name labels
	const koreanNameSelectors = [
		'dt:contains("Korean Name"), dt:contains("Korean name"), dt:contains("한국어 이름"), dt:contains("그룹명")',
		'strong:contains("Korean Name"), strong:contains("Korean name"), strong:contains("한국어 이름"), strong:contains("그룹명")',
		'.profile-info:contains("Korean Name"), .profile-info:contains("Korean name"), .profile-info:contains("한국어 이름"), .profile-info:contains("그룹명")',
		'p:contains("Korean Name"), p:contains("Korean name"), p:contains("한국어 이름"), p:contains("그룹명")'
	];

	for (const selector of koreanNameSelectors) {
		const $els = $(selector);
		for (const el of $els.toArray()) {
			const $el = $(el);
			const text = $el.text();
			const labelMatch = text.match(/(?:Korean Name|Korean name|한국어 이름|그룹명)[:：]\s*([^()\n,]+)/);
			if (labelMatch && labelMatch[1]) {
				const name = cleanText(labelMatch[1]);
				if (isLikelyKoreanName(name)) {
					return name;
				}
			}
		}
	}

	// Try finding Korean name in meta description
	const description = $('meta[name="description"]').attr('content') || '';
	const metaMatch = description.match(/(?:known as|called)\s+([가-힣\s]+)(?:\s+in Korean)/i);
	if (metaMatch && metaMatch[1] && isLikelyKoreanName(metaMatch[1])) {
		return cleanText(metaMatch[1]);
	}

	// Finally try Korean text that looks like a name
	const namePatterns = [
		/그룹명[은는이가]?\s+['"]?([가-힣\s]+)['"]?/,
		/한국[어명]으로는?\s+['"]?([가-힣\s]+)['"]?/,
		/([가-힣]{2,8})\s*(?:라는|이라는|라고|이라고)\s*(?:이름|그룹|팀)/
	];

	const text = $.text();
	for (const pattern of namePatterns) {
		const match = text.match(pattern);
		if (match && match[1] && isLikelyKoreanName(match[1])) {
			return cleanText(match[1]);
		}
	}

	// Look for Korean text in h1/h2 that might be a name
	const $headers = $('h1, h2');
	const potentialNames = new Set<string>();

	$headers.each((_, el) => {
		const text = $(el).text();
		const koreanParts = text.match(/[가-힣\s]+/g);
		if (koreanParts) {
			koreanParts.forEach(part => {
				const cleaned = cleanText(part);
				if (isLikelyKoreanName(cleaned)) {
					potentialNames.add(cleaned);
				}
			});
		}
	});

	// Sort potential names by likelihood of being a group name
	return Array.from(potentialNames)
		.sort((a, b) => {
			// Prefer names that look like group names
			const aScore = a.includes('그룹') || a.includes('팀') ? 2 :
				a.length >= 2 && a.length <= 4 ? 1 : 0;
			const bScore = b.includes('그룹') || b.includes('팀') ? 2 :
				b.length >= 2 && b.length <= 4 ? 1 : 0;
			return bScore - aScore;
		})[0];
}

type AnyNode = cheerio.Element;
type CheerioAPI = cheerio.CheerioAPI;

function findElementWithText($parent: cheerio.Cheerio<AnyNode>, pattern: string): cheerio.Cheerio<AnyNode> {
	return $parent.find(`*:contains("${pattern}")`);
}

function extractNames($: CheerioAPI): {
	stage: string;
	korean?: string;
	birth?: {
		latin?: string;
		hangeul?: string;
	};
	aliases?: string[];
} {
	const names = {
		stage: cleanText($('h1').first().text()).replace(/\s+(?:profile|facts).*$/i, ''),
		korean: undefined as string | undefined,
		birth: {} as { latin?: string; hangeul?: string; } | undefined,
		aliases: [] as string[]
	};

	// Extract Korean name with improved validation
	const koreanNameEl = $('.native-name');
	if (koreanNameEl.length) {
		const koreanMatch = koreanNameEl.text().match(/Korean:\s*([가-힣\s]+)/);
		if (koreanMatch?.[1]) {
			names.korean = cleanText(koreanMatch[1]);
		}
	}

	// Extract birth name from data grid with better validation
	const fullNameLatin = $('.data-grid .equal:contains("Full name:")').next('.equal').text();
	const fullNameHangeul = $('.data-grid .equal:contains("Native name:")').next('.equal').text();

	if (fullNameLatin || fullNameHangeul) {
		names.birth = {};
		if (fullNameLatin && !/^[가-힣\s]+$/.test(fullNameLatin)) {
			names.birth.latin = cleanText(fullNameLatin);
		}
		if (fullNameHangeul && /^[가-힣\s]+$/.test(fullNameHangeul)) {
			names.birth.hangeul = cleanText(fullNameHangeul);
		}
	}

	// Look for alternative names/aliases with improved parsing
	const description = $('meta[name="description"]').attr('content') || '';
	const aliasMatches = [
		...description.matchAll(/(?:also |alternatively |formerly )(?:known|written) as ([^,.]+)/gi),
		...description.matchAll(/(?:nicknamed|alias|a\.k\.a\.) ([^,.]+)/gi)
	];

	const aliases = new Set<string>();
	aliasMatches.forEach(match => {
		if (match[1]) {
			match[1].split(/(?:,|\s+and\s+)/).forEach(alias => {
				const cleaned = cleanText(alias);
				if (cleaned && cleaned !== names.stage) {
					aliases.add(cleaned);
				}
			});
		}
	});

	if (aliases.size > 0) {
		names.aliases = Array.from(aliases);
	}

	// Clean up undefined values
	if (Object.keys(names.birth || {}).length === 0) delete names.birth;

	return names;
}

function extractCompanyInfo($: CheerioAPI): {
	current?: string;
	history?: Array<{
		name: string;
		period?: {
			start: string;
			end?: string;
		};
	}>;
} {
	const company: ReturnType<typeof extractCompanyInfo> = {};

	// Extract current company from various places
	const currentCompany = $('#star-companies .cell').first().find('.name a').text();
	if (currentCompany) {
		company.current = cleanText(currentCompany);
	}

	// Extract company history
	const history: Array<{ name: string; period?: { start: string; end?: string } }> = [];

	$('#star-companies .cell').each((_, el) => {
		const $company = $(el);
		const name = cleanText($company.find('.name a').text() || $company.find('.name').text());
		const periodText = cleanText($company.find('.value').text());

		if (name && !name.includes(':')) {
			const period = parsePeriod(periodText);
			history.push({
				name,
				...(period && { period })
			});
		}
	});

	if (history.length > 0) {
		company.history = history;
	}

	return company;
}

function parsePeriod(text: string): { start: string; end?: string } | undefined {
	if (!text) return undefined;

	const dateRangeMatch = text.match(/(\d{4}[-.／/]\d{1,2}(?:[-.／/]\d{1,2})?)\s*(?:-|until|to|~)\s*(\d{4}[-.／/]\d{1,2}(?:[-.／/]\d{1,2})?|present)/i);
	if (dateRangeMatch) {
		const [, start, end] = dateRangeMatch;
		return {
			start: normalizeDate(start) || start,
			...(end && end.toLowerCase() !== 'present' && { end: normalizeDate(end) || end })
		};
	}

	return undefined;
}

function extractSocialMediaLinks($: CheerioAPI): NonNullable<CoreProfile['socialMedia']> {
	const socialMedia: NonNullable<CoreProfile['socialMedia']> = {};

	$('.socials a').each((_, el) => {
		const $link = $(el);
		const href = $link.attr('href');
		if (!href || href.includes('kpopping.com')) return;

		try {
			const url = new URL(href);
			const domain = url.hostname.replace('www.', '');

			if (domain.includes('instagram.com')) socialMedia.instagram = href;
			else if (domain.includes('twitter.com') || domain.includes('x.com')) socialMedia.twitter = href;
			else if (domain.includes('facebook.com')) socialMedia.facebook = href;
			else if (domain.includes('youtube.com')) socialMedia.youtube = href;
			else if (domain.includes('spotify.com')) socialMedia.spotify = href;
			else if (domain.includes('weibo.com')) socialMedia.weibo = href;
			else if (domain.includes('tiktok.com')) socialMedia.tiktok = href;
			else if (domain.includes('vlive.tv')) socialMedia.vlive = href;
			else if (domain.includes('cafe.daum.net')) socialMedia.fancafe = href;
			else if (!domain.includes('google.com')) socialMedia.website = href;
		} catch (e) { }
	});

	return Object.keys(socialMedia).length > 0 ? socialMedia : undefined;
}

function extractIdolPhysicalInfo($: CheerioAPI): PhysicalInfo {
	const info: PhysicalInfo = {
		height: null,
		weight: null,
		bloodType: null,
		birthDate: null,
		zodiacSign: null,
		mbti: null
	};

	// Enhanced height extraction
	const heightText = $('.data-grid .equal:contains("Height:"), .profile-info:contains("Height:")').text();
	if (heightText) {
		const heightMatch = heightText.match(/(\d+(?:\.\d+)?)\s*(?:cm|센티미터)/i);
		if (heightMatch) {
			const height = parseFloat(heightMatch[1]);
			if (height >= 140 && height <= 200) { // Reasonable height range
				info.height = height;
			}
		}
	}

	// Enhanced blood type extraction with validation
	const bloodTypeText = $('.data-grid .equal:contains("Blood type:"), .profile-info:contains("Blood:")').text();
	if (bloodTypeText) {
		const normalizedType = normalizeBloodType(bloodTypeText);
		if (normalizedType) {
			info.bloodType = normalizedType;
		}
	}

	// Enhanced MBTI extraction with strict validation
	const mbtiText = $([
		'.data-grid .equal:contains("MBTI:")',
		'.profile-info:contains("MBTI")',
		'.facts:contains("MBTI")',
		'p:contains("personality type")'
	].join(', ')).text();

	if (mbtiText) {
		const mbtiMatch = mbtiText.match(/(?:MBTI|personality type)[:\s]+([IE][NS][FT][JP](?:-[AT])?)/i);
		if (mbtiMatch?.[1]) {
			const normalized = mbtiMatch[1].toUpperCase();
			if (/^[IE][NS][FT][JP](-[AT])?$/.test(normalized)) {
				info.mbti = normalized;
			}
		}
	}

	// ... more enhanced extractions ...

	return info;
}

function extractIdolPersonalInfo($: CheerioAPI): PersonalInfo {
	const info: PersonalInfo = {};

	// Extract nationality with improved detection
	const nationalityInfo = new Set<string>();

	// Check flag icons
	$('.flag-icon').each((_, el) => {
		const flagClass = $(el).attr('class') || '';
		const countryCode = flagClass.match(/flag-icon-(\w+)/)?.[1]?.toUpperCase();
		if (countryCode) {
			const country = ISO_COUNTRIES[countryCode];
			if (country) nationalityInfo.add(country);
		}
	});

	// Check explicit country mentions
	$('.data-grid .equal:contains("Country:")').next('.equal').text()
		.split(',')
		.map(cleanText)
		.filter(Boolean)
		.forEach(country => nationalityInfo.add(country));

	// Check hometown data
	$('.data-grid .equal:contains("Hometown:")')
		.parent()
		.find('.color-blue-green.text-uppercase')
		.each((_, el) => {
			const text = $(el).text().trim();
			if (text) nationalityInfo.add(text);
		});

	if (nationalityInfo.size > 0) {
		info.nationality = Array.from(nationalityInfo)[0]; // Take first nationality
	}

	// Extract education
	const education: NonNullable<PersonalInfo['education']> = [];
	$('.data-grid .equal:contains("Education:")').next('.equal').text()
		.split(/[,，]/) // Include Japanese comma
		.map(cleanText)
		.filter(Boolean)
		.forEach(school => {
			const entry = { school };
			if (school.toLowerCase().includes('graduated')) entry.status = 'graduated';
			else if (school.toLowerCase().includes('attending')) entry.status = 'attending';

			if (school.toLowerCase().includes('high school')) entry.type = 'high school';
			else if (school.toLowerCase().includes('university')) entry.type = 'university';

			education.push(entry);
		});

	if (education.length > 0) {
		info.education = education;
	}

	// Extract languages with normalization
	const languageText = $('.data-grid .equal:contains("Language")').next('.equal').text();
	if (languageText) {
		const languages = new Set<string>();
		languageText
			.split(/[,、]/) // Split on both English and Japanese commas
			.map(lang => cleanText(lang.replace(/\s+and\s+/, ','))) // Handle "and" conjunction
			.filter(Boolean)
			.forEach(lang => {
				// Normalize common variations
				const normalized = lang.toLowerCase()
					.replace('korean', 'Korean')
					.replace('english', 'English')
					.replace('japanese', 'Japanese')
					.replace('mandarin', 'Mandarin')
					.replace('chinese', 'Mandarin')
					.trim();
				if (normalized) languages.add(normalized);
			});

		if (languages.size > 0) {
			info.languages = Array.from(languages);
		}
	}

	// Extract hobbies
	const hobbies = extractHobbies($);
	if (hobbies?.length > 0) {
		info.hobbies = hobbies;
	}

	// Extract specialties
	const specialties = extractSpecialties($);
	if (specialties?.length > 0) {
		info.specialties = specialties;
	}

	return Object.keys(info).length > 0 ? info : undefined;
}

function extractHobbies($: CheerioAPI): string[] | undefined {
	const hobbies = new Set<string>();
	const hobbySelectors = [
		'.data-grid .equal:contains("Hobbies:")',
		'.data-grid .equal:contains("Interests:")',
		'.profile-info:contains("hobbies")',
		'p:contains("likes to")'
	];

	// Extract from multiple sources
	hobbySelectors.forEach(selector => {
		const $el = $(selector);
		if ($el.length) {
			const text = $el.parent().text();
			const matches = text.match(/(?:Hobbies|Interests)[:：]?\s*([^.]+)/i) ||
				text.match(/likes to\s+([^.]+)/i);
			if (matches?.[1]) {
				matches[1].split(/[,、]/)
					.map(hobby => cleanText(hobby))
					.filter(Boolean)
					.forEach(hobby => hobbies.add(hobby));
			}
		}
	});

	// Look for hobbies in facts
	const facts = extractFacts($);
	facts.forEach(fact => {
		if (fact.toLowerCase().includes('hobby') || fact.toLowerCase().includes('likes to')) {
			const hobbyMatch = fact.match(/(?:hobby is|hobbies are|likes to)\s+([^.]+)/i);
			if (hobbyMatch?.[1]) {
				hobbyMatch[1].split(/[,、]/)
					.map(hobby => cleanText(hobby))
					.filter(Boolean)
					.forEach(hobby => hobbies.add(hobby));
			}
		}
	});

	return hobbies.size > 0 ? Array.from(hobbies) : undefined;
}

function extractSpecialties($: CheerioAPI): string[] | undefined {
	const specialties = new Set<string>();
	const specialtySelectors = [
		'.data-grid .equal:contains("Specialties:")',
		'.data-grid .equal:contains("Skills:")',
		'.profile-info:contains("good at")',
		'p:contains("specializes in")'
	];

	// Extract from multiple sources
	specialtySelectors.forEach(selector => {
		const $el = $(selector);
		if ($el.length) {
			const text = $el.parent().text();
			const matches = text.match(/(?:Specialties|Skills)[:：]?\s*([^.]+)/i) ||
				text.match(/(?:good at|specializes in)\s+([^.]+)/i);
			if (matches?.[1]) {
				matches[1].split(/[,、]/)
					.map(specialty => cleanText(specialty))
					.filter(Boolean)
					.forEach(specialty => specialties.add(specialty));
			}
		}
	});

	// Look for specialties in facts
	const facts = extractFacts($);
	facts.forEach(fact => {
		if (fact.toLowerCase().includes('specialize') || fact.toLowerCase().includes('good at')) {
			const specialtyMatch = fact.match(/(?:specializes in|good at)\s+([^.]+)/i);
			if (specialtyMatch?.[1]) {
				specialtyMatch[1].split(/[,、]/)
					.map(specialty => cleanText(specialty))
					.filter(Boolean)
					.forEach(specialty => specialties.add(specialty));
			}
		}
	});

	return specialties.size > 0 ? Array.from(specialties) : undefined;
}

function extractIdolCareerInfo($: CheerioAPI): CareerInfo {
	const info: CareerInfo = {};

	// Extract debut date
	const debutText = $('.data-grid .equal:contains("Debut:")').next('.equal').text();
	if (debutText) {
		const date = normalizeDate(debutText);
		if (date) info.debutDate = date;
	}

	// Extract active years
	const activeYearsText = $('.data-grid .equal:contains("Active years:")').next('.equal').text();
	if (activeYearsText) {
		const [start, end] = activeYearsText.split('-').map(cleanText);
		if (start) {
			info.activeYears = [{
				start: `${start}-01-01`,
				...(end && end.toLowerCase() !== 'present' && { end: `${end}-12-31` })
			}];
		}
	}

	// Extract training period
	const trainingText = $('.data-grid .equal:contains("Training period:")').next('.equal').text();
	if (trainingText) {
		const period = parsePeriod(trainingText);
		const durationMatch = trainingText.match(/(\d+)\s*(?:year|month|day)s?/gi);

		if (period || durationMatch) {
			info.trainingPeriod = {
				...period,
				...(durationMatch && { duration: durationMatch.join(', ') })
			};
		}
	}

	// Extract show appearances
	const appearances: NonNullable<CareerInfo['showAppearances']> = [];

	// Look for show links in text
	$('a[href*="/survivalshow/"], a[href*="/drama/"]').each((_, el) => {
		const $link = $(el);
		const name = cleanText($link.text());
		const href = $link.attr('href');

		if (name && href) {
			const type = href.includes('survivalshow') ? 'survival' :
				href.includes('drama') ? 'drama' : 'variety';

			appearances.push({
				name,
				type,
				year: href.match(/\/(\d{4})-/)?.[1]
			});
		}
	});

	if (appearances.length > 0) {
		info.showAppearances = appearances;
	}

	return Object.keys(info).length > 0 ? info : undefined;
}

function extractIdolGroupHistory($: CheerioAPI): GroupHistory[] | undefined {
	const groups: GroupHistory[] = [];

	// Look for current group
	$('.data-grid .equal:contains("Current group:")').next('.equal').find('a').each((_, el) => {
		const $link = $(el);
		const name = cleanText($link.text());
		if (name) {
			groups.push({
				groupName: name,
				status: 'current'
			});
		}
	});

	// Look for former groups
	$('.data-grid .equal:contains("Former group")').next('.equal').find('a').each((_, el) => {
		const $link = $(el);
		const name = cleanText($link.text());
		if (name) {
			groups.push({
				groupName: name,
				status: 'former'
			});
		}
	});

	return groups.length > 0 ? groups : undefined;
}

function extractFandom($: CheerioAPI): Fandom {
	const fandom: Fandom = {
		name: null,
		color: null,
		lightstick: null
	};

	// Enhanced fandom name extraction
	const fandomNameSelectors = [
		'.fandom-name',
		'.data-grid .equal:contains("Fandom name:")',
		'.profile-info:contains("fandom")',
		'p:contains("팬덤")', // Korean
	];

	for (const selector of fandomNameSelectors) {
		const $el = $(selector);
		if ($el.length) {
			const text = $el.text();
			const nameMatch = text.match(/(?:팬덤|fandom)[:\s]+["']?([^"'\n,]+)["']?/i);
			if (nameMatch?.[1]) {
				fandom.name = cleanText(nameMatch[1]);
				break;
			}
		}
	}

	// Enhanced lightstick extraction
	const lightstickSelectors = [
		'.lightstick-info',
		'.data-grid .equal:contains("Light stick:")',
		'img[alt*="lightstick"]'
	];

	let foundLightstick = false;
	for (const selector of lightstickSelectors) {
		const $el = $(selector);
		if ($el.length) {
			if (!fandom.lightstick) {
				fandom.lightstick = {
					name: null,
					imageUrl: null,
					description: null,
					version: null
				};
			}

			// Extract lightstick details
			const text = $el.text();
			const nameMatch = text.match(/(?:called|named)\s+["']([^"']+)["']/i);
			if (nameMatch?.[1]) {
				fandom.lightstick.name = cleanText(nameMatch[1]);
			}

			// Extract version
			const versionMatch = text.match(/(?:ver\.|version)\s*(\d+(?:\.\d+)?)/i);
			if (versionMatch?.[1]) {
				fandom.lightstick.version = versionMatch[1];
			}

			foundLightstick = true;
			break;
		}
	}

	if (!foundLightstick) {
		fandom.lightstick = null;
	}

	return fandom;
}

function extractGroupInfo($: CheerioAPI): GroupInfo {
	const info: GroupInfo = {};

	// Extract debut date with improved validation
	const debutDateText = $('.data-grid .equal:contains("Debut:")').next('.equal').text();
	if (debutDateText) {
		const date = normalizeDate(debutDateText);
		if (date) info.debutDate = date;
	}

	// Extract debut song with better validation
	const debutSongText = $('.data-grid .equal:contains("Debut song:")').next('.equal').text();
	if (debutSongText) {
		const songName = cleanText(debutSongText.split('(')[0]); // Remove parenthetical info
		if (songName) info.debutSong = songName;
	}

	// Extract active years with improved period handling
	const activeYearsText = $('.data-grid .equal:contains("Active:")').next('.equal').text();
	if (activeYearsText) {
		const periods = activeYearsText.split(',').map(period => normalizePeriod(period)).filter(Boolean);
		if (periods.length > 0) {
			info.activeYears = periods;
		}
	}

	// Extract generation with validation
	const generationText = $('.data-grid .equal:contains("Generation:")').next('.equal').text();
	if (generationText) {
		const genMatch = generationText.match(/(\d+)(?:st|nd|rd|th)?/);
		if (genMatch?.[1]) {
			const gen = parseInt(genMatch[1]);
			if (gen > 0 && gen < 10) info.generation = gen;
		}
	}

	// Extract subunits with enhanced member and status tracking
	const subunits: NonNullable<GroupInfo['subunits']> = [];

	$('.subunits li, .sub-units li').each((_, el) => {
		const $unit = $(el);
		const name = cleanText($unit.find('.name').text());
		const members = $unit.find('.members').text()
			.split(/[,、]/)
			.map(cleanText)
			.filter(Boolean);

		const statusText = $unit.text().toLowerCase();
		const status = statusText.includes('disbanded') || statusText.includes('inactive') ? 'disbanded' : 'active';

		if (name && members.length > 0) {
			subunits.push({
				name,
				members,
				status
			});
		}
	});

	if (subunits.length > 0) {
		info.subunits = subunits;
	}

	return Object.keys(info).length > 0 ? info : undefined;
}

async function parseIdolProfile(url: string): Promise<Idol | null> {
	try {
		const html = await fetchWithRetry(url);
		const $ = cheerio.load(html);

		// Extract all components
		const names = extractNames($);
		const company = extractCompanyInfo($);
		const socialMedia = extractSocialMediaLinks($);
		const physicalInfo = extractIdolPhysicalInfo($);
		const personalInfo = extractIdolPersonalInfo($);
		const careerInfo = extractIdolCareerInfo($);
		const groups = extractIdolGroupHistory($);

		// Determine active status
		const statusText = $('.data-grid .equal:contains("Current state:")').next('.equal').text().toLowerCase();
		const active = !statusText.includes('inactive');
		const status = statusText.includes('hiatus') ? 'hiatus' : active ? 'active' : 'inactive';

		// Build idol profile
		const idol: Idol = {
			id: uuidv4(),
			profileUrl: url,
			imageUrl: extractImageUrl($),
			description: $('meta[name="description"]').attr('content'),
			names,
			active,
			status,
			...(company && { company }),
			...(socialMedia && { socialMedia }),
			...(physicalInfo && { physicalInfo }),
			...(personalInfo && { personalInfo }),
			...(careerInfo && { careerInfo }),
			...(groups && { groups }),
			facts: extractFacts($)
		};

		// Clean up undefined values
		return cleanupUndefined(idol);
	} catch (error) {
		console.error(`Error parsing idol profile ${url}:`, error);
		return null;
	}
}

async function parseGroupProfile(url: string): Promise<Group | null> {
	try {
		const html = await fetchWithRetry(url);
		const $ = cheerio.load(html);

		// Extract all components with proper validation
		const names = extractNames($);
		const company = extractCompanyInfo($);
		const socialMedia = extractSocialMediaLinks($);
		const memberHistory = extractGroupMembers($);
		const fandom = extractFandom($);
		const groupInfo = extractGroupInfo($);

		// Determine group type from URL and validate
		const typeMatch = url.match(/\/(?:profiles|groups)\/(?:the-groups\/)?([^/]+)/);
		const type: GroupType = typeMatch?.[1] === 'women' ? 'girl' :
			typeMatch?.[1] === 'men' ? 'boy' : 'co-ed';

		// Extract and validate status
		const statusText = $('.data-grid .equal:contains("Current state:")').next('.equal').text().toLowerCase();
		const status: GroupStatus = statusText.includes('disbanded') ? 'disbanded' :
			statusText.includes('hiatus') ? 'hiatus' :
				statusText.includes('sub-unit') ? 'sub-unit' :
					statusText.includes('inactive') ? 'inactive' : 'active';

		const active = status === 'active';

		// Calculate member counts with validation
		const memberCount = {
			current: memberHistory.currentMembers.length,
			peak: Math.max(
				memberHistory.currentMembers.length,
				memberHistory.currentMembers.length + (memberHistory.formerMembers?.length || 0)
			)
		};

		// Build group profile with strict typing
		const group: Group = {
			id: uuidv4(),
			profileUrl: url,
			imageUrl: extractImageUrl($),
			description: $('meta[name="description"]').attr('content'),
			names,
			active,
			status,
			type,
			memberCount,
			memberHistory,
			...(company && { company }),
			...(socialMedia && { socialMedia }),
			...(groupInfo && { groupInfo }),
			...(fandom && { fandom }),
			facts: extractFacts($)
		};

		// Clean up undefined values and validate against schema
		return cleanupUndefined(group);
	} catch (error) {
		console.error(`Error parsing group profile ${url}:`, error);
		return null;
	}
}

async function scrapeProfiles(options: {
	type: 'idol' | 'group';
	gender: 'female' | 'male' | 'coed';
	debug?: boolean;
	sampleSize?: number;
	random?: boolean;
}): Promise<(Idol | Group)[]> {
	const { type, gender, debug = false, sampleSize = 5, random = false } = options;

	// Determine endpoint
	const endpoint = type === 'idol' ?
		(gender === 'female' ? ENDPOINTS.femaleIdols : ENDPOINTS.maleIdols) :
		(gender === 'female' ? ENDPOINTS.girlGroups :
			gender === 'male' ? ENDPOINTS.boyGroups : ENDPOINTS.coedGroups);

	try {
		// Fetch profile list page
		const html = await fetchWithRetry(`${BASE_URL}${endpoint}`);
		const $ = cheerio.load(html);

		// Extract profile URLs
		let profileUrls = extractProfileLinks($);

		if (debug) {
			// Take sample of URLs for testing
			profileUrls = random ?
				profileUrls.sort(() => Math.random() - 0.5).slice(0, sampleSize) :
				profileUrls.slice(0, sampleSize);
		}

		// Parse profiles in parallel batches
		const profiles: (Idol | Group)[] = [];
		const batchSize = CONFIG.concurrentRequests;

		for (let i = 0; i < profileUrls.length; i += batchSize) {
			const batch = profileUrls.slice(i, i + batchSize);
			const batchResults = await Promise.all(
				batch.map(url =>
					type === 'idol' ? parseIdolProfile(url) : parseGroupProfile(url)
				)
			);

			profiles.push(...batchResults.filter((p): p is Idol | Group => p !== null));

			if ((i + batchSize) % CONFIG.batchLogInterval === 0 || i + batchSize >= profileUrls.length) {
				console.log(`Processed ${Math.min(i + batchSize, profileUrls.length)} of ${profileUrls.length} profiles...`);
			}
		}

		return profiles;
	} catch (error) {
		console.error(`Error scraping ${type} profiles:`, error);
		return [];
	}
}

export async function runDebugMode(options: {
	sampleSize: number;
	randomSamples: boolean;
	categories?: string[];
	batchSize: number;
	delayBetweenBatches: number;
}): Promise<void> {
	const { sampleSize, randomSamples, categories } = options;

	// Initialize dataset
	const dataset: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: []
	};

	// Determine which categories to scrape
	const scrapeCategories = categories || [
		'femaleIdols',
		'maleIdols',
		'girlGroups',
		'boyGroups',
		'coedGroups'
	];

	for (const category of scrapeCategories) {
		console.log(`\nScraping ${category}...`);

		const type = category.includes('Idols') ? 'idol' : 'group';
		const gender = category.includes('female') || category.includes('girl') ? 'female' :
			category.includes('male') || category.includes('boy') ? 'male' : 'coed';

		const profiles = await scrapeProfiles({
			type,
			gender,
			debug: true,
			sampleSize,
			random: randomSamples
		});

		dataset[category as keyof DataSet] = profiles as any;
	}

	// Save results
	await saveDataset(dataset);
	console.log('\nDebug scraping completed!');
}

export async function runProductionMode(options: {
	batchSize: number;
	delayBetweenBatches: number;
}): Promise<void> {
	console.log('Starting full production scrape...');

	// Initialize dataset
	const dataset: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: []
	};

	// Scrape all categories
	const categories = [
		{ type: 'idol' as const, gender: 'female' as const },
		{ type: 'idol' as const, gender: 'male' as const },
		{ type: 'group' as const, gender: 'female' as const },
		{ type: 'group' as const, gender: 'male' as const },
		{ type: 'group' as const, gender: 'coed' as const }
	];

	for (const { type, gender } of categories) {
		console.log(`\nScraping ${gender} ${type}s...`);

		const profiles = await scrapeProfiles({ type, gender });

		// Add to appropriate dataset category
		const category = type === 'idol' ?
			(gender === 'female' ? 'femaleIdols' : 'maleIdols') :
			(gender === 'female' ? 'girlGroups' :
				gender === 'male' ? 'boyGroups' : 'coedGroups');

		dataset[category] = profiles as any;
	}

	// Save final results
	await saveDataset(dataset);
	console.log('\nProduction scraping completed!');
}

export async function retryFailedUrls(options: {
	batchSize: number;
	delayBetweenBatches: number;
}): Promise<void> {
	console.log('Retrying previously failed URLs...');

	const failedUrlsPath = path.join(PATHS.DATA_DIR, 'failed_urls.json');
	if (!fs.existsSync(failedUrlsPath)) {
		console.error('No failed URLs file found.');
		return;
	}

	try {
		// Load failed URLs
		const failedUrls: Array<{ url: string; type: 'idol' | 'group' }> =
			JSON.parse(fs.readFileSync(failedUrlsPath, 'utf-8'));

		if (failedUrls.length === 0) {
			console.log('No failed URLs to retry.');
			return;
		}

		console.log(`Found ${failedUrls.length} failed URLs to retry...`);

		// Load existing dataset
		const dataset: DataSet = {
			femaleIdols: [],
			maleIdols: [],
			girlGroups: [],
			boyGroups: [],
			coedGroups: []
		};

		if (fs.existsSync(PATHS.IDOLS_FILE)) {
			const idolsData = JSON.parse(fs.readFileSync(PATHS.IDOLS_FILE, 'utf-8'));
			dataset.femaleIdols = idolsData.femaleIdols;
			dataset.maleIdols = idolsData.maleIdols;
		}

		if (fs.existsSync(PATHS.GROUPS_FILE)) {
			const groupsData = JSON.parse(fs.readFileSync(PATHS.GROUPS_FILE, 'utf-8'));
			dataset.girlGroups = groupsData.girlGroups;
			dataset.boyGroups = groupsData.boyGroups;
			dataset.coedGroups = groupsData.coedGroups;
		}

		// Process failed URLs in batches
		const { batchSize } = options;
		const successfulRetries: typeof failedUrls = [];
		const remainingFailures: typeof failedUrls = [];

		for (let i = 0; i < failedUrls.length; i += batchSize) {
			const batch = failedUrls.slice(i, i + batchSize);

			console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(failedUrls.length / batchSize)}...`);

			const results = await Promise.all(
				batch.map(async ({ url, type }) => {
					try {
						const profile = type === 'idol' ?
							await parseIdolProfile(url) :
							await parseGroupProfile(url);

						if (profile) {
							// Add to appropriate category
							if (type === 'idol') {
								const gender = url.includes('/women/') ? 'female' : 'male';
								if (gender === 'female') {
									dataset.femaleIdols.push(profile as any);
								} else {
									dataset.maleIdols.push(profile as any);
								}
							} else {
								const gender = url.includes('/women/') ? 'girl' :
									url.includes('/men/') ? 'boy' : 'coed';
								if (gender === 'girl') {
									dataset.girlGroups.push(profile as any);
								} else if (gender === 'boy') {
									dataset.boyGroups.push(profile as any);
								} else {
									dataset.coedGroups.push(profile as any);
								}
							}
							return { url, type, success: true };
						}
					} catch (error) {
						console.error(`Failed to retry ${url}:`, error);
					}
					return { url, type, success: false };
				})
			);

			// Separate successes and failures
			results.forEach(result => {
				if (result.success) {
					successfulRetries.push({ url: result.url, type: result.type });
				} else {
					remainingFailures.push({ url: result.url, type: result.type });
				}
			});

			// Save progress after each batch
			await saveDataset(dataset);

			if (i + batchSize < failedUrls.length) {
				console.log(`Waiting ${options.delayBetweenBatches}ms before next batch...`);
				await delay(options.delayBetweenBatches);
			}
		}

		// Update failed_urls.json with remaining failures
		if (remainingFailures.length > 0) {
			fs.writeFileSync(failedUrlsPath, JSON.stringify(remainingFailures, null, 2));
			console.log(`\n${remainingFailures.length} URLs still failed. These have been saved back to failed_urls.json`);
		} else {
			// All succeeded, remove the file
			fs.unlinkSync(failedUrlsPath);
			console.log('\nAll failed URLs were successfully retried!');
		}

		console.log(`\nSummary:`);
		console.log(`- Successfully retried: ${successfulRetries.length}`);
		console.log(`- Remaining failures: ${remainingFailures.length}`);

	} catch (error) {
		console.error('Error retrying failed URLs:', error);
	}
}

async function saveDataset(dataset: DataSet): Promise<void> {
	// Create data directory if it doesn't exist
	if (!fs.existsSync(PATHS.DATA_DIR)) {
		fs.mkdirSync(PATHS.DATA_DIR, { recursive: true });
	}

	// Save idols data without metadata
	const idolsData = {
		femaleIdols: dataset.femaleIdols,
		maleIdols: dataset.maleIdols
	};

	// Save groups data without metadata
	const groupsData = {
		girlGroups: dataset.girlGroups,
		boyGroups: dataset.boyGroups,
		coedGroups: dataset.coedGroups
	};

	// Generate metadata
	const metadata = {
		lastUpdated: new Date().toISOString(),
		version: '0.1.0',
		coverage: {
			startDate: dataset.femaleIdols.concat(dataset.maleIdols)
				.reduce((earliest, idol) => {
					const debutDate = idol.careerInfo?.debutDate;
					return debutDate && (!earliest || debutDate < earliest) ? debutDate : earliest;
				}, ''),
			endDate: new Date().toISOString().split('T')[0]
		},
		stats: {
			groups: {
				total: dataset.girlGroups.length + dataset.boyGroups.length + dataset.coedGroups.length,
				active: {
					girl: dataset.girlGroups.filter(g => g.active).length,
					boy: dataset.boyGroups.filter(g => g.active).length,
					coed: dataset.coedGroups.filter(g => g.active).length
				},
				disbanded: {
					girl: dataset.girlGroups.filter(g => g.status === 'disbanded').length,
					boy: dataset.boyGroups.filter(g => g.status === 'disbanded').length,
					coed: dataset.coedGroups.filter(g => g.status === 'disbanded').length
				}
			},
			idols: {
				total: dataset.femaleIdols.length + dataset.maleIdols.length,
				active: {
					female: dataset.femaleIdols.filter(i => i.active).length,
					male: dataset.maleIdols.filter(i => i.active).length
				},
				inactive: {
					female: dataset.femaleIdols.filter(i => !i.active).length,
					male: dataset.maleIdols.filter(i => !i.active).length
				}
			},
			total: (dataset.femaleIdols.length + dataset.maleIdols.length +
				dataset.girlGroups.length + dataset.boyGroups.length + dataset.coedGroups.length)
		}
	};

	// Write files
	fs.writeFileSync(PATHS.IDOLS_FILE, JSON.stringify(idolsData, null, 2));
	fs.writeFileSync(PATHS.GROUPS_FILE, JSON.stringify(groupsData, null, 2));
	fs.writeFileSync(PATHS.METADATA_FILE, JSON.stringify(metadata, null, 2));
}

// Clean up undefined/null values recursively
function cleanupUndefined<T extends object>(obj: T): T {
	for (const key in obj) {
		if (obj[key] === undefined || obj[key] === null) {
			delete obj[key];
		} else if (typeof obj[key] === 'object') {
			cleanupUndefined(obj[key]);
			if (Object.keys(obj[key]).length === 0) {
				delete obj[key];
			}
		}
	}
	return obj;
}

function normalizeDate(dateStr: string): string | undefined {
	if (!dateStr) return undefined;

	try {
		// Handle various date formats
		const cleanDate = dateStr.trim()
			.replace(/(\d+)(st|nd|rd|th)/, '$1') // Remove ordinals
			.replace(/[,，]/g, '') // Remove commas
			.replace(/[-.／/]/g, '-'); // Normalize separators

		// Try direct ISO format first
		if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
			const date = new Date(cleanDate);
			if (isValid(date)) {
				return cleanDate;
			}
		}

		// Handle common formats with improved validation
		const formats = [
			// Full date formats
			/^(\d{4})-(\d{1,2})-(\d{1,2})$/, // YYYY-MM-DD
			/^(\d{1,2})-(\d{1,2})-(\d{4})$/, // DD-MM-YYYY
			/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/, // Month DD, YYYY

			// Partial dates
			/^(\d{4})-(\d{1,2})$/, // YYYY-MM
			/^([A-Za-z]+)\s+(\d{4})$/, // Month YYYY
			/^(\d{4})$/ // YYYY only
		];

		for (const format of formats) {
			const match = cleanDate.match(format);
			if (match) {
				const [_, part1, part2, part3] = match;
				let year: string, month: string, day: string;

				if (isNaN(parseInt(part1))) {
					// Month DD, YYYY format
					const monthNum = new Date(`${part1} 1, 2000`).getMonth() + 1;
					if (isNaN(monthNum)) continue;

					year = part3;
					month = monthNum.toString().padStart(2, '0');
					day = part2?.padStart(2, '0') || '01';
				} else if (part1.length === 4) {
					// YYYY-MM-DD or YYYY-MM format
					year = part1;
					month = part2?.padStart(2, '0') || '01';
					day = part3?.padStart(2, '0') || '01';
				} else {
					// DD-MM-YYYY format
					year = part3;
					month = part2.padStart(2, '0');
					day = part1.padStart(2, '0');
				}

				// Validate parts
				if (parseInt(year) < 1900 || parseInt(year) > new Date().getFullYear() + 1) continue;
				if (parseInt(month) < 1 || parseInt(month) > 12) continue;
				if (parseInt(day) < 1 || parseInt(day) > 31) continue;

				const date = new Date(`${year}-${month}-${day}`);
				if (isValid(date)) {
					return `${year}-${month}-${day}`;
				}
			}
		}
	} catch (e) { }

	return undefined;
}

function normalizeColor(colorStr: string): string | undefined {
	if (!colorStr) return undefined;

	// Common color name mappings
	const colorMap: Record<string, string> = {
		'sky blue': '#87CEEB',
		'pearl aqua': '#88D8C0',
		'rose quartz': '#F7CAC9',
		'mint': '#98FF98',
		'cosmic latte': '#FFF8E7',
		'lilac': '#C8A2C8',
		'pastel pink': '#FFD1DC',
		'baby blue': '#89CFF0',
		'royal blue': '#4169E1'
	};

	// Clean and normalize color string
	const normalized = colorStr.toLowerCase().trim();

	// Check if it's a direct mapping
	if (colorMap[normalized]) {
		return colorMap[normalized];
	}

	// Check if it's already a hex color
	if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
		return normalized.toUpperCase();
	}

	// Check for RGB format
	const rgbMatch = normalized.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const [_, r, g, b] = rgbMatch;
		return `#${[r, g, b].map(n => parseInt(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
	}

	// Try to find the closest named color
	const colorWords = normalized.split(/[\s,]+/);
	for (const word of colorWords) {
		if (colorMap[word]) {
			return colorMap[word];
		}
	}

	return undefined;
}

function normalizePeriod(text: string): { start: string; end?: string } | undefined {
	if (!text) return undefined;

	// Clean up text
	const cleaned = text.toLowerCase()
		.replace(/[,，]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	// Handle different period formats with improved parsing
	const patterns = [
		// Full date ranges
		{
			pattern: /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:-|~|to|until)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
			handler: (m: RegExpMatchArray) => ({
				start: normalizeDate(m[1]),
				end: normalizeDate(m[2])
			})
		},
		// YYYY-present
		{
			pattern: /(\d{4})\s*(?:-|~|to|until)\s*(?:present|now)/i,
			handler: (m: RegExpMatchArray) => ({
				start: `${m[1]}-01-01`
			})
		},
		// YYYY-YYYY
		{
			pattern: /(\d{4})\s*(?:-|~|to|until)\s*(\d{4})/i,
			handler: (m: RegExpMatchArray) => ({
				start: `${m[1]}-01-01`,
				end: `${m[2]}-12-31`
			})
		},
		// Month YYYY-present
		{
			pattern: /([A-Za-z]+)\s+(\d{4})\s*(?:-|~|to|until)\s*(?:present|now)/i,
			handler: (m: RegExpMatchArray) => {
				const date = normalizeDate(`${m[1]} 1, ${m[2]}`);
				return date ? { start: date } : undefined;
			}
		},
		// Month YYYY-Month YYYY
		{
			pattern: /([A-Za-z]+)\s+(\d{4})\s*(?:-|~|to|until)\s*([A-Za-z]+)\s+(\d{4})/i,
			handler: (m: RegExpMatchArray) => {
				const start = normalizeDate(`${m[1]} 1, ${m[2]}`);
				const end = normalizeDate(`${m[3]} 1, ${m[4]}`);
				return start && end ? { start, end } : undefined;
			}
		}
	];

	for (const { pattern, handler } of patterns) {
		const match = cleaned.match(pattern);
		if (match) {
			const result = handler(match);
			if (result?.start) {
				return result;
			}
		}
	}

	// Try parsing single dates
	const singleDate = normalizeDate(cleaned);
	if (singleDate) {
		return { start: singleDate };
	}

	return undefined;
}

function normalizeBloodType(text: string): BloodType | undefined {
	if (!text) return undefined;

	// Clean and normalize blood type string with improved handling
	const normalized = text.toUpperCase().trim()
		.replace(/\s+/g, '')
		.replace(/TYPE|GROUP|혈액형/gi, '')  // Also handle Korean text
		.replace(/[^A-Z+-]/g, '');

	// Enhanced blood type mapping with common variations
	const bloodTypeMap: Record<string, BloodType> = {
		'A': 'A', 'B': 'B', 'O': 'O', 'AB': 'AB',
		'APOSITIVE': 'A+', 'ANEGATIVE': 'A-',
		'BPOSITIVE': 'B+', 'BNEGATIVE': 'B-',
		'OPOSITIVE': 'O+', 'ONEGATIVE': 'O-',
		'ABPOSITIVE': 'AB+', 'ABNEGATIVE': 'AB-',
		'A+': 'A+', 'A-': 'A-',
		'B+': 'B+', 'B-': 'B-',
		'O+': 'O+', 'O-': 'O-',
		'AB+': 'AB+', 'AB-': 'AB-'
	};

	// Try exact match first
	if (bloodTypeMap[normalized]) {
		return bloodTypeMap[normalized];
	}

	// Handle cases where RH factor might be separated
	const rhMatch = normalized.match(/^(A|B|O|AB)[\s]*([+-])?$/);
	if (rhMatch) {
		const [_, type, rh] = rhMatch;
		const bloodType = rh ? `${type}${rh}` : type;
		return bloodTypeMap[bloodType];
	}

	return undefined;
}

function extractGroupMembers($: cheerio.CheerioAPI): {
	currentMembers: GroupMember[];
	formerMembers?: GroupMember[];
} {
	const members = {
		currentMembers: [] as GroupMember[],
		formerMembers: [] as GroupMember[]
	};

	// Extract current members with enhanced position parsing
	$('.members-list .current-member, .members .current-member').each((_, el) => {
		const $member = $(el);
		const name = cleanText($member.find('.name').text());
		const profileUrl = $member.find('a').attr('href');
		const positionsText = $member.find('.position, .role').text();
		const periodText = $member.find('.period').text();

		if (name) {
			const member: GroupMember = {
				name,
				...(profileUrl && { profileUrl: profileUrl.startsWith('http') ? profileUrl : `${BASE_URL}${profileUrl}` })
			};

			// Enhanced position parsing
			if (positionsText) {
				const positions = parsePositions(positionsText);
				if (positions.length > 0) {
					member.position = positions;
				}
			}

			// Extract period if available
			if (periodText) {
				const period = normalizePeriod(periodText);
				if (period) {
					member.period = period;
				}
			}

			members.currentMembers.push(member);
		}
	});

	// Extract former members with same enhancements
	$('.members-list .former-member, .members .former-member').each((_, el) => {
		const $member = $(el);
		const name = cleanText($member.find('.name').text());
		const profileUrl = $member.find('a').attr('href');
		const positionsText = $member.find('.position, .role').text();
		const periodText = $member.find('.period').text();

		if (name) {
			const member: GroupMember = {
				name,
				...(profileUrl && { profileUrl: profileUrl.startsWith('http') ? profileUrl : `${BASE_URL}${profileUrl}` })
			};

			// Enhanced position parsing
			if (positionsText) {
				const positions = parsePositions(positionsText);
				if (positions.length > 0) {
					member.position = positions;
				}
			}

			// Extract period if available
			if (periodText) {
				const period = normalizePeriod(periodText);
				if (period) {
					member.period = period;
				}
			}

			members.formerMembers.push(member);
		}
	});

	// Only include formerMembers if there are any
	if (members.formerMembers.length === 0) {
		delete members.formerMembers;
	}

	return members;
}

// Add ISO country code mapping
const ISO_COUNTRIES: Record<string, string> = {
	'KR': 'South Korea',
	'JP': 'Japan',
	'CN': 'China',
	'TW': 'Taiwan',
	'US': 'United States',
	'TH': 'Thailand',
	// Add more as needed
};