import * as readline from "node:readline";
import { stdout } from "node:process";

export type LogLevel = "info" | "warn" | "error" | "success";

type SessionMode = "production" | "debug" | "analysis";

type ScraperConfig = {
	batchSize: number;
	delayBetweenBatches: number;
	useCache: boolean;
	forceRefresh: boolean;
	offline: boolean;
	sampleSize?: number;
	concurrency?: number;
	proxyPoolSize?: number;
};

type CategoryState = {
	label: string;
	total: number;
	processed: number;
	successes: number;
	failures: number;
	startedAt: number;
};

type GlobalState = {
	total: number;
	processed: number;
	successes: number;
	failures: number;
	startedAt: number;
};

type LogEntry = {
	level: LogLevel;
	message: string;
	timestamp: number;
};

type ProxyState = {
	host: string;
	port: number;
	protocol: string;
	cooldownSeconds?: number;
};

type SessionState = {
	mode: SessionMode;
	config: ScraperConfig;
	category?: CategoryState;
	global: GlobalState;
	currentUrl?: string;
	currentProxy?: ProxyState | null;
	lastRender: number;
	logs: LogEntry[];
};

const COLORS: Record<LogLevel | "accent" | "muted" | "reset", string> = {
	info: "\x1b[36m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
	success: "\x1b[32m",
	accent: "\x1b[35m",
	muted: "\x1b[90m",
	reset: "\x1b[0m",
};

function formatDuration(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
		return "--:--";
	}
	const seconds = Math.floor(totalSeconds % 60)
		.toString()
		.padStart(2, "0");
	const minutesTotal = Math.floor(totalSeconds / 60);
	const minutes = Math.floor(minutesTotal % 60)
		.toString()
		.padStart(2, "0");
	const hours = Math.floor(minutesTotal / 60)
		.toString()
		.padStart(2, "0");
	return `${hours}:${minutes}:${seconds}`;
}

function sanitizeText(value?: string | null): string {
	if (!value) return "";
	return value.replace(/\s+/g, " ").trim();
}

export class ScraperUI {
	private readonly interactive: boolean;
	private active = false;
	private session: SessionState | null = null;
	private refreshTimer: NodeJS.Timeout | null = null;

	constructor() {
		this.interactive = Boolean(stdout.isTTY) && !process.env.CI;
	}

