import { fetch } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import * as fs from "node:fs";
import * as path from "node:path";
import { CacheManager } from "@src/cache";
import { ProxyManager, type ProxyConfig } from "@src/proxy";
import { logger } from "@src/logger";
import { scraperUI } from "@src/ui";
import {
	BloodType,
	type DataSet,
	type SocialMedia,
	type Group,
	type Idol,
	Status,
	type GroupMember,
	GroupType,
	type IdolNames,
	type GroupNames,
	type GroupActivity,
	type EntityStats,
	type IdolProfile,
	type FandomInfo,
	type AttributeField,
	type GroupProfile,
} from "@src/types";

export { runDebugMode, runProductionMode, scrapeProfiles };

const PATHS = {
	DATA_DIR: path.join(process.cwd(), "data"),
	get GROUPS_FILE() {
		return path.join(this.DATA_DIR, "groups.json");
	},
	get IDOLS_FILE() {
		return path.join(this.DATA_DIR, "idols.json");
	},
	get METADATA_FILE() {
		return path.join(this.DATA_DIR, "metadata.json");
	},
} as const;

// Base URL and endpoints
const BASE_URL = "https://kpopping.com";
const ENDPOINTS = {
	femaleIdols: "/profiles/the-idols/women",
	maleIdols: "/profiles/the-idols/men",
	girlGroups: "/profiles/the-groups/women",
	boyGroups: "/profiles/the-groups/men",
	coedGroups: "/profiles/the-groups/coed",
} as const;

// Update CONFIG to include concurrentRequests
const CONFIG = {
	debug: true,
	retryAttempts: 5, // Increased from 3
	retryDelay: 1500, // Reduced for faster processing
	requestTimeout: 30000, // Increased from 20000
	rateLimitDelay: 0, // No delay needed when using cache
	maxRequestsPerMinute: 1000, // Higher limit for cached content
	maxConcurrent: 10, // Increased for production
	concurrentRequests: 10, // Increased for production
	debugSampleSize: 5,
	batchLogInterval: 10, // Log batch progress every N items
	saveInterval: 100, // Save progress every N items
	userAgent:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
	headers: {
		Accept:
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		"Cache-Control": "no-cache",
		"Sec-Ch-Ua":
			'"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
		"Sec-Ch-Ua-Mobile": "?0",
		"Sec-Ch-Ua-Platform": '"macOS"',
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		"Upgrade-Insecure-Requests": "1",
	},
} as const;

// Cache for profile URL to ID mappings
const urlToIdCache = new Map<string, string>();

function cacheProfileId(profileUrl: string, id: string) {
	urlToIdCache.set(profileUrl, id);
}

function getIdFromProfileUrl(profileUrl: string): string | undefined {
	return urlToIdCache.get(profileUrl);
}

// Initialize cache from existing dataset
function initializeUrlToIdCache(dataset: DataSet) {
	const allProfiles = [
		...dataset.femaleIdols,
		...dataset.maleIdols,
		...dataset.girlGroups,
		...dataset.boyGroups,
		...dataset.coedGroups,
	];

	for (const profile of allProfiles) {
		cacheProfileId(profile.profileUrl, profile.id);
	}
}

// Track failed requests to implement backoff strategy
const failedRequests = new Map<
	string,
	{ count: number; lastAttempt: number }
>();

const cache = new CacheManager();
const proxyManager = new ProxyManager();

let offlineMode = false;


async function shouldRetry(url: string): Promise<boolean> {
	const failed = failedRequests.get(url);
	if (!failed) return true;

	// More lenient backoff
	const now = Date.now();
	const timeSinceLastAttempt = now - failed.lastAttempt;
	const backoffTime = Math.min(CONFIG.retryDelay * 1.5 ** failed.count, 30000);

	return timeSinceLastAttempt >= backoffTime;
}

function recordFailedRequest(url: string) {
	const failed = failedRequests.get(url) || { count: 0, lastAttempt: 0 };
	failedRequests.set(url, {
		count: failed.count + 1,
		lastAttempt: Date.now(),
	});
}

