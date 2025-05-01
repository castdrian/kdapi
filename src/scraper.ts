import { fetch } from 'undici';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs';
import * as path from 'path';
import { CacheManager } from './cache';
import type {
	GroupMember, DataSet,
	IdolPosition,
	SocialMedia,
	CoreProfile,
	Group,
	Idol,
	Fandom,
	Fact
} from './types';

export {
	runDebugMode,
	runProductionMode,
	scrapeProfiles
};

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
	retryAttempts: 5, // Increased from 3
	retryDelay: 2000, // Increased from 1000
	requestTimeout: 30000, // Increased from 20000
	rateLimitDelay: 2000, // Increased from 1000
	maxRequestsPerMinute: 30, // Reduced from 60
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

// Add logging utility after CONFIG
const logger = {
	info: (msg: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
	warn: (msg: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
	error: (msg: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
	success: (msg: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`)
};

// Track failed requests to implement backoff strategy
const failedRequests = new Map<string, { count: number; lastAttempt: number }>();

const cache = new CacheManager();

let startTime = Date.now();

async function shouldRetry(url: string): Promise<boolean> {
	const failed = failedRequests.get(url);
	if (!failed) return true;

	// More lenient backoff
	const now = Date.now();
	const timeSinceLastAttempt = now - failed.lastAttempt;
	const backoffTime = Math.min(
		CONFIG.retryDelay * Math.pow(1.5, failed.count), // Changed from 2 to 1.5
		30000 // Max 30s delay instead of 60s
	);

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
	const maxAttempts = CONFIG.retryAttempts;
	let attempt = 0;

	while (attempt < maxAttempts) {
		try {
			if (attempt > 0) {
				logger.warn(`Retrying ${url} (attempt ${attempt + 1}/${maxAttempts})`);
				const backoff = Math.min(CONFIG.retryDelay * Math.pow(1.5, attempt), 30000);
				await delay(backoff);
			}

			await rateLimiter.getToken();
			logger.info(`Fetching ${url}`);

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
				attempt++;
				const retryAfter = response.headers.get('Retry-After');
				const delay = retryAfter ? parseInt(retryAfter) * 1000 : CONFIG.retryDelay * Math.pow(1.5, attempt);
				logger.warn(`Rate limited, waiting ${delay}ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
				continue;
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const text = await response.text();
			if (text.length < 500 || text.includes('Too Many Requests')) {
				throw new Error('Invalid response received');
			}

			logger.success(`Successfully fetched ${url}`);
			failedRequests.delete(url);
			return text;

		} catch (error) {
			attempt++;
			logger.error(`Failed to fetch ${url}: ${error.message}`);

			if (attempt >= maxAttempts) {
				logger.error(`Max retry attempts (${maxAttempts}) reached for ${url}`);
				throw error;
			}
		}
	}

	throw new Error('Max retry attempts reached');
}

async function parseProfileWithCache(
	url: string,
	type: 'idol' | 'group',
	forceRefresh = false
): Promise<string> {
	// Check cache first unless force refresh
	if (!forceRefresh) {
		const cached = await cache.get(type, url);
		if (cached) {
			logger.info(`Cache hit for ${url}`);
			return cached;
		}
	}

	// Fetch and cache if needed
	logger.info(`Cache miss for ${url}, fetching...`);
	const html = await fetchWithRetry(url);
	await cache.set(type, url, html);
	return html;
}

async function saveDataset(dataset: DataSet): Promise<void> {
	// Create data directory if it doesn't exist
	if (!fs.existsSync(PATHS.DATA_DIR)) {
		fs.mkdirSync(PATHS.DATA_DIR, { recursive: true });
	}

	try {
		// Save groups data
		const groupsData = {
			girlGroups: dataset.girlGroups,
			boyGroups: dataset.boyGroups,
			coedGroups: dataset.coedGroups
		};
		fs.writeFileSync(PATHS.GROUPS_FILE, JSON.stringify(groupsData, null, 2));
		logger.success('Saved groups data');

		// Save idols data
		const idolsData = {
			femaleIdols: dataset.femaleIdols,
			maleIdols: dataset.maleIdols
		};
		fs.writeFileSync(PATHS.IDOLS_FILE, JSON.stringify(idolsData, null, 2));
		logger.success('Saved idols data');

		// Generate and save metadata
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
		fs.writeFileSync(PATHS.METADATA_FILE, JSON.stringify(metadata, null, 2));
		logger.success('Saved metadata');

	} catch (error) {
		logger.error(`Failed to save dataset: ${error.message}`);
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

function extractSocialMediaLinks($: cheerio.CheerioAPI): SocialMedia {
	const socialMedia: SocialMedia = {};

	$('.socials a, .social-links a').each((_, el) => {
		const href = $(el).attr('href');
		if (!href) return;

		// Skip kpopping.com and irrelevant links
		if (href.includes('kpopping.com') ||
			href.includes('discord.gg') ||
			href.includes('google.com')) return;

		try {
			const url = new URL(href);
			const cleanUrl = url.origin + url.pathname; // Remove tracking params

			if (url.hostname.includes('instagram.com')) socialMedia.instagram = cleanUrl;
			else if (url.hostname.includes('twitter.com') || url.hostname.includes('x.com')) {
				socialMedia.twitter = cleanUrl;
			}
			else if (url.hostname.includes('facebook.com') && !url.pathname.includes('KPopping-')) {
				socialMedia.facebook = cleanUrl;
			}
			else if (url.hostname.includes('youtube.com')) socialMedia.youtube = cleanUrl;
			else if (url.hostname.includes('spotify.com')) socialMedia.spotify = cleanUrl;
			else if (url.hostname.includes('weibo.com')) socialMedia.weibo = cleanUrl;
			else if (url.hostname.includes('tiktok.com')) socialMedia.tiktok = cleanUrl;
			else if (url.hostname.includes('vlive.tv')) socialMedia.vlive = cleanUrl;
			else if (url.hostname.includes('cafe.daum.net')) socialMedia.fancafe = cleanUrl;
			else socialMedia.website = cleanUrl;
		} catch (e) {
			// Invalid URL, skip
		}
	});

	return socialMedia;
}

function extractFacts($: cheerio.CheerioAPI): Fact[] {
	const facts: Fact[] = [];

	// Look for structured facts sections
	$('.facts li, .fun-facts li, .profile-facts li').each((_, el) => {
		const $fact = $(el);
		const content = cleanText($fact.text());

		// Skip empty/invalid facts
		if (!content || content.length < 10) return;

		const fact: Fact = {
			content,
			category: categorizeFact(content)
		};

		// Try to extract date if present
		const dateMatch = content.match(/\((\d{4}(?:-\d{2})?(?:-\d{2})?)\)/);
		if (dateMatch) fact.date = normalizeDate(dateMatch[1]);

		facts.push(fact);
	});

	// Extract facts from description paragraphs
	$('.profile-content p, .biography p').each((_, el) => {
		const text = cleanText($(el).text());
		if (!text) return;

		// Split into sentences and analyze each
		text.split(/[.!?]\s+/).forEach(sentence => {
			if (sentence.length < 10) return;

			// Look for fact indicators
			if (isFact(sentence)) {
				facts.push({
					content: sentence,
					category: categorizeFact(sentence)
				});
			}
		});
	});

	// Look for controversy/news sections
	$('.news li, .controversies li').each((_, el) => {
		const content = cleanText($(el).text());
		if (!content) return;

		facts.push({
			content,
			category: 'controversy',
			date: extractDateFromText(content)
		});
	});

	return facts;
}

function categorizeFact(content: string): Fact['category'] {
	const lowerContent = content.toLowerCase();

	// Personal facts
	if (/family|sibling|parent|relative|born|grew up|childhood|personality|hobby|interest|favorite|likes|dislikes/.test(lowerContent)) {
		return 'personal';
	}

	// Career facts
	if (/debut|training|company|group|position|award|achievement|performance|promotion|concert|album|song|music/.test(lowerContent)) {
		return 'career';
	}

	// Pre-debut facts
	if (/trainee|audition|pre-debut|before debut|prior to debut|school|education/.test(lowerContent)) {
		return 'pre-debut';
	}

	// Controversy facts
	if (/scandal|controversy|issue|dispute|criticism|apologize|conflict|rumor/.test(lowerContent)) {
		return 'controversy';
	}

	return 'trivia';
}

function isFact(text: string): boolean {
	// Ignore navigation text, headers, etc.
	if (text.length < 10 || /menu|click|page|loading|error|cookie|privacy|terms/i.test(text)) {
		return false;
	}

	// Look for fact indicators
	return /^(?:[\-•★☆]|(?:he|she|they|the group|in|on|during|after|before)\s)/i.test(text) ||
		/(?:revealed|mentioned|stated|shared|confirmed|announced)/i.test(text) ||
		/(?:because|when|while|after|before|during)\s/i.test(text);
}

function extractDateFromText(text: string): string | null {
	if (!text) return null;

	// Handle various date formats
	const patterns = [
		// Standard date formats
		/(\d{4})[-.／](\d{1,2})[-.／](\d{1,2})/,
		// Month name formats
		/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
		// Year-month only
		/(\d{4})[-.／](\d{1,2})/,
		// Year only
		/(\d{4})/
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const [_, year, month, day] = match;
			if (day) {
				return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
			}
			if (month) {
				return `${year}-${month.padStart(2, '0')}-01`;
			}
			return `${year}-01-01`;
		}
	}

	return null;
}

function extractNames($: cheerio.CheerioAPI): CoreProfile['names'] {
	const names = {
		stage: '',
		korean: null,
		japanese: null,
		chinese: null,
		english: null,
		birth: {
			latin: null,
			hangeul: null,
			japanese: null,
			chinese: null
		}
	};

	// Get stage name from h1
	names.stage = $('h1').first().text().trim().split(/[(\n]/, 1)[0].trim();

	// Extract native names properly
	$('.native-name').each((_, el) => {
		const $el = $(el);
		const type = $el.find('dfn').text().toLowerCase();
		const name = cleanText($el.text().replace(/^[^:]+:\s*/, ''));

		if (!name || name === '-') return;

		if (type.includes('korean')) names.korean = name;
		else if (type.includes('japanese')) names.japanese = name;
		else if (type.includes('chinese')) names.chinese = name;
		else if (type.includes('birth')) {
			if (type.includes('latin')) names.birth.latin = name;
			if (type.includes('hangeul')) names.birth.hangeul = name;
			if (type.includes('japanese')) names.birth.japanese = name;
			if (type.includes('chinese')) names.birth.chinese = name;
		}
	});

	// Remove birth object if this is a group profile
	if ($('#idol-associated-groups').length === 0) {
		delete names.birth;
	}

	return cleanupUndefined(names);
}

function extractCompanyInfo($: cheerio.CheerioAPI): NonNullable<CoreProfile['company']> {
	const company: NonNullable<CoreProfile['company']> = {
		current: null,
		history: []
	};

	// Get current company from company history/info section
	$('#star-companies .cell, #company-info .cell').each((_, el) => {
		const $cell = $(el);
		const name = $cell.find('.name a').text().trim();
		const periodText = $cell.find('.value').text().trim();

		if (!name) return;

		const period = parsePeriod(periodText);
		if (!period?.end) {
			company.current = name;
		}

		if (period) {
			company.history.push({
				name,
				period
			});
		}
	});

	return cleanupUndefined(company);
}

async function extractGroupData($: cheerio.CheerioAPI, url: string): Promise<Group> {
	const group: Group = {
		id: uuidv4(),
		profileUrl: url,
		imageUrl: extractImageUrl($) || null,
		names: extractNames($),
		type: 'group',
		active: $('.data-grid .equal:contains("Current state:")').next().text().trim() === 'active',
		status: $('.data-grid .equal:contains("Current state:")').next().text().includes('active') ?
			'active' : 'disbanded',
		company: extractCompanyInfo($) || null,
		socialMedia: extractSocialMediaLinks($),
		facts: extractFacts($),
		memberHistory: {
			currentMembers: [],
			formerMembers: []
		}
	};

	// Fix Korean name parsing
	const $koreanName = $('.native-name').filter((_, el) => {
		const type = $(el).find('dfn').text().toLowerCase();
		return type.includes('korean') && !type.includes('birth');
	}).first();

	if ($koreanName.length) {
		const name = cleanText($koreanName.text().replace(/^[^:]+:\s*/, ''));
		if (name && name !== '-') {
			group.names.korean = name;
		}
	}

	// Extract debut and disbandment dates
	const debutDateText = $('.data-grid .equal:contains("Debut:")').next().text().trim();
	if (debutDateText) {
		if (!group.groupInfo) group.groupInfo = {};
		group.groupInfo.debutDate = normalizeDate(debutDateText);
	}

	if (group.status === 'disbanded') {
		const disbandmentText = $('.data-grid .equal:contains("Disbandment:")').next().text().trim();
		if (disbandmentText) {
			if (!group.groupInfo) group.groupInfo = {};
			group.groupInfo.disbandmentDate = normalizeDate(disbandmentText);
		}
	}

	// Extract fandom data
	const fandom: Group['fandom'] = {
		name: null,
		color: null,
		lightstick: null,
		fanCafe: null
	};

	// Extract fandom name
	const $fandomName = $('.data-grid .equal:contains("Fandom:")').next();
	if ($fandomName.length) {
		const name = cleanText($fandomName.text());
		if (name && name !== '-') {
			fandom.name = name;
		}
	}

	// Extract color 
	const $color = $('.data-grid .equal:contains("Color:")').next();
	if ($color.length) {
		const color = cleanText($color.text());
		if (color && color !== '-') {
			fandom.color = color;
		}
	}

	// Extract fan cafe
	const $fanCafe = $('.sidebar-associated-links a[href*="cafe.daum"]');
	if ($fanCafe.length) {
		fandom.fanCafe = {
			name: $fanCafe.text().trim() || null,
			url: $fanCafe.attr('href') || null
		};
	}

	// Extract lightstick info
	const $lightstick = $('.profile-content:contains("Lightstick")');
	if ($lightstick.length) {
		fandom.lightstick = {
			name: $lightstick.find('h3, strong').first().text().trim() || null,
			imageUrl: $lightstick.find('img').attr('src') || null,
			description: $lightstick.find('p').text().trim() || null,
			version: $lightstick.text().match(/Ver(?:sion)?\s*(\d+)/i)?.[1] || null,
			releaseDate: extractDateFromText($lightstick.text()) || null
		};
	}

	if (Object.values(fandom).some(v => v !== null)) {
		group.fandom = fandom;
	}

	// Extract member history with positions
	const memberHistory = {
		currentMembers: [] as GroupMember[],
		formerMembers: [] as GroupMember[]
	};

	// Current members with positions
	$('.members-list .current-member, .member-info .active').each((_, el) => {
		const $member = $(el);
		const name = $member.find('.name').text().trim();
		const positionText = $member.find('.position').text().trim();
		const periodText = $member.find('.period').text().trim();

		if (name) {
			const member: GroupMember = {
				name,
				profileUrl: ($member.find('a').attr('href') || '').startsWith('http') ?
					$member.find('a').attr('href') || undefined :
					`${BASE_URL}${$member.find('a').attr('href')}`,
				position: positionText ? parsePositions(positionText) : undefined,
				period: periodText ? parsePeriod(periodText) : undefined
			};
			memberHistory.currentMembers.push(cleanupUndefined(member));
		}
	});

	// Former members with positions
	$('.members-list .former-member, .member-info .inactive').each((_, el) => {
		const $member = $(el);
		const name = $member.find('.name').text().trim();
		const positionText = $member.find('.position').text().trim();
		const periodText = $member.find('.period').text().trim();

		if (name) {
			const member: GroupMember = {
				name,
				profileUrl: ($member.find('a').attr('href') || '').startsWith('http') ?
					$member.find('a').attr('href') || undefined :
					`${BASE_URL}${$member.find('a').attr('href')}`,
				position: positionText ? parsePositions(positionText) : undefined,
				period: periodText ? parsePeriod(periodText) : undefined
			};
			memberHistory.formerMembers.push(cleanupUndefined(member));
		}
	});

	group.memberHistory = memberHistory;

	return cleanupUndefined(group);
}

async function extractIdolData($: cheerio.CheerioAPI, url: string): Promise<Idol> {
	const idol: Idol = {
		id: uuidv4(),
		profileUrl: url,
		imageUrl: extractImageUrl($) || null,
		names: extractNames($),
		active: false, // Will be set below
		status: 'inactive', // Will be set below
		company: extractCompanyInfo($) || null,
		socialMedia: extractSocialMediaLinks($),
		facts: extractFacts($)
	};

	// Determine active status properly
	const statusText = $('.data-grid .equal:contains("Current state:")').next().text().trim();
	idol.active = statusText === 'active';
	idol.status = statusText === 'active' ? 'active' :
		statusText.includes('hiatus') ? 'hiatus' : 'inactive';

	// Extract MBTI
	const mbtiText = $('.data-grid .cell:contains("MBTI:")').find('.value').text().trim();
	if (mbtiText && mbtiText.match(/^[IE][NS][FT][JP]$/)) {
		if (!idol.personalInfo) idol.personalInfo = {};
		idol.personalInfo.mbti = mbtiText;
	}

	// Extract physical info
	const physicalInfo = extractPhysicalInfo($);
	if (Object.keys(physicalInfo).length > 0) {
		idol.physicalInfo = physicalInfo;
	}

	// Extract career info with proper debut date
	const careerInfo = extractIdolCareerInfo($);
	if (Object.keys(careerInfo).length > 0) {
		idol.careerInfo = careerInfo;
	}

	// Extract debut info
	const debutText = $('.data-grid .cell:contains("Debut:")').find('.value').text().trim();
	if (debutText) {
		const debutDate = normalizeDate(debutText);
		if (debutDate) {
			if (!idol.careerInfo) idol.careerInfo = {};
			idol.careerInfo.debutDate = debutDate;
		}
	}

	// Extract personal info
	const personalInfo = extractIdolPersonalInfo($);
	if (Object.keys(personalInfo).length > 0) {
		idol.personalInfo = personalInfo;
	}

	// Extract group affiliations
	const groups = [];
	$('#idol-associated-groups .group').each((_, el) => {
		const $group = $(el);
		const name = $group.find('h4 a').text().trim();
		const status = $group.find('figcaption i').hasClass('fa-play-circle') ? 'current' : 'former';

		if (name) {
			const group = {
				name,
				status,
				period: parsePeriod($group.find('figcaption span').text())
			};

			const positionText = $group.find('.position, .roles').text().trim();
			if (positionText) {
				const positions = parsePositions(positionText);
				if (positions.length > 0) group.position = positions;
			}

			groups.push(group);
		}
	});

	if (groups.length > 0) {
		idol.groups = groups;
	}

	// Extract birth name more thoroughly
	const $birthName = $('.native-name').filter((_, el) => {
		const type = $(el).find('dfn').text().toLowerCase();
		return type.includes('birth') || type.includes('real name');
	}).first();

	if ($birthName.length) {
		const name = cleanText($birthName.clone().children().remove().end().text());
		const korean = $birthName.find('.korean').text().trim();
		const japanese = $birthName.find('.japanese').text().trim();
		const chinese = $birthName.find('.chinese').text().trim();

		if (name) {
			idol.names.birth = {
				latin: name.replace(/^[^:]+:\s*/, '').trim(),
				hangeul: korean || null,
				japanese: japanese || null,
				chinese: chinese || null
			};
		}
	}

	// Extract positions from groups
	const positions = new Set<IdolPosition>();
	$('#idol-associated-groups .group').each((_, el) => {
		const $group = $(el);
		const positionText = $group.find('.position, .roles').text().trim();
		if (positionText) {
			parsePositions(positionText).forEach(p => positions.add(p));
		}
	});

	if (positions.size > 0) {
		if (!idol.careerInfo) idol.careerInfo = {};
		idol.careerInfo.positions = Array.from(positions);
	}

	// Extract facts more thoroughly
	const facts: Fact[] = [];

	// Extract from facts sections
	$('.facts li, .fun-facts li, .profile-facts li').each((_, el) => {
		const text = cleanText($(el).text());
		if (text && text.length > 10) {
			facts.push({
				content: text,
				category: categorizeFact(text),
				date: extractDateFromText(text)
			});
		}
	});

	// Extract from biography paragraphs
	$('.profile-content p, .biography p').each((_, el) => {
		const text = cleanText($(el).text());
		text.split(/[.!?]\s+/).forEach(sentence => {
			if (sentence.length > 10 && isFact(sentence)) {
				facts.push({
					content: sentence,
					category: categorizeFact(sentence)
				});
			}
		});
	});

	idol.facts = facts;

	return cleanupUndefined(idol);
}

function extractPhysicalInfo($: cheerio.CheerioAPI): NonNullable<Idol['physicalInfo']> {
	const info: NonNullable<Idol['physicalInfo']> = {};

	// Extract birth date
	const birthCell = $('.data-grid .equal:contains("Birthday:")');
	if (birthCell.length) {
		const birthText = birthCell.next().text().trim();
		const date = extractDateFromText(birthText);
		if (date) {
			info.birthDate = date;
			info.zodiacSign = calculateZodiacSign(date);
		}
	}

	// Extract MBTI properly
	const mbtiCell = $('.data-grid .equal:contains("MBTI:")');
	if (mbtiCell.length) {
		const mbtiText = mbtiCell.next().text().trim().toUpperCase();
		if (mbtiText.match(/^[IE][NS][FT][JP]$/)) {
			info.mbti = mbtiText;
		}
	}

	// Height
	const heightText = $('.data-grid .equal:contains("Height:")').next().text();
	const heightMatch = heightText.match(/(\d+)\s*cm/);
	if (heightMatch) info.height = parseInt(heightMatch[1]);

	// Weight  
	const weightText = $('.data-grid .equal:contains("Weight:")').next().text();
	const weightMatch = weightText.match(/(\d+)\s*kg/);
	if (weightMatch) info.weight = parseInt(weightMatch[1]);

	// Blood Type
	const bloodText = $('.data-grid .equal:contains("Blood type:")').next().text().trim().toUpperCase();
	if (['A', 'B', 'AB', 'O'].includes(bloodText)) {
		info.bloodType = bloodText as 'A' | 'B' | 'AB' | 'O';
	}

	return cleanupUndefined(info);
}

function extractFandom($: cheerio.CheerioAPI): NonNullable<Group['fandom']> {
	const fandom: NonNullable<Group['fandom']> = {
		name: null,
		color: null,
		lightstick: null,
		fanCafe: null
	};

	// Try to extract fandom name
	const fandomCell = $('.data-grid .equal:contains("Fandom:")');
	if (fandomCell.length) {
		const fandomText = fandomCell.next().text().trim();
		if (fandomText && fandomText !== '-') {
			fandom.name = fandomText;
		}
	}

	// Try to extract color
	const colorCell = $('.data-grid .equal:contains("Color:")');
	if (colorCell.length) {
		const colorText = colorCell.next().text().trim();
		if (colorText && colorText !== '-') {
			fandom.color = colorText;
		}
	}

	// Extract lightstick info
	const $lightstick = $('.profile-content:contains("Lightstick")');
	if ($lightstick.length) {
		fandom.lightstick = {
			name: $lightstick.find('h3, strong').first().text().trim() || null,
			imageUrl: $lightstick.find('img').attr('src') || null,
			description: $lightstick.find('p').text().trim() || null,
			version: $lightstick.text().match(/Ver(?:sion)?\s*(\d+)/i)?.[1] || null,
			releaseDate: extractDateFromText($lightstick.text()) || null
		};
	}

	// Extract fan cafe
	const $fanCafe = $('.sidebar-associated-links a[href*="cafe.daum"]');
	if ($fanCafe.length) {
		fandom.fanCafe = {
			name: $fanCafe.text().trim() || null,
			url: $fanCafe.attr('href') || null
		};
	}

	return cleanupUndefined(fandom);
}

function extractMemberInfo($: cheerio.CheerioAPI, element: cheerio.Element): GroupMember | null {
	const $member = $(element);
	const name = cleanText($member.find('.name strong').text() || $member.find('.name').text());
	if (!name) return null;

	const member: GroupMember = { name };

	const profileUrl = $member.attr('href') || $member.find('a').attr('href');
	if (profileUrl) {
		member.profileUrl = profileUrl.startsWith('http') ?
			profileUrl : `${BASE_URL}${profileUrl}`;
	}

	// Extract positions from various possible locations
	const positionText = $member.find('p:contains("Position:")').text() ||
		$member.find('.position').text() ||
		$member.parent().next('.position').text();
	if (positionText) {
		const positions = parsePositions(positionText.replace('Position:', ''));
		if (positions.length > 0) member.position = positions;
	}

	// Extract period
	const periodText = $member.find('.period').text() ||
		$member.find('.dates').text() ||
		$member.parent().next('.dates').text();
	if (periodText) {
		const period = parsePeriod(periodText);
		if (period) member.period = period;
	}

	return member;
}

function extractIdolCareerInfo($: cheerio.CheerioAPI): NonNullable<Idol['careerInfo']> {
	const info: NonNullable<Idol['careerInfo']> = {};

	// Extract debut date
	const debutCell = $('.data-grid .equal:contains("Debut:")');
	if (debutCell.length) {
		const debutText = debutCell.next().text().trim();
		const date = extractDateFromText(debutText);
		if (date) info.debutDate = date;
	}

	// Extract training period with company name
	const trainingText = $('.data-grid .equal:contains("Training period:")').next().text().trim();
	if (trainingText && trainingText !== '-') {
		const period = parsePeriod(trainingText);
		if (period) {
			const company = trainingText.match(/(?:at|under|with)\s+([^(]+)/)?.[1]?.trim();
			info.trainingPeriod = {
				duration: calculateDuration(period.start, period.end),
				start: period.start,
				end: period.end,
				...(company && { company })
			};
		}
	}

	// Extract active years
	const activeYearsText = $('.data-grid .equal:contains("Active years:")').next().text().trim();
	if (activeYearsText) {
		info.activeYears = activeYearsText.split(',').map(period => {
			const [start, end] = period.trim().split('-');
			return {
				start: `${start.trim()}-01-01`,
				end: end ? `${end.trim()}-12-31` : undefined
			};
		});
	}

	// Extract show appearances
	$('.shows .show, .appearances .item').each((_, el) => {
		if (!info.showAppearances) info.showAppearances = [];

		const $show = $(el);
		const showName = $show.find('.name').text().trim();
		const showYear = $show.find('.year').text().trim();
		const showType = $show.find('.type').text().trim().toLowerCase();

		if (showName) {
			info.showAppearances.push({
				name: showName,
				year: showYear || undefined,
				type: determineShowType(showType)
			});
		}
	});

	return cleanupUndefined(info);
}

function extractIdolPersonalInfo($: cheerio.CheerioAPI): NonNullable<Idol['personalInfo']> {
	const info: NonNullable<Idol['personalInfo']> = {};

	// Extract nationality
	const nationalityText = $('.data-grid .equal:contains("Country:")').next().text().trim();
	if (nationalityText) {
		info.nationality = nationalityText;
	}

	// Extract birthplace
	const birthplaceText = $('.data-grid .equal:contains("Birthplace:")').next().text().trim();
	if (birthplaceText) {
		const [city, region, country] = birthplaceText.split(',').map(p => p.trim());
		info.birthplace = {
			city,
			region: region || undefined,
			country: country || 'South Korea'
		};
	}

	// Extract education
	const educationText = $('.data-grid .equal:contains("Education:")').next().text().trim();
	if (educationText && educationText !== '-') {
		info.education = educationText.split(',').map(school => ({
			school: school.trim(),
			type: determineEducationType(school.trim())
		}));
	}

	// Extract languages
	const languagesText = $('.data-grid .equal:contains("Language(s):")').next().text().trim();
	if (languagesText && languagesText !== '-') {
		info.languages = languagesText.split(',').map(lang => ({
			language: lang.trim(),
			level: determineLangLevel(lang.trim())
		}));
	}

	// Extract hobbies and specialties
	const hobbiesText = $('.data-grid .equal:contains("Hobbies:")').next().text().trim();
	if (hobbiesText && hobbiesText !== '-') {
		info.hobbies = hobbiesText.split(',').map(h => h.trim());
	}

	const specialtiesText = $('.data-grid .equal:contains("Specialties:")').next().text().trim();
	if (specialtiesText && specialtiesText !== '-') {
		info.specialties = specialtiesText.split(',').map(s => s.trim());
	}

	return cleanupUndefined(info);
}

function determineEducationType(school: string): Idol['personalInfo']['education'][0]['type'] {
	const lower = school.toLowerCase();
	if (lower.includes('university') || lower.includes('college')) return 'university';
	if (lower.includes('high')) return 'high school';
	if (lower.includes('middle')) return 'middle';
	if (lower.includes('elementary')) return 'elementary';
	return undefined;
}

function determineLangLevel(lang: string): NonNullable<Idol['personalInfo']['languages']>[0]['level'] {
	const lower = lang.toLowerCase();
	if (lower.includes('native')) return 'native';
	if (lower.includes('fluent')) return 'fluent';
	if (lower.includes('intermediate')) return 'intermediate';
	if (lower.includes('basic')) return 'basic';
	return undefined;
}

function determineShowType(type: string): NonNullable<Idol['careerInfo']['showAppearances']>[0]['type'] {
	const lower = type.toLowerCase();
	if (lower.includes('survival')) return 'survival';
	if (lower.includes('variety')) return 'variety';
	if (lower.includes('drama')) return 'drama';
	if (lower.includes('musical')) return 'musical';
	if (lower.includes('radio')) return 'radio';
	if (lower.includes('web')) return 'web';
	return undefined;
}

function calculateDuration(start: string, end?: string): string {
	const startDate = new Date(start);
	const endDate = end ? new Date(end) : new Date();
	const months = (endDate.getFullYear() - startDate.getFullYear()) * 12
		+ (endDate.getMonth() - startDate.getMonth());

	if (months < 12) return `${months} months`;
	const years = Math.floor(months / 12);
	const remainingMonths = months % 12;
	return remainingMonths > 0 ?
		`${years} years ${remainingMonths} months` :
		`${years} years`;
}

async function processIncrementalScraping(options: {
	existingData: DataSet;
	type: 'idol' | 'group';
	gender: 'female' | 'male' | 'coed';
}): Promise<(Idol | Group)[]> {
	const { existingData, type, gender } = options;

	// Get existing profile URLs
	const existingUrls = new Set(
		Object.values(existingData)
			.flat()
			.map(profile => profile.profileUrl)
	);

	// Get all profile URLs for this category
	const endpoint = getEndpointForType(type, gender);
	const mainPageHtml = await parseProfileWithCache(
		`${BASE_URL}${endpoint}`,
		type,
		false
	);

	const $ = cheerio.load(mainPageHtml);
	const allUrls = extractProfileLinks($);

	// Filter out already processed URLs
	const newUrls = allUrls.filter(url => !existingUrls.has(url));
	logger.info(`Found ${newUrls.length} new profiles to process`);

	// Process new URLs
	return await scrapeProfiles({
		type,
		gender,
		urls: newUrls,
		useCache: true
	});
}

async function runProductionMode(options: {
	batchSize: number;
	delayBetweenBatches: number;
	useCache: boolean;
	forceRefresh: boolean;
}): Promise<void> {
	let dataset: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: []
	};

	// Load existing dataset if available
	try {
		const existingGroups = require(PATHS.GROUPS_FILE);
		const existingIdols = require(PATHS.IDOLS_FILE);
		dataset = {
			...dataset,
			...existingGroups,
			...existingIdols
		};
		logger.info('Loaded existing dataset');
	} catch (e) {
		logger.warn('No existing dataset found, starting fresh');
	}

	// Process each category incrementally
	const categories = [
		{ type: 'idol' as const, gender: 'female' as const },
		{ type: 'idol' as const, gender: 'male' as const },
		{ type: 'group' as const, gender: 'female' as const },
		{ type: 'group' as const, gender: 'male' as const },
		{ type: 'group' as const, gender: 'coed' as const }
	];

	for (const category of categories) {
		logger.info(`Processing ${category.gender} ${category.type}s...`);

		const newProfiles = await processIncrementalScraping({
			existingData: dataset,
			...category
		});

		// Merge new profiles with existing data
		if (category.type === 'idol') {
			if (category.gender === 'female') {
				dataset.femaleIdols = mergeProfiles(
					dataset.femaleIdols,
					newProfiles as Idol[]
				);
			} else {
				dataset.maleIdols = mergeProfiles(
					dataset.maleIdols,
					newProfiles as Idol[]
				);
			}
		} else {
			if (category.gender === 'female') {
				dataset.girlGroups = mergeProfiles(
					dataset.girlGroups,
					newProfiles as Group[]
				);
			} else if (category.gender === 'male') {
				dataset.boyGroups = mergeProfiles(
					dataset.boyGroups,
					newProfiles as Group[]
				);
			} else {
				dataset.coedGroups = mergeProfiles(
					dataset.coedGroups,
					newProfiles as Group[]
				);
			}
		}

		// Save progress after each category
		await saveDataset(dataset);
		logger.success(`Completed ${category.gender} ${category.type}s`);

		await delay(options.delayBetweenBatches);
	}
}

function mergeProfiles<T extends { id: string; profileUrl: string }>(
	existing: T[],
	newProfiles: T[]
): T[] {
	const merged = [...existing];
	const urlToId = new Map(existing.map(p => [p.profileUrl, p.id]));

	newProfiles.forEach(profile => {
		const existingId = urlToId.get(profile.profileUrl);
		if (existingId) {
			// Update existing profile
			const index = merged.findIndex(p => p.id === existingId);
			if (index !== -1) {
				merged[index] = { ...profile, id: existingId };
			}
		} else {
			// Add new profile
			merged.push(profile);
		}
	});

	return merged;
}

function cleanupUndefined<T extends object>(obj: T): T {
	const cleaned = { ...obj };

	Object.entries(cleaned).forEach(([key, value]) => {
		if (value === undefined) {
			delete cleaned[key];
		} else if (Array.isArray(value)) {
			if (value.length === 0) {
				delete cleaned[key];
			} else {
				cleaned[key] = value.map(item =>
					typeof item === 'object' && item !== null ?
						cleanupUndefined(item) : item
				);
			}
		} else if (typeof value === 'object' && value !== null) {
			const cleanedChild = cleanupUndefined(value);
			if (Object.keys(cleanedChild).length === 0) {
				delete cleaned[key];
			} else {
				cleaned[key] = cleanedChild;
			}
		}
	});

	return cleaned;
}

function calculateZodiacSign(date: string): string | undefined {
	const [year, month, day] = date.split('-').map(n => parseInt(n));

	const zodiacRanges = [
		{ sign: 'Capricorn', start: [1, 1], end: [1, 19] },
		{ sign: 'Aquarius', start: [1, 20], end: [2, 18] },
		{ sign: 'Pisces', start: [2, 19], end: [3, 20] },
		{ sign: 'Aries', start: [3, 21], end: [4, 19] },
		{ sign: 'Taurus', start: [4, 20], end: [5, 20] },
		{ sign: 'Gemini', start: [5, 21], end: [6, 20] },
		{ sign: 'Cancer', start: [6, 21], end: [7, 22] },
		{ sign: 'Leo', start: [7, 23], end: [8, 22] },
		{ sign: 'Virgo', start: [8, 23], end: [9, 22] },
		{ sign: 'Libra', start: [9, 23], end: [10, 22] },
		{ sign: 'Scorpio', start: [10, 23], end: [11, 21] },
		{ sign: 'Sagittarius', start: [11, 22], end: [12, 21] },
		{ sign: 'Capricorn', start: [12, 22], end: [12, 31] }
	];

	for (const range of zodiacRanges) {
		const [startMonth, startDay] = range.start;
		const [endMonth, endDay] = range.end;

		if ((month === startMonth && day >= startDay) ||
			(month === endMonth && day <= endDay)) {
			return range.sign;
		}
	}

	return undefined;
}

function getEndpointForType(type: 'idol' | 'group', gender: 'female' | 'male' | 'coed'): string {
	if (type === 'idol') {
		return gender === 'female' ? ENDPOINTS.femaleIdols : ENDPOINTS.maleIdols;
	}
	return gender === 'female' ? ENDPOINTS.girlGroups :
		gender === 'male' ? ENDPOINTS.boyGroups :
			ENDPOINTS.coedGroups;
}

function parsePeriod(text: string): { start: string; end?: string } | null {
	if (!text) return null;

	const periodMatch = text.match(/(\d{4}(?:[-.／]\d{1,2}(?:[-.／]\d{1,2})?)?)\s*(?:-|~|to|until)\s*(\d{4}(?:[-.／]\d{1,2}(?:[-.／]\d{1,2})?)?|present)/i);

	if (periodMatch) {
		const [, start, end] = periodMatch;
		return {
			start: normalizeDate(start) || start,
			...(end && end.toLowerCase() !== 'present' && { end: normalizeDate(end) || end })
		};
	}

	// Try single date format
	const singleMatch = text.match(/(\d{4}(?:[-.／]\d{1,2}(?:[-.／]\d{1,2})?)?)/);
	if (singleMatch) {
		return {
			start: normalizeDate(singleMatch[1]) || singleMatch[1]
		};
	}

	return null;
}

function normalizeDate(date: string): string | null {
	if (!date) return null;

	// Handle various date formats
	const cleaned = date.trim()
		.replace(/[．。､、]/g, '.')
		.replace(/[／/]/g, '-');

	const formats = [
		// Full date formats
		/(\d{4})-(\d{1,2})-(\d{1,2})/,
		/(\d{4})\.(\d{1,2})\.(\d{1,2})/,
		// Year-month formats
		/(\d{4})-(\d{1,2})/,
		/(\d{4})\.(\d{1,2})/,
		// Year only
		/(\d{4})/
	];

	for (const format of formats) {
		const match = cleaned.match(format);
		if (match) {
			const [_, year, month, day] = match;
			if (day) {
				return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
			}
			if (month) {
				return `${year}-${month.padStart(2, '0')}-01`;
			}
			return `${year}-01-01`;
		}
	}

	return null;
}

async function scrapeProfiles(options: {
	type: 'idol' | 'group';
	gender: 'female' | 'male' | 'coed';
	debug?: boolean;
	sampleSize?: number;
	urls?: string[];
	useCache?: boolean;
}): Promise<(Idol | Group)[]> {
	const { type, gender, debug = false, sampleSize = 5, urls, useCache = true } = options;

	startTime = Date.now(); // Reset start time for each scrape session

	try {
		// Get URLs to process
		let profileUrls = urls;
		if (!profileUrls) {
			const endpoint = getEndpointForType(type, gender);
			const mainPageHtml = await parseProfileWithCache(`${BASE_URL}${endpoint}`, type, false);
			const $ = cheerio.load(mainPageHtml);
			profileUrls = extractProfileLinks($);
		}

		if (debug) {
			profileUrls = profileUrls.sort(() => Math.random() - 0.5).slice(0, sampleSize);
		}

		// Load existing data
		const existingData = loadExistingData();
		const processedUrls = new Set(getAllProfileUrls(existingData));

		// Filter out already processed URLs
		const newUrls = profileUrls.filter(url => !processedUrls.has(url));
		const total = newUrls.length;

		logger.info(`Starting ${gender} ${type} scraping...`);
		logger.info(`Total profiles to process: ${total}`);
		logger.info(`Using cache: ${useCache}`);
		if (processedUrls.size > 0) {
			logger.info(`Skipping ${processedUrls.size} already processed profiles`);
		}

		const results: (Idol | Group)[] = [];
		const batchSize = CONFIG.concurrentRequests;
		let processed = 0;
		const startTime = Date.now();
		let lastUpdate = startTime;

		// Track global progress
		const allProfiles = {
			total: profileUrls.length,
			processed: 0,
			startTime: Date.now(),
			failures: 0
		};

		logger.info(`Total profiles to process across all categories: ${allProfiles.total}`);

		const updateGlobalProgress = () => {
			allProfiles.processed++;
			const progress = (allProfiles.processed / allProfiles.total * 100).toFixed(1);
			const elapsed = Date.now() - allProfiles.startTime;
			const eta = Math.ceil((elapsed / allProfiles.processed) * (allProfiles.total - allProfiles.processed) / 1000);
			const hours = Math.floor(eta / 3600);
			const minutes = Math.floor((eta % 3600) / 60);

			logger.info(
				`Overall Progress: ${allProfiles.processed}/${allProfiles.total} (${progress}%) ` +
				`ETA: ${hours}h ${minutes}m | Success Rate: ${((allProfiles.processed - allProfiles.failures) / allProfiles.processed * 100).toFixed(1)}%`
			);
		};

		const processUrl = async (url: string) => {
			try {
				// Try cache first
				const html = await parseProfileWithCache(url, type, !useCache);
				const $ = cheerio.load(html);
				const result = type === 'idol' ?
					await extractIdolData($, url) :
					await extractGroupData($, url);

				processed++;
				updateGlobalProgress();
				return result;

			} catch (error) {
				allProfiles.failures++;
				updateGlobalProgress();
				logger.error(`Failed to process ${url}: ${error.message}`);
				return null;
			}
		};

		// Process in batches
		for (let i = 0; i < newUrls.length; i += batchSize) {
			const batch = newUrls.slice(i, i + batchSize);
			const batchResults = await Promise.all(batch.map(processUrl));
			results.push(...batchResults.filter((r): r is Idol | Group => r !== null));

			// Save progress incrementally
			if (results.length > 0) {
				await saveIncrementalProgress(results, type, gender);
			}

			await delay(CONFIG.rateLimitDelay);
		}

		return results;

	} catch (error) {
		logger.error(`Failed to scrape ${gender} ${type}s: ${error.message}`);
		return [];
	}
}

// Add helper functions for loading and saving incremental data
function loadExistingData(): DataSet {
	try {
		const groupsPath = PATHS.GROUPS_FILE;
		const idolsPath = PATHS.IDOLS_FILE;

		const groups = fs.existsSync(groupsPath) ?
			JSON.parse(fs.readFileSync(groupsPath, 'utf-8')) : {};
		const idols = fs.existsSync(idolsPath) ?
			JSON.parse(fs.readFileSync(idolsPath, 'utf-8')) : {};

		return {
			femaleIdols: idols.femaleIdols || [],
			maleIdols: idols.maleIdols || [],
			girlGroups: groups.girlGroups || [],
			boyGroups: groups.boyGroups || [],
			coedGroups: groups.coedGroups || []
		};
	} catch (error) {
		logger.warn('Failed to load existing data, starting fresh');
		return {
			femaleIdols: [],
			maleIdols: [],
			girlGroups: [],
			boyGroups: [],
			coedGroups: []
		};
	}
}

function getAllProfileUrls(dataset: DataSet): string[] {
	return [
		...dataset.femaleIdols,
		...dataset.maleIdols,
		...dataset.girlGroups,
		...dataset.boyGroups,
		...dataset.coedGroups
	].map(profile => profile.profileUrl);
}

async function saveIncrementalProgress(
	results: (Idol | Group)[],
	type: 'idol' | 'group',
	gender: 'female' | 'male' | 'coed'
): Promise<void> {
	// Load existing dataset
	const existingData = loadExistingData();

	// Merge new results with existing data based on type and gender
	if (type === 'idol') {
		if (gender === 'female') {
			existingData.femaleIdols = mergeProfiles(
				existingData.femaleIdols,
				results as Idol[]
			);
		} else {
			existingData.maleIdols = mergeProfiles(
				existingData.maleIdols,
				results as Idol[]
			);
		}
	} else {
		if (gender === 'female') {
			existingData.girlGroups = mergeProfiles(
				existingData.girlGroups,
				results as Group[]
			);
		} else if (gender === 'male') {
			existingData.boyGroups = mergeProfiles(
				existingData.boyGroups,
				results as Group[]
			);
		} else {
			existingData.coedGroups = mergeProfiles(
				existingData.coedGroups,
				results as Group[]
			);
		}
	}

	// Save updated dataset
	await saveDataset(existingData);
}

function logProgress(processed: number, total: number, type: string, url: string): void {
	const progress = (processed / total * 100).toFixed(1);
	const elapsed = Date.now() - startTime;
	const eta = Math.ceil((elapsed / processed * (total - processed)) / 1000);

	logger.info(
		`[${type}] Progress: ${processed}/${total} (${progress}%) ` +
		`ETA: ${eta}s - ${url}`
	);
}

async function runDebugMode(options: {
	sampleSize: number;
	randomSamples: boolean;
	batchSize: number;
	delayBetweenBatches: number;
	useCache: boolean;
}): Promise<void> {
	const dataset: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: []
	};

	logger.info('Starting debug mode scraping...');

	const categories = [
		{ type: 'group' as const, gender: 'female' as const },
		{ type: 'group' as const, gender: 'male' as const },
		{ type: 'group' as const, gender: 'coed' as const },
		{ type: 'idol' as const, gender: 'female' as const },
		{ type: 'idol' as const, gender: 'male' as const }
	];

	for (const category of categories) {
		logger.info(`Scraping ${category.gender} ${category.type}s...`);
		const profiles = await scrapeProfiles({
			...category,
			debug: true,
			sampleSize: options.sampleSize,
			useCache: options.useCache
		});

		if (category.type === 'idol') {
			if (category.gender === 'female') dataset.femaleIdols.push(...profiles as Idol[]);
			else dataset.maleIdols.push(...profiles as Idol[]);
		} else {
			if (category.gender === 'female') dataset.girlGroups.push(...profiles as Group[]);
			else if (category.gender === 'male') dataset.boyGroups.push(...profiles as Group[]);
			else dataset.coedGroups.push(...profiles as Group[]);
		}

		logger.info(`Waiting ${options.delayBetweenBatches}ms before next category`);
		await delay(options.delayBetweenBatches);
	}

	logger.info('Saving dataset...');
	await saveDataset(dataset);
	logger.success('Debug mode scraping completed');
}