	startSession(mode: SessionMode, config: ScraperConfig): void {
		this.session = {
			mode,
			config,
			global: {
				total: 0,
				processed: 0,
				successes: 0,
				failures: 0,
				startedAt: Date.now(),
			},
			logs: [],
			lastRender: 0,
		};

		if (!this.interactive) {
			this.active = false;
			return;
		}

		this.active = true;
		this.render(true);
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
		}
		this.refreshTimer = setInterval(() => this.render(), 250);
	}

	stop(message?: string): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}

		if (this.active) {
			this.render(true);
			readline.cursorTo(stdout, 0, 0);
			readline.clearScreenDown(stdout);
		}

		this.active = false;
		if (message) {
			this.writeToConsole("info", message);
		}
	}

	isActive(): boolean {
		return this.active;
	}

	setCategory(label: string, total: number): void {
		if (!this.session) return;
		this.session.category = {
			label,
			total,
			processed: 0,
			successes: 0,
			failures: 0,
			startedAt: Date.now(),
		};
		this.session.global.total += total;
		this.render(true);
	}

	updateCategoryTotals(delta: number): void {
		if (!this.session) return;
		this.session.global.total += delta;
		if (this.session.category) {
			this.session.category.total += delta;
		}
		this.render();
	}

	setCurrentUrl(url: string | null): void {
		if (!this.session) return;
		this.session.currentUrl = url ?? undefined;
	}

	setCurrentProxy(state: ProxyState | null): void {
		if (!this.session) return;
		this.session.currentProxy = state;
	}

	incrementProgress(result: { success?: boolean; failure?: boolean }): void {
		if (!this.session) return;
		const { global } = this.session;
		const category = this.session.category;

		const delta = (result.success ? 1 : 0) + (result.failure ? 1 : 0);
		if (delta === 0) return;

		global.processed += delta;
		if (result.success) global.successes += 1;
		if (result.failure) global.failures += 1;

		if (category) {
			category.processed += delta;
			if (result.success) category.successes += 1;
			if (result.failure) category.failures += 1;
		}

		this.render();
	}

	addLog(level: LogLevel, message: string): void {
		if (!this.session) {
			this.writeToConsole(level, message);
			return;
		}

		const entry: LogEntry = {
			level,
			message: sanitizeText(message),
			timestamp: Date.now(),
		};

		if (!this.active) {
			this.writeToConsole(level, entry.message);
			return;
		}

		this.session.logs.push(entry);
		if (this.session.logs.length > 5) {
			this.session.logs.shift();
		}
		this.render();
	}

	flushLogs(): void {
		if (!this.session) return;
		if (!this.active) return;
		for (const entry of this.session.logs) {
			this.writeToConsole(entry.level, entry.message);
		}
	}

	private writeToConsole(level: LogLevel, message: string): void {
		const levelLabel = level.toUpperCase().padEnd(7, " ");
		const color = COLORS[level];
		const reset = COLORS.reset;
		stdout.write(`${color}[${levelLabel}]${reset} ${message}\n`);
	}

	private render(force = false): void {
		if (!this.active || !this.session) return;
		const now = Date.now();
		if (!force && now - this.session.lastRender < 120) {
			return;
		}
		this.session.lastRender = now;

		readline.cursorTo(stdout, 0, 0);
		readline.clearScreenDown(stdout);

		const { config, mode, global, category, logs, currentUrl, currentProxy } =
			this.session;

		const elapsedSeconds = (now - global.startedAt) / 1000;
		const processed = Math.max(global.processed, 0);
		const total = Math.max(global.total, processed);
		const progress = total === 0 ? 0 : processed / total;
		const etaSeconds = processed
			? ((total - processed) * (elapsedSeconds / processed))
			: 0;

		const header = `${COLORS.accent}KDAPI Scraper${COLORS.reset}`;
		const modeLabel = mode === "production" ? "Production" : "Debug";
		const progressBar = this.progressBar(progress, 40);
		const eta = formatDuration(etaSeconds);
		const elapsed = formatDuration(elapsedSeconds);
		const successRate = processed
			? `${((1 - global.failures / processed) * 100).toFixed(1)}%`
			: "100%";

		stdout.write(`${header}  ${COLORS.muted}${modeLabel} mode${COLORS.reset}\n`);
		stdout.write(`${progressBar}  ${processed}/${total}  ETA ${eta}  Elapsed ${elapsed}  Success ${successRate}\n`);

		const configParts = [
			`batch x${config.batchSize}`,
			`delay ${config.delayBetweenBatches}ms`,
			`cache ${config.useCache ? "on" : "off"}`,
			`offline ${config.offline ? "yes" : "no"}`,
			`force ${config.forceRefresh ? "yes" : "no"}`,
		];
		if (config.concurrency) configParts.push(`concurrency ${config.concurrency}`);
		if (config.sampleSize) configParts.push(`sample ${config.sampleSize}`);
		if (config.proxyPoolSize) configParts.push(`proxies ${config.proxyPoolSize}`);
		stdout.write(`${COLORS.muted}${configParts.join("  ")}${COLORS.reset}\n`);

		if (category) {
			const catProgress = category.total
				? category.processed / category.total
				: 0;
			const catBar = this.progressBar(catProgress, 40);
			const catEtaSeconds = category.processed
				? ((category.total - category.processed) *
						((now - category.startedAt) /
							category.processed)) /
					1000
				: 0;
			stdout.write(
				`${category.label.padEnd(24, " ")} ${catBar}  ${category.processed}/${category.total}  ETA ${formatDuration(catEtaSeconds)}\n`,
			);
		}

		if (currentUrl) {
			const displayUrl = currentUrl.length > 90
				? `${currentUrl.slice(0, 87)}...`
				: currentUrl;
			stdout.write(
				`${COLORS.muted}Active URL:${COLORS.reset} ${displayUrl}\n`,
			);
		}

		if (currentProxy) {
			const proxyLabel = `${currentProxy.protocol}://${currentProxy.host}:${currentProxy.port}`;
			const proxyLine = currentProxy.cooldownSeconds
				? `${proxyLabel} (cooldown ${currentProxy.cooldownSeconds}s)`
				: proxyLabel;
			stdout.write(
				`${COLORS.muted}Proxy:${COLORS.reset} ${proxyLine}\n`,
			);
		}

		if (logs.length > 0) {
			stdout.write(`${COLORS.muted}Recent events:${COLORS.reset}\n`);
			for (const entry of logs.slice(-5)) {
				const color = COLORS[entry.level];
				const levelLabel = entry.level.toUpperCase().padEnd(7, " ");
				stdout.write(`${color}[${levelLabel}]${COLORS.reset} ${entry.message}\n`);
			}
		}
	}

	private progressBar(progress: number, width: number): string {
		const clamped = Math.max(0, Math.min(progress, 1));
		const filled = Math.round(clamped * width);
		const bar = `${COLORS.success}${"█".repeat(filled)}${COLORS.muted}${"░".repeat(
			width - filled,
		)}${COLORS.reset}`;
		return `[${bar}] ${(clamped * 100).toFixed(1)}%`;
	}
}

export const scraperUI = new ScraperUI();