// Helper functions
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(text: string): string {
	return text
		.trim()
		.replace(/\s+/g, " ")
		.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
		.replace(/[""]/g, '"')
		.replace(/['′]/g, "'");
}

type AttributeEntry = {
	label: string;
	value: string;
	labelElement: cheerio.Cheerio<unknown>;
	valueElement?: cheerio.Cheerio<unknown>;
};

function normalizeLabel(label: string): string {
	return cleanText(label)
		.toLowerCase()
		.replace(/[:：]/g, "")
		.replace(/\(.*?\)/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function parseDelimitedList(value: string): string[] {
	return value
		.split(/[,•·‧;]|(?:\sand\s)/i)
		.map((part) => cleanText(part))
		.filter((part) => part.length > 0);
}

function parseHeight(value: string): number | undefined {
	const match = value.match(/(\d+(?:\.\d+)?)\s*cm/i);
	if (match && match[1]) {
		return Number.parseFloat(match[1]);
	}
	return undefined;
}

function parseWeight(value: string): number | undefined {
	const match = value.match(/(\d+(?:\.\d+)?)\s*kg/i);
	if (match && match[1]) {
		return Number.parseFloat(match[1]);
	}
	return undefined;
}

function parseCompactNumber(value: string): number | undefined {
	const cleaned = cleanText(value).replace(/,/g, "").toLowerCase();
	if (!cleaned) return undefined;
	const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([km]?)$/);
	if (match) {
		const baseValue = match[1] ?? "";
		const base = Number.parseFloat(baseValue);
		if (Number.isNaN(base)) return undefined;
		const suffix = match[2];
		const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
		return Math.round(base * multiplier);
	}
	const numeric = Number.parseFloat(cleaned);
	return Number.isNaN(numeric) ? undefined : numeric;
}

function collectAttributeEntries($: cheerio.CheerioAPI): AttributeEntry[] {
	const entries: AttributeEntry[] = [];

	$(".profile-grid section.cell").each((_, el) => {
		const $el = $(el);
		if ($el.closest("#star-companies").length > 0) return;
		const nameText = cleanText($el.find(".name").first().text() || $el.find("strong").first().text());
		const label = nameText.replace(/[:：]\s*$/, "");
		if (!label) return;
		const valueElement = $el.find(".value").first();
		const value = cleanText(valueElement.text() || $el.clone().children(".name").remove().end().text());
		entries.push({
			label,
			value,
			labelElement: $el,
			valueElement: valueElement.length ? valueElement : undefined,
		});
	});

	const equalElements = $(".data-grid .equal").toArray();
	for (let i = 0; i < equalElements.length; i++) {
		const $label = $(equalElements[i]);
		const strong = $label.find("strong").first();
		if (!strong.length) continue;
		const label = cleanText(strong.text()).replace(/[:：]\s*$/, "");
		if (!label) continue;
		const $value = i + 1 < equalElements.length ? $(equalElements[i + 1]) : undefined;
		const value = $value ? cleanText($value.text()) : "";
		entries.push({
			label,
			value,
			labelElement: $label,
			valueElement: $value,
		});
		if ($value) i += 1;
	}

	return entries;
}

function extractColorsFromEntry(entry: AttributeEntry): string[] {
	const colors = new Set<string>();
	const valueElement = entry.valueElement as cheerio.Cheerio<any> | undefined;
	if (valueElement) {
		const legendsText = cleanText(
			valueElement.find(".fandom-box .legend, .fandom-box span").text(),
		);
		for (const name of parseDelimitedList(legendsText)) {
			if (name) colors.add(name);
		}
	}

	for (const name of parseDelimitedList(entry.value)) {
		if (name) colors.add(name);
	}

	return [...colors];
}

function extractStats($: cheerio.CheerioAPI): EntityStats {
	const stats: EntityStats = {};
	$(".stat-icons .stat").each((_, el) => {
		const $el = $(el);
		const iconClass = $el.find("i").attr("class") || "";
		const valueText = cleanText($el.find("strong").text());
		const numeric = parseCompactNumber(valueText);
		if (!numeric && numeric !== 0) return;

		if (iconClass.includes("fa-trophy")) {
			stats.wins = numeric;
		} else if (iconClass.includes("fa-image")) {
			stats.pictures = numeric;
		} else if (iconClass.includes("fa-video")) {
			stats.videos = numeric;
		} else if (iconClass.includes("fa-compact-disc")) {
			stats.albums = numeric;
		} else if (iconClass.includes("fa-eye")) {
			stats.views = numeric;
		} else if (iconClass.includes("fa-heart")) {
			stats.favorites = numeric;
		}
	});

	return cleanupUndefined(stats);
}

function extractCategoryTags($: cheerio.CheerioAPI): string[] {
	const tags = new Set<string>();
	$(".seperated-links a").each((_, link) => {
		const tag = cleanText($(link).text());
		if (tag) tags.add(tag);
	});
	return [...tags];
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
			this.tokens + timePassed * this.refillRate,
		);
		this.lastRefill = now;

		if (this.tokens < 1) {
			const waitTime = (1 - this.tokens) / this.refillRate;
			await delay(waitTime);
			return this.getToken();
		}

		this.tokens -= 1;
	},
};


async function fetchWithRetry(url: string): Promise<string> {
	let currentProxy: ProxyConfig | null = null;
	let triedDirectConnection = false;

	// First, try all available proxies
	while (proxyManager.hasWorkingProxies()) {
		currentProxy = proxyManager.getCurrentProxy();
		if (!currentProxy) break;

		logger.info(`Fetching ${url} via proxy ${currentProxy.host}:${currentProxy.port}`);
		scraperUI.setCurrentProxy({
			host: currentProxy.host,
			port: currentProxy.port,
			protocol: currentProxy.protocol,
		});

		try {
			await rateLimiter.getToken();

			const controller = new AbortController();
			const timeoutId = setTimeout(
				() => controller.abort(),
				CONFIG.requestTimeout,
			);

			// Prepare fetch options
			const fetchOptions: Parameters<typeof fetch>[1] = {
				headers: {
					...CONFIG.headers,
					"User-Agent": CONFIG.userAgent,
					Host: new URL(url).hostname,
					Referer: "https://www.google.com/",
					Connection: "keep-alive",
					DNT: "1",
				},
				signal: controller.signal,
			};

			// Add proxy configuration if available (for HTTP proxies)
				if (currentProxy.protocol === "http") {
					const proxyUrl = `http://${currentProxy.host}:${currentProxy.port}`;
					try {
						const agent = new HttpsProxyAgent(proxyUrl);
						// @ts-ignore - undici typing issue with dispatcher
						fetchOptions.dispatcher = agent;
					} catch (proxyError) {
						logger.warn(`Failed to set up proxy ${proxyUrl}: ${proxyError}`);
						throw new Error("Proxy setup failed");
					}
				}

			const response = await fetch(url, fetchOptions);
			clearTimeout(timeoutId);

			if (response.status === 429) {
				const retryAfter = response.headers.get("Retry-After");
				const retryAfterSeconds = retryAfter
					? Number.parseInt(retryAfter, 10)
					: Number.NaN;
				const cooldownMs = Number.isFinite(retryAfterSeconds)
					? retryAfterSeconds * 1000
					: CONFIG.retryDelay;
				const sanitizedCooldown = Number.isFinite(cooldownMs)
					? Math.max(cooldownMs, 1000)
					: 5000;
				logger.warn(
					`Proxy ${currentProxy.host}:${currentProxy.port} hit rate limit. Rotating proxy (cooldown ${Math.ceil(sanitizedCooldown / 1000)}s)`,
				);
				const appliedCooldown = proxyManager.markProxyAsRateLimited(
					currentProxy,
					sanitizedCooldown,
				);
				scraperUI.setCurrentProxy({
					host: currentProxy.host,
					port: currentProxy.port,
					protocol: currentProxy.protocol,
					cooldownSeconds: Math.ceil(appliedCooldown / 1000),
				});
				continue;
			}

			if (response.status === 403) {
				logger.warn(`Proxy ${currentProxy.host}:${currentProxy.port} got 403, marking as failed`);
				proxyManager.markProxyAsFailed(currentProxy);
				scraperUI.setCurrentProxy(null);
				continue;
			}

			if (!response.ok) {
				logger.warn(
					`Proxy ${currentProxy.host}:${currentProxy.port} returned ${response.status}. Rotating to next proxy`,
				);
				const appliedCooldown = proxyManager.markProxyAsTemporarilyFailed(
					currentProxy,
					CONFIG.retryDelay,
				);
				scraperUI.setCurrentProxy({
					host: currentProxy.host,
					port: currentProxy.port,
					protocol: currentProxy.protocol,
					cooldownSeconds: Math.ceil(appliedCooldown / 1000),
				});
				continue;
			}

			const text = await response.text();
			if (text.length < 500 || text.includes("Too Many Requests")) {
				logger.warn(
					`Proxy ${currentProxy.host}:${currentProxy.port} returned invalid payload. Rotating to next proxy`,
				);
				const appliedCooldown = proxyManager.markProxyAsTemporarilyFailed(
					currentProxy,
					CONFIG.retryDelay,
				);
				scraperUI.setCurrentProxy({
					host: currentProxy.host,
					port: currentProxy.port,
					protocol: currentProxy.protocol,
					cooldownSeconds: Math.ceil(appliedCooldown / 1000),
				});
				continue;
			}

			logger.success(`Successfully fetched ${url} via proxy ${currentProxy.host}:${currentProxy.port}`);
			failedRequests.delete(url);
			proxyManager.markProxyAsSuccessful(currentProxy);
			scraperUI.setCurrentProxy({
				host: currentProxy.host,
				port: currentProxy.port,
				protocol: currentProxy.protocol,
			});
			return text;
		} catch (error) {
			logger.error(
				`Failed to fetch ${url} via proxy ${currentProxy.host}:${currentProxy.port}: ${error instanceof Error ? error.message : String(error)}`,
			);

			const message = error instanceof Error ? error.message : String(error);
			if (
				message.includes("403") ||
				message.includes("Proxy setup failed") ||
				message.includes("certificate") ||
				message.includes("ENOTFOUND")
			) {
				proxyManager.markProxyAsFailed(currentProxy);
				scraperUI.setCurrentProxy(null);
			} else {
				const appliedCooldown = proxyManager.markProxyAsTemporarilyFailed(
					currentProxy,
					CONFIG.retryDelay,
				);
				scraperUI.setCurrentProxy({
					host: currentProxy.host,
					port: currentProxy.port,
					protocol: currentProxy.protocol,
					cooldownSeconds: Math.ceil(appliedCooldown / 1000),
				});
			}
		}
	}

	// If all proxies failed, try direct connection as last resort  
	if (!triedDirectConnection) {
		triedDirectConnection = true;
		logger.warn("All proxies failed, trying direct connection as last resort");
		scraperUI.setCurrentProxy(null);
		const directAttempts = 3;
		
		for (let attempt = 0; attempt < directAttempts; attempt++) {
			try {
				if (attempt > 0) {
					logger.warn(`Retrying ${url} with direct connection (attempt ${attempt + 1}/${directAttempts})`);
					const backoff = Math.min(CONFIG.retryDelay * 1.5 ** attempt, 10000);
					await delay(backoff);
				}

				await rateLimiter.getToken();
				logger.info(`Fetching ${url} (direct connection)`);

				const controller = new AbortController();
				const timeoutId = setTimeout(
					() => controller.abort(),
					CONFIG.requestTimeout,
				);

				const response = await fetch(url, {
					headers: {
						...CONFIG.headers,
						"User-Agent": CONFIG.userAgent,
						Host: new URL(url).hostname,
						Referer: "https://www.google.com/",
						Connection: "keep-alive",
						DNT: "1",
					},
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (response.status === 429) {
					const retryAfter = response.headers.get("Retry-After");
					const retryDelay = retryAfter
						? Number.parseInt(retryAfter) * 1000
						: CONFIG.retryDelay * 1.5 ** attempt;
					logger.warn(`Rate limited, waiting ${retryDelay}ms`);
					await delay(retryDelay);
					continue;
				}

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const text = await response.text();
				if (text.length < 500 || text.includes("Too Many Requests")) {
					throw new Error("Invalid response received");
				}

				logger.success(`Successfully fetched ${url} via direct connection`);
				failedRequests.delete(url);
				return text;
				
			} catch (error) {
				logger.error(
					`Failed to fetch ${url} via direct connection: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	
	// Only after exhausting ALL proxies AND direct connection, throw error to quit
	logger.error(`All proxies and direct connection failed for ${url}. No more options available.`);
	throw new Error("All proxies exhausted - unable to fetch any content. Terminating scraper.");
}

async function parseProfileWithCache(
	url: string,
	type: "idol" | "group",
	forceRefresh = false,
): Promise<string | null> {
	if (!forceRefresh) {
		const cached = await cache.get(type, url);
		if (cached) {
			return cached; // Return cached content immediately without delay
		}
	}

	if (offlineMode) {
		if (forceRefresh) {
			logger.warn(
				`[OFFLINE] Force refresh requested for ${url} but offline mode is enabled. Using cache if available.`,
			);
		}
		logger.warn(`[OFFLINE] Missing cached content for ${url}, skipping fetch`);
		return null;
	}

	logger.info(`Cache miss for ${url}, fetching...`);
	const html = await fetchWithRetry(url);

	// Handle empty responses gracefully
	if (!html || html.length === 0) {
		logger.warn(`Failed to fetch content for ${url}, skipping...`);
		return null;
	}

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
			coedGroups: dataset.coedGroups,
		};
		fs.writeFileSync(PATHS.GROUPS_FILE, JSON.stringify(groupsData, null, 2));
		logger.success("Saved groups data");

		// Save idols data
		const idolsData = {
			femaleIdols: dataset.femaleIdols,
			maleIdols: dataset.maleIdols,
		};
		fs.writeFileSync(PATHS.IDOLS_FILE, JSON.stringify(idolsData, null, 2));
		logger.success("Saved idols data");

		// Generate and save metadata
		const metadata = {
			lastUpdated: new Date().toISOString(),
			version: "0.1.0",
			coverage: {
				startDate: dataset.femaleIdols
					.concat(dataset.maleIdols)
					.reduce((earliest, idol) => {
						const debutDate = idol.careerInfo?.debutDate;
						return debutDate && (!earliest || debutDate < earliest)
							? debutDate
							: earliest;
					}, ""),
				endDate: new Date().toISOString().split("T")[0],
			},
			stats: {
				groups: {
					total:
						dataset.girlGroups.length +
						dataset.boyGroups.length +
						dataset.coedGroups.length,
					active: {
						girl: dataset.girlGroups.filter((g) => g.active).length,
						boy: dataset.boyGroups.filter((g) => g.active).length,
						coed: dataset.coedGroups.filter((g) => g.active).length,
					},
					disbanded: {
						girl: dataset.girlGroups.filter((g) => g.status === "inactive")
							.length,
						boy: dataset.boyGroups.filter((g) => g.status === "inactive")
							.length,
						coed: dataset.coedGroups.filter((g) => g.status === "inactive")
							.length,
					},
				},
				idols: {
					total: dataset.femaleIdols.length + dataset.maleIdols.length,
					active: {
						female: dataset.femaleIdols.filter((i) => i.active).length,
						male: dataset.maleIdols.filter((i) => i.active).length,
					},
					inactive: {
						female: dataset.femaleIdols.filter((i) => !i.active).length,
						male: dataset.maleIdols.filter((i) => !i.active).length,
					},
				},
				total:
					dataset.femaleIdols.length +
					dataset.maleIdols.length +
					dataset.girlGroups.length +
					dataset.boyGroups.length +
					dataset.coedGroups.length,
			},
		};
		fs.writeFileSync(PATHS.METADATA_FILE, JSON.stringify(metadata, null, 2));
		logger.success("Saved metadata");
	} catch (error) {
		logger.error(
			`Failed to save dataset: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

function extractProfileLinks($: cheerio.CheerioAPI): string[] {
	const links = new Set<string>();

	// Find profile links with various selectors
	$('a[href*="/profiles/"]').each((_, el) => {
		const href = $(el).attr("href");
		if (href && (href.includes("/idol/") || href.includes("/group/"))) {
			links.add(href.startsWith("http") ? href : `${BASE_URL}${href}`);
		}
	});

	return [...links].filter(
		(url) => !url.includes("/submission") && !url.includes("/sign-in"),
	);
}

function extractImageUrl($: cheerio.CheerioAPI): string | undefined {
	// Try meta tags first
	const ogImage = $('meta[property="og:image"]').attr("content");
	if (ogImage?.includes("//")) return ogImage;

	// Try profile-specific images
	const profileImage = $(".profile-image img, .profile-pic img")
		.first()
		.attr("src");
	if (profileImage?.includes("//")) return profileImage;

	// Try any large images
	const images = $('img[src*="documents"]')
		.toArray()
		.map((img) => $(img).attr("src"))
		.filter(
			(src): src is string =>
				!!src &&
				!src.includes("favicon") &&
				!src.includes("logo") &&
				src.includes("//"),
		);

	return images[0];
}

function extractSocialMediaLinks($: cheerio.CheerioAPI): SocialMedia {
	const socialMedia: SocialMedia = {};

	for (const el of $(".socials a, .social-links a").toArray()) {
		const href = $(el).attr("href");
		if (!href) continue;

		// Skip kpopping.com and irrelevant links
		if (
			href.includes("kpopping.com") ||
			href.includes("discord.gg") ||
			href.includes("google.com")
		)
			continue;

		try {
			const url = new URL(href);
			const cleanUrl = url.origin + url.pathname; // Remove tracking params

			if (url.hostname.includes("instagram.com"))
				socialMedia.instagram = cleanUrl;
			else if (
				url.hostname.includes("twitter.com") ||
				url.hostname.includes("x.com")
			) {
				socialMedia.twitter = cleanUrl;
			} else if (
				url.hostname.includes("facebook.com") &&
				!url.pathname.includes("KPopping-")
			) {
				socialMedia.facebook = cleanUrl;
			} else if (url.hostname.includes("youtube.com"))
				socialMedia.youtube = cleanUrl;
			else if (url.hostname.includes("spotify.com"))
				socialMedia.spotify = cleanUrl;
			else if (url.hostname.includes("weibo.com")) socialMedia.weibo = cleanUrl;
			else if (url.hostname.includes("tiktok.com"))
				socialMedia.tiktok = cleanUrl;
			else if (url.hostname.includes("vlive.tv")) socialMedia.vlive = cleanUrl;
			else if (url.hostname.includes("cafe.daum.net"))
				socialMedia.fancafe = cleanUrl;
			else socialMedia.website = cleanUrl;
		} catch (e) {
			// Invalid URL, skip
		}
	}

	return socialMedia;
}

function extractDateFromText(text: string): string | null {
	if (!text) return null;

	// Clean up input text
	const cleaned = text.trim().replace(/\s+/g, " ").toLowerCase();

	// Month name mapping
	const monthMap: Record<string, string> = {
		jan: "01",
		january: "01",
		feb: "02",
		february: "02",
		mar: "03",
		march: "03",
		apr: "04",
		april: "04",
		may: "05",
		jun: "06",
		june: "06",
		jul: "07",
		july: "07",
		aug: "08",
		august: "08",
		sep: "09",
		september: "09",
		oct: "10",
		october: "10",
		nov: "11",
		november: "11",
		dec: "12",
		december: "12",
	};

	// Handle "Month DD, YYYY" format (e.g., "Oct 18, 2023")
	const monthNamePattern = /([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i;
	const monthNameMatch = cleaned.match(monthNamePattern);
	if (monthNameMatch?.[1]) {
		const [_, month, day, year] = monthNameMatch;
		const monthNum = monthMap[month.toLowerCase()];
		if (monthNum && day && year) {
			return `${year}-${monthNum}-${day.padStart(2, "0")}`;
		}
	}

	// Handle numerical formats
	const patterns = [
		// YYYY-MM-DD or YYYY.MM.DD
		/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/,
		// DD-MM-YYYY or DD.MM.YYYY
		/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/,
		// YYYY-MM or YYYY.MM
		/(\d{4})[-./](\d{1,2})/,
		// MM-YYYY or MM.YYYY
		/(\d{1,2})[-./](\d{4})/,
		// Year only
		/(\d{4})/,
	];

	for (const pattern of patterns) {
		const match = cleaned.match(pattern);
		if (!match) continue;

		if (match[3]) {
			// Full date format
			const [_, part1, part2, part3] = match;
			if (part1 && part2 && part3 && part1.length === 4) {
				// YYYY-MM-DD
				return `${part1}-${part2.padStart(2, "0")}-${part3.padStart(2, "0")}`;
				// DD-MM-YYYY
			}
			if (part1 && part2 && part3) {
				return `${part3}-${part2.padStart(2, "0")}-${part1.padStart(2, "0")}`;
			}
			return null;
		}
		if (match[2]) {
			// Year and month
			const [_, part1, part2] = match;
			if (part1?.length === 4) {
				// YYYY-MM
				return `${part1}-${part2.padStart(2, "0")}-01`;
				// MM-YYYY
			}
			return part1 ? `${part2}-${part1.padStart(2, "0")}-01` : null;
		}
		// Year only
		return `${match[1]}-01-01`;
	}

	return null;
}

function parsePeriod(text: string): { start: string; end?: string } | null {
	if (!text) return null;

	// Clean up and normalize the text
	const cleaned = text.trim().toLowerCase();

	// Check for "present"
	const isPresent = cleaned.includes("present");

	// Split on common separators and clean up
	const [startPart, endPart] = cleaned
		.split(/[-~～]|to|until/i)
		.map((p) => p.trim());
	if (!startPart) return null;

	const start = extractDateFromText(startPart);
	if (!start) return null;

	if (endPart && !isPresent) {
		const end = extractDateFromText(endPart);
		if (end) {
			return { start, end };
		}
	}

	return { start };
}

function extractCompanyInfo($: cheerio.CheerioAPI): {
	current: string | null;
	history: Array<{ name: string; period: { start: string; end?: string } }>;
} {
	const company = {
		current: null as string | null,
		history: [] as Array<{
			name: string;
			period: { start: string; end?: string };
		}>,
	};

	// Use a Map to track unique periods and prevent duplicates
	const periodMap = new Map<
		string,
		{ name: string; period: { start: string; end?: string } }
	>();

	$("#star-companies .cell, #company-info .cell").each((_, el) => {
		const $cell = $(el);
		const name = cleanText(
			$cell
				.find(".name")
				.text()
				.replace(/[:：]\s*$/, ""),
		);
		const periodText = cleanText($cell.find(".value").text());

		if (!name || name === "-") return;

		const parsedPeriod = parsePeriod(periodText);
		if (parsedPeriod) {
			// Create unique key for the period
			const periodKey = `${parsedPeriod.start}-${parsedPeriod.end || "present"}`;

			// Only add if we haven't seen this period before
			if (!periodMap.has(periodKey)) {
				periodMap.set(periodKey, { name, period: parsedPeriod });
			}
		}

		// Set current company if not already set
		if (!company.current) {
			company.current = name;
		}
	});

	// Convert map values to array and sort by start date
	company.history = Array.from(periodMap.values()).sort((a, b) => {
		return (
			new Date(b.period.start).getTime() - new Date(a.period.start).getTime()
		);
	});

	return cleanupUndefined(company);
}

function parseDescription($: cheerio.CheerioAPI): string | undefined {
	// Find the Introduction section
	const introSection = $('h2:has(span:contains("Introduction"))').next("p");
	if (introSection.length) {
		// Extract and clean the full introduction text
		return cleanText(introSection.text());
	}

	// Fallback to meta description if no introduction section found
	const metaDescription = $('meta[name="description"]').attr("content");
	if (metaDescription) {
		return cleanText(metaDescription);
	}

	return undefined;
}

function parseLocation($: cheerio.CheerioAPI): {
	hometown?: string;
	country?: { name: string; code: string };
} {
	const locationData = {
		hometown: undefined as string | undefined,
		country: undefined as { name: string; code: string } | undefined,
	};

	// Find hometown
	$(".data-grid .equal").each((_, el) => {
		const $el = $(el);
		const label = $el.find("strong").text().trim();
		if (label === "Hometown:") {
			locationData.hometown = cleanText($el.find("p").text());
		} else if (label === "Country:") {
			const countryName = cleanText($el.find("p").text());
			const countryCode = $el
				.find(".flag-icon")
				.attr("class")
				?.match(/flag-icon-(\w+)/)?.[1];
			if (countryName && countryCode) {
				locationData.country = {
					name: countryName,
					code: countryCode.toLowerCase(),
				};
			}
		}
	});

	return locationData;
}

function parseNames($: cheerio.CheerioAPI): IdolNames {
	const names: IdolNames = {
		stage: "",
		korean: null,
		japanese: null,
		chinese: null,
		full: null, // Initialize with null
		native: null, // Initialize with null
	};

	// Extract stage name safely
	const h1Text = $("h1").first().contents().first().text();
	names.stage = cleanText(h1Text) || "";

	// Find full and native names
	$(".data-grid .equal").each((_, el) => {
		const $el = $(el);
		const label = cleanText($el.find("strong").text());
		const value = cleanText($(el).next(".equal").text());

		if (!label || !value) return;

		if (label === "Full name:") {
			names.full = value;
		} else if (label === "Native name:") {
			names.native = value;
		}
	});

	// Extract other names from defined-terms
	$("h2 .native-name").each((_, el) => {
		const $el = $(el);
		const dfnText = cleanText(
			$el.find("dfn").text().toLowerCase().replace(":", ""),
		);
		const nameText = cleanText($el.text().replace($el.find("dfn").text(), ""));

		if (!dfnText || !nameText) return;

		if (dfnText.includes("korean")) names.korean = nameText;
		else if (dfnText.includes("japanese")) names.japanese = nameText;
		else if (dfnText.includes("chinese")) names.chinese = nameText;
	});

	return names;
}

function parseBirthday($: cheerio.CheerioAPI): string | undefined {
	let birthDate: string | undefined;

	$(".data-grid .equal").each((_, el) => {
		const $el = $(el);
		const label = $el.find("strong").text().trim();
		if (label === "Birthday:") {
			const dateText = $el.next(".equal").find("a").text().trim();
			// Parse date like "Aug 9, 1989" into ISO format
			try {
				const date = new Date(dateText);
				if (!Number.isNaN(date.getTime())) {
					birthDate = date.toISOString().split("T")[0];
				}
			} catch (e) {
				logger.error(`Failed to parse birthday: ${dateText}`);
			}
		}
	});

	return birthDate;
}

function parseBloodType(text: string): BloodType | undefined {
	const bloodTypeMap: Record<string, BloodType> = {
		A: BloodType.A,
		B: BloodType.B,
		O: BloodType.O,
		AB: BloodType.AB,
		// Add variations
		"A+": BloodType.A,
		"A-": BloodType.A,
		"B+": BloodType.B,
		"B-": BloodType.B,
		"O+": BloodType.O,
		"O-": BloodType.O,
		"AB+": BloodType.AB,
		"AB-": BloodType.AB,
	};

	const cleanedType = text.trim().toUpperCase();
	return bloodTypeMap[cleanedType];
}

function extractPhysicalInfo(
	$: cheerio.CheerioAPI,
): NonNullable<Idol["physicalInfo"]> {
	const info: NonNullable<Idol["physicalInfo"]> = {};

	$(".data-grid .equal").each((_, el) => {
		const $el = $(el);
		const label = $el.find("strong").text().trim();
		const value = cleanText($el.next(".equal").text());

		if (label === "Blood type:") {
			try {
				const bloodType = parseBloodType(value);
				if (bloodType) {
					info.bloodType = bloodType;
				}
			} catch (error) {
				logger.warn(`Failed to parse blood type: ${value}`);
			}
		}
		// ... rest of the physical info parsing
	});

	return info;
}

async function extractGroupData(
	$: cheerio.CheerioAPI,
	url: string,
	gender: "female" | "male" | "coed",
): Promise<Group> {
	const group: Group = {
		id: uuidv4(),
		type:
			gender === "female"
				? GroupType.Girl
				: gender === "male"
					? GroupType.Boy
					: GroupType.Coed,
		profileUrl: url,
		imageUrl: extractImageUrl($) || "",
		active: false,
		status: Status.Inactive,
		company: extractCompanyInfo($) || null,
		socialMedia: extractSocialMediaLinks($),
		memberHistory: {
			currentMembers: [],
			formerMembers: [],
		},
		groupInfo: {
			debutDate: null,
			disbandmentDate: null,
			names: {
				stage: null,
				korean: null,
				japanese: null,
				chinese: null,
			},
			fandomName: extractFandomName($) || null,
		},
	};

	const stats = extractStats($);
	if (Object.keys(stats).length > 0) {
		group.stats = stats;
	}

	const attributeEntries = collectAttributeEntries($);
	const groupProfile: GroupProfile = {};
	const extraFields: AttributeField[] = [];
	let fandomInfo: FandomInfo | undefined;
	for (const entry of attributeEntries) {
		const normalized = normalizeLabel(entry.label);
		const valueText = entry.value ?? "";
		const valueElement = entry.valueElement as cheerio.Cheerio<any> | undefined;
		let handled = false;

		switch (normalized) {
			case "country": {
				const name = valueText;
				if (name) {
					const flagClass = valueElement
						?.find(".flag-icon")
						.attr("class");
					const codeMatch = flagClass?.match(/flag-icon-([a-z]{2})/i);
					group.country = {
						name,
						code: codeMatch ? codeMatch[1] : undefined,
					};
					handled = true;
				}
				break;
			}
			case "fandom": {
				if (!fandomInfo) fandomInfo = {};
				fandomInfo.name = valueText || fandomInfo.name || null;
				handled = true;
				break;
			}
			case "fandom color s":
			case "fandom colors": {
				const colors = extractColorsFromEntry(entry);
				if (colors.length > 0) {
					if (!fandomInfo) fandomInfo = {};
					fandomInfo.colors = [...new Set([...(fandomInfo.colors ?? []), ...colors])];
				}
				handled = true;
				break;
			}
			case "representative color":
			case "representative colors": {
				const colors = extractColorsFromEntry(entry);
				if (colors.length > 0) {
					groupProfile.representativeColors = [
						...new Set([...(groupProfile.representativeColors ?? []), ...colors]),
					];
				}
				handled = true;
				break;
			}
			case "subgroup s":
			case "subgroups": {
				const subgroups = parseDelimitedList(valueText);
				if (subgroups.length > 0) {
					groupProfile.subgroups = [...new Set([...(groupProfile.subgroups ?? []), ...subgroups])];
				}
				handled = true;
				break;
			}
			case "main group": {
				if (valueText) {
					groupProfile.mainGroup = valueText;
					handled = true;
				}
				break;
			}
			case "most popular member": {
				if (valueText) {
					groupProfile.mostPopularMember = valueText;
					handled = true;
				}
				break;
			}
			case "debut to 1st win":
			case "debut to first win": {
				if (valueText) {
					groupProfile.debutToFirstWin = valueText;
					handled = true;
				}
				break;
			}
			case "alias":
			case "also known as": {
				const aliases = parseDelimitedList(valueText);
				if (aliases.length > 0) {
					groupProfile.aliases = [...new Set([...(groupProfile.aliases ?? []), ...aliases])];
				}
				handled = true;
				break;
			}
			default:
				break;
		}

		if (!handled) {
			const cleanedValue = cleanText(valueText);
			if (cleanedValue && cleanedValue !== "-") {
				extraFields.push({ label: entry.label, value: cleanedValue });
			}
		}
	}

	const groupTags = extractCategoryTags($);
	if (groupTags.length > 0) {
		group.tags = groupTags;
	}

	if (fandomInfo && !fandomInfo.name && (!fandomInfo.colors || fandomInfo.colors.length === 0)) {
		fandomInfo = undefined;
	}

	if (fandomInfo) {
		group.fandom = fandomInfo;
		if (!group.groupInfo.fandomName && fandomInfo.name) {
			group.groupInfo.fandomName = fandomInfo.name;
		}
	} else if (group.groupInfo.fandomName) {
		group.fandom = { name: group.groupInfo.fandomName };
	}

	if (extraFields.length > 0) {
		group.extraFields = extraFields;
	}

	if (
		groupProfile.mainGroup ||
		groupProfile.subgroups?.length ||
		groupProfile.representativeColors?.length ||
		groupProfile.mostPopularMember ||
		groupProfile.debutToFirstWin ||
		groupProfile.aliases?.length
	) {
		group.profile = cleanupUndefined(groupProfile);
	}

	// Enhanced group name extraction
	const names: GroupNames = {
		stage: null as string | null,
		korean: null as string | null,
		japanese: null as string | null,
		chinese: null as string | null,
	};

	// Get stage name from h1
	names.stage =
		$("h1").first().text()?.trim().split(/[([]/, 1)[0]?.trim() ?? "";

	// Try extracting from schema data first
	try {
		const schemaData = JSON.parse(
			$('script[type="application/ld+json"]').first().text(),
		);
		if (schemaData.sameAs) {
			const [_, korean, japanese, chinese] = schemaData.sameAs.split(",");
			if (korean) names.korean = korean.trim();
			if (japanese) names.japanese = japanese.trim();
			if (chinese) names.chinese = chinese.trim();
		}
	} catch (e) {
		// Schema parsing failed, continue with DOM extraction
	}

	// Extract from native name elements if schema didn't provide all names
	for (const el of $(".native-name").toArray()) {
		const $el = $(el);
		const type = $el.find("dfn").text().toLowerCase();
		const name = cleanText($el.text().replace(/^[^:：]*[:：]?\s*/, ""));

		if (!name || name === "-") continue;

		if (type.includes("korean") && !names.korean) names.korean = name;
		else if (type.includes("japanese") && !names.japanese)
			names.japanese = name;
		else if (type.includes("chinese") && !names.chinese) names.chinese = name;
	}

	// Ensure we have at least one native name by trying h2 subtitles
	if (!names.korean && !names.japanese && !names.chinese) {
		$("h2 .native-name").each((_, el) => {
			const $el = $(el);
			const type = $el.find("dfn").text().toLowerCase();
			const name = cleanText($el.text().replace(/^[^:：]*[:：]?\s*/, ""));

			if (!name || name === "-") return;

			if (type.includes("korean")) names.korean = name;
			else if (type.includes("japanese")) names.japanese = name;
			else if (type.includes("chinese")) names.chinese = name;
		});
	}

	group.groupInfo.names = cleanupUndefined(names);

	// Enhanced status detection
	const statusText = $(
		'.data-grid .equal:contains("Current state:"), .data-grid .equal:contains("Status:")',
	)
		.next()
		.text()
		.trim();
	const profileContent = `${$(".profile-content").text()} ${$(".data-grid").text()}`;

	group.active = !isInactiveStatus(statusText, profileContent);
	group.status = group.active ? Status.Active : Status.Inactive;

	// Extract debut date
	const debutCell = $('.data-grid .cell:contains("Debut:")');
	if (debutCell.length) {
		const debutText = cleanText(debutCell.find(".value").text());
		const debutDate = extractDateFromText(debutText);
		if (debutDate) {
			if (!group.groupInfo)
				group.groupInfo = {
					debutDate: null,
					disbandmentDate: null,
					names: {
						stage: null,
						korean: null,
						japanese: null,
						chinese: null,
					},
					fandomName: null,
				};
			group.groupInfo.debutDate = debutDate;
		}
	}

	// Extract disbandment date if applicable
	if (group.status === "inactive") {
		// Try multiple selectors for disbandment date
		const disbandmentText =
			$(
				'.data-grid .equal:contains("Disbandment:"), .data-grid .equal:contains("Disbanded:")',
			)
				.next()
				.text()
				.trim() ||
			$('.profile-content p:contains("disbanded on")')
				.text()
				.match(/disbanded on\s+([^.]+)/i)?.[1];

		if (disbandmentText) {
			const disbandmentDate = normalizeDate(disbandmentText);
			if (disbandmentDate) {
				if (!group.groupInfo)
					group.groupInfo = {
						debutDate: null,
						disbandmentDate: null,
						names: {
							stage: null,
							korean: null,
							japanese: null,
							chinese: null,
						},
						fandomName: null,
					};
				group.groupInfo.disbandmentDate = disbandmentDate;
			}
		}
	}

	// Extract fandom name
	const fandom =
		$(".data-grid .equal")
			.filter((_, el) => {
				return $(el).find("strong").text().trim() === "Fandom:";
			})
			.next(".equal")
			.text()
			.trim() || undefined;

	// Extract member history with IDs
	const memberHistory = {
		currentMembers: [] as GroupMember[],
		formerMembers: [] as GroupMember[],
	};

	// Current members
	$(".members a").each((_, el) => {
		const $member = $(el);
		const name = $member.find("strong, p").first().text().trim();
		const profileUrl = ($member.attr("href") || "").startsWith("http")
			? $member.attr("href") || ""
			: `${BASE_URL}${$member.attr("href") || ""}`;

		if (name && profileUrl) {
			const memberId = getIdFromProfileUrl(profileUrl);
			const member: GroupMember = {
				name,
				profileUrl,
			};
			if (memberId) {
				member.id = memberId;
			}
			memberHistory.currentMembers.push(member);
		}
	});

	// Former members
	$('h3:contains("Past members")')
		.next(".members")
		.find("a")
		.each((_, el) => {
			const $member = $(el);
			const name = $member.find("strong, p").first().text().trim();
			const profileUrl = ($member.attr("href") || "").startsWith("http")
				? $member.attr("href") || ""
				: `${BASE_URL}${$member.attr("href") || ""}`;

			if (name && profileUrl) {
				const memberId = getIdFromProfileUrl(profileUrl);
				const member: GroupMember = {
					name,
					profileUrl,
				};
				if (memberId) {
					member.id = memberId;
				}
				memberHistory.formerMembers.push(member);
			}
		});

	group.memberHistory = {
		currentMembers: memberHistory.currentMembers.filter((m) => m.profileUrl),
		formerMembers: memberHistory.formerMembers.filter((m) => m.profileUrl),
	};

	// Cache the group's ID
	cacheProfileId(url, group.id);

	return cleanupUndefined({ ...group });
}

function extractFandomName($: cheerio.CheerioAPI): string | null {
	const fandomCell = $(".data-grid .cell, .data-grid .equal").filter((_, el) =>
		$(el).text().toLowerCase().includes("fandom"),
	);

	if (fandomCell.length) {
		// Get the actual text content, stripping any HTML and styling
		const fandomValue = fandomCell
			.find(".value")
			.contents()
			.filter((_, el) => el.type === "text")
			.text()
			.trim();

		if (!fandomValue || fandomValue === "-") return null;

		// Clean up any remaining artifacts and normalize whitespace
		return fandomValue
			.replace(/^\s*[:：]\s*/, "") // Remove leading colons
			.replace(/\s+/g, " ") // Normalize whitespace
			.trim();
	}

	// Try alternate selectors if the first one fails
	const altFandomCell = $(".data-grid .equal").filter((_, el) => {
		const label = $(el).find("strong").text().trim();
		return label.toLowerCase() === "fandom:";
	});

	if (altFandomCell.length) {
		const fandomValue = altFandomCell
			.next(".equal")
			.contents()
			.filter((_, el) => el.type === "text")
			.text()
			.trim();

		if (!fandomValue || fandomValue === "-") return null;

		return fandomValue
			.replace(/^\s*[:：]\s*/, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	return null;
}

async function parseIdolProfile(
	$: cheerio.CheerioAPI,
	url: string,
): Promise<Idol> {
	const description = parseDescription($);
	const location = parseLocation($);
	const names = parseNames($);
	const birthDate = parseBirthday($);
	const bloodTypeText = $('.data-grid .equal:contains("Blood type:")')
		.next()
		.text()
		.trim();
	const bloodType = parseBloodType(bloodTypeText);

	const idol: Idol = {
		id: uuidv4(),
		profileUrl: url,
		imageUrl: extractImageUrl($) || null,
		active: false,
		status: Status.Inactive,
		company: extractCompanyInfo($) || null,
		socialMedia: extractSocialMediaLinks($),
		names,
		description,
		country: location.country,
		physicalInfo: {
			birthDate,
			bloodType,
		},
	};

	const stats = extractStats($);
	if (Object.keys(stats).length > 0) {
		idol.stats = stats;
	}

	const attributeEntries = collectAttributeEntries($);
	const idolProfile: IdolProfile = {};
	const extraFields: AttributeField[] = [];
	let fandom: FandomInfo | undefined;

	for (const entry of attributeEntries) {
		const normalized = normalizeLabel(entry.label);
		const valueText = entry.value ?? "";
		let handled = false;

		switch (normalized) {
			case "height": {
				const height = parseHeight(valueText);
				if (height) {
					idol.physicalInfo = { ...idol.physicalInfo, heightCm: height };
					handled = true;
				}
				break;
			}
			case "weight": {
				const weight = parseWeight(valueText);
				if (weight) {
					idol.physicalInfo = { ...idol.physicalInfo, weightKg: weight };
					handled = true;
				}
				break;
			}
			case "language s":
			case "languages": {
				const languages = parseDelimitedList(valueText);
				if (languages.length > 0) {
					idolProfile.languages = [...new Set([...(idolProfile.languages ?? []), ...languages])];
					handled = true;
				}
				break;
			}
			case "position":
			case "positions": {
				const positions = parseDelimitedList(valueText);
				if (positions.length > 0) {
					idolProfile.positions = [...new Set([...(idolProfile.positions ?? []), ...positions])];
					handled = true;
				}
				break;
			}
			case "education": {
				const education = parseDelimitedList(valueText);
				if (education.length > 0) {
					idolProfile.education = [...new Set([...(idolProfile.education ?? []), ...education])];
					handled = true;
				}
				break;
			}
			case "nickname":
			case "nicknames": {
				const nicknames = parseDelimitedList(valueText);
				if (nicknames.length > 0) {
					idolProfile.nicknames = [...new Set([...(idolProfile.nicknames ?? []), ...nicknames])];
					handled = true;
				}
				break;
			}
			case "training period": {
				if (valueText) {
					idolProfile.trainingPeriod = valueText;
					handled = true;
				}
				break;
			}
			case "zodiac sign":
			case "zodiac-sign": {
				if (valueText) {
					idolProfile.zodiacSign = valueText;
					handled = true;
				}
				break;
			}
			case "fandom": {
				if (!fandom) fandom = {};
				fandom.name = valueText || fandom.name || null;
				handled = true;
				break;
			}
			case "fandom color s":
			case "fandom colors": {
				const colors = extractColorsFromEntry(entry);
				if (colors.length > 0) {
					if (!fandom) fandom = {};
					fandom.colors = [...new Set([...(fandom.colors ?? []), ...colors])];
				}
				handled = true;
				break;
			}
			case "representative color":
			case "representative colors": {
				const colors = extractColorsFromEntry(entry);
				if (colors.length > 0) {
					idolProfile.representativeColors = [
						...new Set([...(idolProfile.representativeColors ?? []), ...colors]),
					];
				}
				handled = true;
				break;
			}
			case "debut to 1st win":
			case "debut to first win": {
				if (valueText) {
					idolProfile.debutToFirstWin = [...(idolProfile.debutToFirstWin ?? []), valueText];
					handled = true;
				}
				break;
			}
			case "kpopping rank": {
				if (valueText) {
					idolProfile.rankings = [...(idolProfile.rankings ?? []), valueText];
					handled = true;
				}
				break;
			}
			default:
				break;
		}

		if (!handled) {
			const cleanedValue = cleanText(valueText);
			if (cleanedValue && cleanedValue !== "-") {
				extraFields.push({ label: entry.label, value: cleanedValue });
			}
		}
	}

	const tags = extractCategoryTags($);
	if (tags.length > 0) {
		idol.tags = tags;
	}

	if (fandom && !fandom.name && (!fandom.colors || fandom.colors.length === 0)) {
		fandom = undefined;
	}

	if (fandom) {
		idol.fandom = fandom;
	}

	if (extraFields.length > 0) {
		idol.extraFields = extraFields;
	}

	if (
		idolProfile.positions?.length ||
		idolProfile.languages?.length ||
		idolProfile.education?.length ||
		idolProfile.nicknames?.length ||
		idolProfile.representativeColors?.length ||
		idolProfile.debutToFirstWin?.length ||
		idolProfile.rankings?.length ||
		idolProfile.trainingPeriod ||
		idolProfile.zodiacSign
	) {
		idol.profile = cleanupUndefined(idolProfile);
	}

	// Enhanced status detection
	const statusText = $(
		'.data-grid .equal:contains("Current state:"), .data-grid .equal:contains("Status:")',
	)
		.next()
		.text()
		.trim();
	const profileContent = `${$(".profile-content").text()} ${$(".data-grid").text()}`;

	idol.active = !isInactiveStatus(statusText, profileContent);
	idol.status = idol.active ? Status.Active : Status.Inactive;

	// Extract personal info with MBTI
	const personalInfo = extractIdolPersonalInfo($);
	if (Object.keys(personalInfo).length > 0) {
		idol.personalInfo = personalInfo;
	}

	// Extract physical info
	const physicalInfo = extractPhysicalInfo($);
	if (Object.keys(physicalInfo).length > 0) {
		idol.physicalInfo = { ...idol.physicalInfo, ...physicalInfo };
	}

	// Extract career info
	const careerInfo = extractIdolCareerInfo($);
	if (Object.keys(careerInfo).length > 0) {
		idol.careerInfo = careerInfo;
	}

	// Extract group affiliations with IDs
	const groups: GroupActivity[] = [];
	$("#idol-associated-groups .group").each((_, el) => {
		const $group = $(el);
		const name = $group.find("h4 a").text().trim();
		const groupUrl = ($group.find("h4 a").attr("href") || "").startsWith("http")
			? $group.find("h4 a").attr("href")
			: `${BASE_URL}${$group.find("h4 a").attr("href")}`;
		const status: "current" | "former" = $group
			.find("figcaption i")
			.hasClass("fa-play-circle")
			? "current"
			: "former";

		if (name && groupUrl) {
			const groupData: GroupActivity = {
				name,
				status,
				period: parsePeriod($group.find("figcaption span").text()) || undefined,
			};
			const groupId = getIdFromProfileUrl(groupUrl);
			if (groupId) {
				groupData.id = groupId;
			}
			groups.push(groupData);
		}
	});

	if (groups.length > 0) {
		idol.groups = groups;
	}

	// Cache the idol's ID
	cacheProfileId(url, idol.id);

	return cleanupUndefined(idol);
}

function extractIdolCareerInfo(
	$: cheerio.CheerioAPI,
): NonNullable<Idol["careerInfo"]> {
	const info: NonNullable<Idol["careerInfo"]> = { activeYears: [] };

	// Extract debut date from dedicated field
	const debutCell = $('.data-grid .cell:contains("Debut:")');
	if (debutCell.length) {
		const debutText = cleanText(debutCell.find(".value").text());
		const debutDate = extractDateFromText(debutText);
		if (debutDate) {
			info.debutDate = debutDate;
		}
	}

	// Use Set to store unique period strings
	const uniquePeriods = new Set<string>();

	// Extract company history
	$("#star-companies .cell, #company-info .cell").each((_, el) => {
		const $cell = $(el);
		const periodText = cleanText($cell.find(".value").text());

		const period = parsePeriod(periodText);
		if (period) {
			// Create unique key for the period
			const periodKey = `${period.start}-${period.end || "present"}`;

			// Only add if we haven't seen this period before
			if (!uniquePeriods.has(periodKey)) {
				uniquePeriods.add(periodKey);
				if (!info.activeYears) info.activeYears = [];
				info.activeYears.push(period);
			}
		}
	});

	// Sort active years by start date (most recent first)
	info.activeYears.sort((a, b) => {
		return new Date(b.start).getTime() - new Date(a.start).getTime();
	});

	return cleanupUndefined(info);
}

function extractIdolPersonalInfo(
	$: cheerio.CheerioAPI,
): NonNullable<Idol["personalInfo"]> {
	const info: NonNullable<Idol["personalInfo"]> = {};

	// Extract MBTI
	const mbtiText = $('.data-grid .cell:contains("MBTI:")')
		.find(".value")
		.text()
		.trim();
	if (mbtiText?.match(/^[IE][NS][FT][JP]$/)) {
		info.mbti = mbtiText;
	}

	return cleanupUndefined(info);
}

function calculateDuration(start: string, end?: string): string {
	const startDate = new Date(start);
	const endDate = end ? new Date(end) : new Date();
	const months =
		(endDate.getFullYear() - startDate.getFullYear()) * 12 +
		(endDate.getMonth() - startDate.getMonth());

	if (months < 12) return `${months} months`;
	const years = Math.floor(months / 12);
	const remainingMonths = months % 12;
	return remainingMonths > 0
		? `${years} years ${remainingMonths} months`
		: `${years} years`;
}

async function processIncrementalScraping(options: {
	existingData: DataSet;
	type: "idol" | "group";
	gender: "female" | "male" | "coed";
	forceRefresh?: boolean; // Add forceRefresh parameter
	concurrency?: number;
}): Promise<(Idol | Group)[]> {
	const { existingData, type, gender, forceRefresh = false, concurrency } = options;

	// Get existing profile URLs
	const existingUrls = new Set(
		Object.values(existingData)
			.flat()
			.map((profile) => profile.profileUrl),
	);

	// Get all profile URLs for this category
	const endpoint = getEndpointForType(type, gender);
	const mainPageHtml = await parseProfileWithCache(
		`${BASE_URL}${endpoint}`,
		type,
		forceRefresh, // Pass forceRefresh here
	);

	if (!mainPageHtml) {
		logger.error(`Failed to fetch main page for ${gender} ${type}s, skipping category`);
		return [];
	}

	const $ = cheerio.load(mainPageHtml);
	const allUrls = extractProfileLinks($);

	// When forceRefresh is true, we want to process ALL URLs, not just new ones
	const urlsToProcess = forceRefresh
		? allUrls
		: allUrls.filter((url) => !existingUrls.has(url));
	logger.info(
		`Found ${urlsToProcess.length} ${forceRefresh ? "" : "new "}profiles to process`,
	);

	// Process URLs
	return await scrapeProfiles({
		type,
		gender,
		urls: urlsToProcess,
		useCache: !forceRefresh, // Don't use cache when forceRefresh is true
		forceRefresh, // Pass forceRefresh to scrapeProfiles
		concurrency,
	});
}

async function runProductionMode(options: {
	batchSize: number;
	delayBetweenBatches: number;
	useCache: boolean;
	forceRefresh: boolean;
	offline: boolean;
}): Promise<void> {
	offlineMode = options.offline;
	const concurrency = Math.max(1, options.batchSize);

	let proxyPoolSize = 0;
	if (!offlineMode) {
		await proxyManager.initialize();
		proxyPoolSize = proxyManager.getPoolSize();
		scraperUI.setCurrentProxy(null);
	} else {
		proxyManager.reset();
	}

	let dataset: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: [],
	};

	try {
		const existingGroups = require(PATHS.GROUPS_FILE);
		const existingIdols = require(PATHS.IDOLS_FILE);
		dataset = {
			...dataset,
			...existingGroups,
			...existingIdols,
		};
		logger.info("Loaded existing dataset");
		initializeUrlToIdCache(dataset);
		logger.info("Initialized URL to ID cache");
	} catch (e) {
		logger.warn("No existing dataset found, starting fresh");
	}

	scraperUI.startSession("production", {
		batchSize: options.batchSize,
		delayBetweenBatches: options.delayBetweenBatches,
		useCache: options.useCache,
		forceRefresh: options.forceRefresh,
		offline: offlineMode,
		concurrency,
		proxyPoolSize,
	});

	const categories = [
		{ type: "idol" as const, gender: "female" as const },
		{ type: "idol" as const, gender: "male" as const },
		{ type: "group" as const, gender: "female" as const },
		{ type: "group" as const, gender: "male" as const },
		{ type: "group" as const, gender: "coed" as const },
	];

	try {
		for (const category of categories) {
			try {
				logger.info(`Processing ${category.gender} ${category.type}s...`);

				const newProfiles = await processIncrementalScraping({
					existingData: dataset,
					...category,
					forceRefresh: options.forceRefresh,
					concurrency,
				});

				if (category.type === "idol") {
					if (category.gender === "female") {
						dataset.femaleIdols = mergeProfiles(
							dataset.femaleIdols,
							newProfiles as Idol[],
						);
					} else {
						dataset.maleIdols = mergeProfiles(
							dataset.maleIdols,
							newProfiles as Idol[],
						);
					}
				} else {
					if (category.gender === "female") {
						dataset.girlGroups = mergeProfiles(
							dataset.girlGroups,
							newProfiles as Group[],
						);
					} else if (category.gender === "male") {
						dataset.boyGroups = mergeProfiles(
							dataset.boyGroups,
							newProfiles as Group[],
						);
					} else {
						dataset.coedGroups = mergeProfiles(
							dataset.coedGroups,
							newProfiles as Group[],
						);
					}
				}

				await saveDataset(dataset);
				logger.success(`Completed ${category.gender} ${category.type}s`);
			} catch (error) {
				logger.error(
					`Failed to process ${category.gender} ${category.type}s: ${error instanceof Error ? error.message : String(error)}`,
				);
				logger.warn(`Continuing with next category...`);
				try {
					await saveDataset(dataset);
				} catch (saveError) {
					logger.error(`Failed to save dataset after error: ${saveError}`);
				}
			}

			if (!offlineMode && options.delayBetweenBatches > 0) {
				await delay(options.delayBetweenBatches);
			}
		}
	} finally {
		scraperUI.stop();
	}
}

function mergeProfiles<T extends { id: string; profileUrl: string }>(
	existing: T[],
	newProfiles: T[],
): T[] {
	const merged = [...existing];
	const urlToId = new Map(existing.map((p) => [p.profileUrl, p.id]));

	for (const profile of newProfiles) {
		const existingId = urlToId.get(profile.profileUrl);
		if (existingId) {
			// Update existing profile
			const index = merged.findIndex((p) => p.id === existingId);
			if (index !== -1) {
				merged[index] = { ...profile, id: existingId };
			}
		} else {
			// Add new profile
			merged.push(profile);
			cacheProfileId(profile.profileUrl, profile.id); // Cache the new profile ID
		}
	}

	return merged;
}

function cleanupUndefined<T extends object>(obj: T): T {
	const cleaned: Record<string, unknown> = {
		...(obj as Record<string, unknown>),
	};

	for (const [key, value] of Object.entries(cleaned)) {
		if (value === undefined) {
			delete cleaned[key];
			continue;
		}

		if (Array.isArray(value)) {
			if (value.length === 0) {
				delete cleaned[key];
				continue;
			}

			const cleanedArray = [];
			for (const item of value) {
				if (typeof item === "object" && item !== null) {
					cleanedArray.push(cleanupUndefined(item));
				} else {
					cleanedArray.push(item);
				}
			}
			cleaned[key] = cleanedArray;
		} else if (typeof value === "object" && value !== null) {
			const cleanedChild = cleanupUndefined(value);
			if (Object.keys(cleanedChild).length === 0) {
				delete cleaned[key];
			} else {
				(cleaned as Record<string, unknown>)[key] = cleanedChild;
			}
		}
	}

	return cleaned as T;
}

function calculateZodiacSign(date: string): string | undefined {
	const [year, month, day] = date.split("-").map((n) => Number.parseInt(n));

	const zodiacRanges = [
		{ sign: "Capricorn", start: [1, 1], end: [1, 19] },
		{ sign: "Aquarius", start: [1, 20], end: [2, 18] },
		{ sign: "Pisces", start: [2, 19], end: [3, 20] },
		{ sign: "Aries", start: [3, 21], end: [4, 19] },
		{ sign: "Taurus", start: [4, 20], end: [5, 20] },
		{ sign: "Gemini", start: [5, 21], end: [6, 20] },
		{ sign: "Cancer", start: [6, 21], end: [7, 22] },
		{ sign: "Leo", start: [7, 23], end: [8, 22] },
		{ sign: "Virgo", start: [8, 23], end: [9, 22] },
		{ sign: "Libra", start: [9, 23], end: [10, 22] },
		{ sign: "Scorpio", start: [10, 23], end: [11, 21] },
		{ sign: "Sagittarius", start: [11, 22], end: [12, 21] },
		{ sign: "Capricorn", start: [12, 22], end: [12, 31] },
	];

	for (const range of zodiacRanges) {
		const [startMonth, startDay] = range.start;
		const [endMonth, endDay] = range.end;

		if (
			(month === startMonth && (day ?? 0) >= (startDay ?? 0)) ||
			(month === endMonth && day !== undefined && day <= (endDay ?? 31))
		) {
			return range.sign;
		}
	}

	return undefined;
}

function getEndpointForType(
	type: "idol" | "group",
	gender: "female" | "male" | "coed",
): string {
	if (type === "idol") {
		return gender === "female" ? ENDPOINTS.femaleIdols : ENDPOINTS.maleIdols;
	}
	return gender === "female"
		? ENDPOINTS.girlGroups
		: gender === "male"
			? ENDPOINTS.boyGroups
			: ENDPOINTS.coedGroups;
}

async function scrapeProfiles(options: {
	type: "idol" | "group";
	gender: "female" | "male" | "coed";
	debug?: boolean;
	sampleSize?: number;
	urls?: string[];
	useCache?: boolean;
	forceRefresh?: boolean; // Add forceRefresh parameter
	concurrency?: number;
}): Promise<(Idol | Group)[]> {
	const {
		type,
		gender,
		debug = false,
		sampleSize = 5,
		urls,
		useCache = true,
		forceRefresh = false, // Default to false
		concurrency,
	} = options;

	// Reset metrics for this scrape session

	try {
		// Get URLs to process
		let profileUrls = urls;
		if (!profileUrls) {
			const endpoint = getEndpointForType(type, gender);
			const mainPageHtml = await parseProfileWithCache(
				`${BASE_URL}${endpoint}`,
				type,
				forceRefresh, // Pass forceRefresh here
			);
			
			if (!mainPageHtml) {
				logger.error(`Failed to fetch main page for ${gender} ${type}s, skipping category`);
				return [];
			}
			
			const $ = cheerio.load(mainPageHtml);
			profileUrls = extractProfileLinks($);
		}

		if (debug) {
			profileUrls = profileUrls
				.sort(() => Math.random() - 0.5)
				.slice(0, sampleSize);
		}

		// Load existing data
		const existingData = loadExistingData();
		const processedUrls = new Set(getAllProfileUrls(existingData));

		// Filter out already processed URLs unless forceRefresh is true
		const newUrls = forceRefresh
			? profileUrls
			: profileUrls.filter((url) => !processedUrls.has(url));
		const total = newUrls.length;

		logger.info(`Starting ${gender} ${type} scraping...`);
		logger.info(`Total profiles to process: ${total}`);
		logger.info(`Using cache: ${useCache && !forceRefresh}`);
		if (!forceRefresh && processedUrls.size > 0) {
			logger.info(`Skipping ${processedUrls.size} already processed profiles`);
		}

		scraperUI.setCategory(`${gender} ${type}`, total);
		scraperUI.setCurrentUrl(null);

		const results: (Idol | Group)[] = [];
		const batchSize = concurrency ? Math.max(1, concurrency) : CONFIG.concurrentRequests;

		const processUrl = async (url: string) => {
			try {
				scraperUI.setCurrentUrl(url);
				// Try cache first, but respect forceRefresh
				const html = await parseProfileWithCache(
					url,
					type,
					forceRefresh || !useCache, // Force refresh if forceRefresh is true or useCache is false
				);
				
				if (!html) {
					logger.warn(`Skipping ${url} due to fetch failure`);
					scraperUI.incrementProgress({ failure: true });
					return null;
				}
				
				const $ = cheerio.load(html);
				const result =
					type === "idol"
						? await parseIdolProfile($, url)
						: await extractGroupData($, url, gender);

				scraperUI.incrementProgress({ success: true });
				return result;
			} catch (error) {
				scraperUI.incrementProgress({ failure: true });
				logger.error(
					`Failed to process ${url}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return null;
			}
		};

		// Process in batches
		for (let i = 0; i < newUrls.length; i += batchSize) {
			const batch = newUrls.slice(i, i + batchSize);
			const batchResults = await Promise.all(batch.map(processUrl));
			results.push(
				...batchResults.filter((r): r is Idol | Group => r !== null),
			);

			// Save progress incrementally
			if (results.length > 0) {
				await saveIncrementalProgress(results, type, gender);
			}

			await delay(CONFIG.rateLimitDelay);
		}

		scraperUI.setCurrentUrl(null);

		return results;
	} catch (error) {
		logger.error(
			`Failed to scrape ${gender} ${type}s: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

// Add helper functions for loading and saving incremental data
function loadExistingData(): DataSet {
	try {
		const groupsPath = PATHS.GROUPS_FILE;
		const idolsPath = PATHS.IDOLS_FILE;

		const groups = fs.existsSync(groupsPath)
			? JSON.parse(fs.readFileSync(groupsPath, "utf-8"))
			: {};
		const idols = fs.existsSync(idolsPath)
			? JSON.parse(fs.readFileSync(idolsPath, "utf-8"))
			: {};

		return {
			femaleIdols: idols.femaleIdols || [],
			maleIdols: idols.maleIdols || [],
			girlGroups: groups.girlGroups || [],
			boyGroups: groups.boyGroups || [],
			coedGroups: groups.coedGroups || [],
		};
	} catch (error) {
		logger.warn("Failed to load existing data, starting fresh");
		return {
			femaleIdols: [],
			maleIdols: [],
			girlGroups: [],
			boyGroups: [],
			coedGroups: [],
		};
	}
}

function getAllProfileUrls(dataset: DataSet): string[] {
	return [
		...dataset.femaleIdols,
		...dataset.maleIdols,
		...dataset.girlGroups,
		...dataset.boyGroups,
		...dataset.coedGroups,
	].map((profile) => profile.profileUrl);
}

async function saveIncrementalProgress(
	results: (Idol | Group)[],
	type: "idol" | "group",
	gender: "female" | "male" | "coed",
): Promise<void> {
	// Load existing dataset
	const existingData = loadExistingData();

	// Merge new results with existing data based on type and gender
	if (type === "idol") {
		if (gender === "female") {
			existingData.femaleIdols = mergeProfiles(
				existingData.femaleIdols,
				results as Idol[],
			);
		} else {
			existingData.maleIdols = mergeProfiles(
				existingData.maleIdols,
				results as Idol[],
			);
		}
	} else {
		if (gender === "female") {
			existingData.girlGroups = mergeProfiles(
				existingData.girlGroups,
				results as Group[],
			);
		} else if (gender === "male") {
			existingData.boyGroups = mergeProfiles(
				existingData.boyGroups,
				results as Group[],
			);
		} else {
			existingData.coedGroups = mergeProfiles(
				existingData.coedGroups,
				results as Group[],
			);
		}
	}

	// Save updated dataset
	await saveDataset(existingData);
}

async function runDebugMode(options: {
	sampleSize: number;
	randomSamples: boolean;
	batchSize: number;
	delayBetweenBatches: number;
	useCache: boolean;
	offline: boolean;
}): Promise<void> {
	offlineMode = options.offline;
	const concurrency = Math.max(1, options.batchSize);

	let proxyPoolSize = 0;
	if (!offlineMode) {
		await proxyManager.initialize();
		proxyPoolSize = proxyManager.getPoolSize();
		scraperUI.setCurrentProxy(null);
	} else {
		proxyManager.reset();
	}

	const dataset: DataSet = {
		femaleIdols: [],
		maleIdols: [],
		girlGroups: [],
		boyGroups: [],
		coedGroups: [],
	};

	logger.info("Starting debug mode scraping...");
	scraperUI.startSession("debug", {
		batchSize: options.batchSize,
		delayBetweenBatches: options.delayBetweenBatches,
		useCache: options.useCache,
		forceRefresh: false,
		offline: offlineMode,
		sampleSize: options.sampleSize,
		concurrency,
		proxyPoolSize,
	});

	const categories = [
		{ type: "group" as const, gender: "female" as const },
		{ type: "group" as const, gender: "male" as const },
		{ type: "group" as const, gender: "coed" as const },
		{ type: "idol" as const, gender: "female" as const },
		{ type: "idol" as const, gender: "male" as const },
	];

	try {
		for (const category of categories) {
			logger.info(`Scraping ${category.gender} ${category.type}s...`);
			const profiles = await scrapeProfiles({
				...category,
				debug: true,
				sampleSize: options.sampleSize,
				useCache: options.useCache,
				concurrency,
			});

			if (category.type === "idol") {
				if (category.gender === "female")
					dataset.femaleIdols.push(...(profiles as Idol[]));
				else dataset.maleIdols.push(...(profiles as Idol[]));
			} else {
				if (category.gender === "female")
					dataset.girlGroups.push(...(profiles as Group[]));
				else if (category.gender === "male")
					dataset.boyGroups.push(...(profiles as Group[]));
				else dataset.coedGroups.push(...(profiles as Group[]));
			}

			if (!options.useCache && !offlineMode && options.delayBetweenBatches > 0) {
				logger.info(
					`Waiting ${options.delayBetweenBatches}ms before next category`,
				);
				await delay(options.delayBetweenBatches);
			}
		}

		logger.info("Saving dataset...");
		await saveDataset(dataset);
		logger.success("Debug mode scraping completed");
	} finally {
		scraperUI.stop();
	}
}

function isInactiveStatus(statusText: string, content: string): boolean {
	const inactiveKeywords = [
		"disbanded",
		"inactive",
		"hiatus",
		"terminated",
		"retired",
		"left industry",
		"no longer active",
		"graduation",
		"withdraws",
		"withdrawal",
		"former member",
		"left group",
		"withdrew",
		"disbanded group",
		"ex-member",
		"former artist",
		"ended activities",
		"left company",
	];

	// Convert to lowercase for case-insensitive matching
	const lowerStatusText = statusText.toLowerCase();
	const lowerContent = content.toLowerCase();

	// Check if explicitly marked as inactive
	if (
		lowerStatusText.includes("inactive") ||
		lowerStatusText.includes("disbanded")
	) {
		return true;
	}

	// Check if status mentions being a former member
	if (lowerStatusText.includes("former") || lowerStatusText.includes("ex-")) {
		return true;
	}

	// Check full content for disbandment/inactivity signs
	for (const keyword of inactiveKeywords) {
		if (lowerContent.includes(keyword)) {
			return true;
		}
	}

	// Check for phrases indicating past tense
	const pastTensePhrases = [
		"was a member",
		"were members",
		"used to be",
		"previously in",
		"formerly in",
	];
	if (pastTensePhrases.some((phrase) => lowerContent.includes(phrase))) {
		return true;
	}

	// Check for disbandment dates
	const disbandmentPattern = /disbanded\s+(?:on|in)\s+(\d{4})/i;
	if (disbandmentPattern.test(lowerContent)) {
		return true;
	}

	// Check specific DOM elements for status
	const relevantContent = [
		'.data-grid .equal:contains("Status:")',
		'.data-grid .equal:contains("Current state:")',
		'.group-info:contains("disbanded")',
		'.profile-info:contains("former")',
		'.member-status:contains("inactive")',
	].join(" ");

	// Assume active if no inactive indicators found
	return false;
}
function normalizeDate(debutText: string): string | null {
	if (!debutText) return null;

	// Clean up the input text
	const cleaned = debutText
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[．。､、]/g, ".")
		.replace(/[／/]/g, "-");

	// Try to parse the date using the existing extractDateFromText function
	const date = extractDateFromText(cleaned);
	if (date) return date;

	// If no date could be parsed, return null
	return null;
}
