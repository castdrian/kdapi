import { fetch } from "undici";
import { logger } from "@src/logger";

export interface ProxyConfig {
	host: string;
	port: number;
	protocol: "http" | "socks4" | "socks5";
}

export class ProxyManager {
	private proxies: ProxyConfig[] = [];
	private currentIndex = 0;
	private failedProxies = new Set<string>();
	private proxyCooldowns = new Map<string, number>();
	private proxyFailureCounts = new Map<string, number>();
	
	private readonly PROXY_LISTS = {
		http: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
		socks4: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt",
		socks5: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
	};

	async initialize(): Promise<void> {
		logger.info("[PROXY] Initializing proxy manager");
		try {
			// Try to fetch proxies from all lists with timeout
			const proxyListPromises = [
				this.fetchProxyList("http"),
				this.fetchProxyList("socks4"),
				this.fetchProxyList("socks5"),
			].map(p => Promise.race([
				p,
				new Promise<ProxyConfig[]>((_, reject) => 
					setTimeout(() => reject(new Error("Timeout")), 30000)
				)
			]));

			const proxyLists = await Promise.allSettled(proxyListPromises);

			for (const result of proxyLists) {
				if (result.status === "fulfilled") {
					this.proxies.push(...result.value);
				}
			}

			if (this.proxies.length === 0) {
				logger.warn("[PROXY] No proxies loaded, will rely on direct connection");
				return;
			}

				// Shuffle proxies for random selection
				this.shuffleProxies();
				logger.info(`[PROXY] Loaded ${this.proxies.length} proxies`);
			} catch (error) {
				logger.warn(
					`[PROXY] Failed to initialize proxies, continuing with direct connection: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
	}

	private async fetchProxyList(type: keyof typeof this.PROXY_LISTS): Promise<ProxyConfig[]> {
		try {
			const response = await fetch(this.PROXY_LISTS[type], {
				headers: {
					"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const text = await response.text();
			const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
			
			return lines.map(line => {
				const parts = line.trim().split(':');
				if (parts.length >= 2 && parts[1]) {
					const host = parts[0];
					const port = parseInt(parts[1], 10);
					if (host && !isNaN(port)) {
						return {
							host,
							port,
							protocol: type as "http" | "socks4" | "socks5",
						};
					}
				}
				return null;
			}).filter((proxy): proxy is ProxyConfig => proxy !== null);
		} catch (error) {
			logger.warn(
				`[PROXY] Failed to fetch ${type} proxies: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	private shuffleProxies(): void {
		for (let i = this.proxies.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const temp = this.proxies[i];
			if (temp && this.proxies[j]) {
				this.proxies[i] = this.proxies[j];
				this.proxies[j] = temp;
			}
		}
	}

	private getProxyKey(proxy: ProxyConfig): string {
		return `${proxy.host}:${proxy.port}`;
	}

	private sameProxy(a: ProxyConfig, b: ProxyConfig): boolean {
		return a.host === b.host && a.port === b.port && a.protocol === b.protocol;
	}

	private moveProxyToEnd(proxy: ProxyConfig): void {
		if (this.proxies.length <= 1) {
			return;
		}

		const index = this.proxies.findIndex((p) => this.sameProxy(p, proxy));
		if (index === -1) {
			return;
		}

		const [entry] = this.proxies.splice(index, 1);
		if (!entry) {
			return;
		}
		this.proxies.push(entry);

		if (this.currentIndex > index) {
			this.currentIndex -= 1;
		}
		if (this.currentIndex >= this.proxies.length) {
			this.currentIndex = 0;
		}
	}

	getCurrentProxy(): ProxyConfig | null {
		if (this.proxies.length === 0) {
			return null;
		}

		const total = this.proxies.length;
		const now = Date.now();

		for (let offset = 0; offset < total; offset++) {
			const index = (this.currentIndex + offset) % total;
			const proxy = this.proxies[index];
			if (!proxy) {
				continue;
			}

			const proxyKey = this.getProxyKey(proxy);
			if (this.failedProxies.has(proxyKey)) {
				continue;
			}

			const cooldownUntil = this.proxyCooldowns.get(proxyKey);
			if (cooldownUntil) {
				if (cooldownUntil <= now) {
					this.proxyCooldowns.delete(proxyKey);
				} else {
					continue;
				}
			}

			this.currentIndex = index;
			return proxy;
		}

		return null;
	}

	markProxyAsFailed(proxy: ProxyConfig): void {
		if (this.proxies.length === 0) {
			return;
		}

		const proxyKey = this.getProxyKey(proxy);
		this.failedProxies.add(proxyKey);
		this.proxyCooldowns.delete(proxyKey);
		logger.warn(`[PROXY] Marked proxy as failed: ${proxyKey}`);
		this.moveProxyToEnd(proxy);
	}

	markProxyAsRateLimited(proxy: ProxyConfig, cooldownMs: number): number {
		return this.setProxyCooldown(proxy, cooldownMs, "rate limited");
	}

	markProxyAsTemporarilyFailed(proxy: ProxyConfig, cooldownMs: number): number {
		return this.setProxyCooldown(proxy, cooldownMs, "encountered an error");
	}

	markProxyAsSuccessful(proxy: ProxyConfig): void {
		const proxyKey = this.getProxyKey(proxy);
		this.proxyCooldowns.delete(proxyKey);
		this.proxyFailureCounts.delete(proxyKey);
		this.moveProxyToEnd(proxy);
	}

	private setProxyCooldown(
		proxy: ProxyConfig,
		cooldownMs: number,
		reason: string,
	): number {
		if (this.proxies.length === 0) {
			return 0;
		}

		const proxyKey = this.getProxyKey(proxy);
		const failures = (this.proxyFailureCounts.get(proxyKey) || 0) + 1;
		this.proxyFailureCounts.set(proxyKey, failures);
		const scaled = Math.min(Math.max(cooldownMs, 1000) * failures, 60000);
		this.proxyCooldowns.set(proxyKey, Date.now() + scaled);
		logger.warn(
			`[PROXY] Proxy ${proxyKey} ${reason}. Cooling down for ${Math.ceil(
				scaled / 1000,
			)}s (failures: ${failures})`,
		);
		this.moveProxyToEnd(proxy);
		return scaled;
	}

	getNextCooldownDuration(): number | null {
		if (this.proxyCooldowns.size === 0) {
			return null;
		}

		const now = Date.now();
		let soonest: number | null = null;

		for (const until of this.proxyCooldowns.values()) {
			const remaining = until - now;
			if (remaining <= 0) {
				continue;
			}
			if (soonest === null || remaining < soonest) {
				soonest = remaining;
			}
		}

		return soonest;
	}

	getWorkingProxyCount(): number {
		const now = Date.now();
		return this.proxies.reduce((count, proxy) => {
			const proxyKey = this.getProxyKey(proxy);
			if (this.failedProxies.has(proxyKey)) {
				return count;
			}
			const cooldownUntil = this.proxyCooldowns.get(proxyKey);
			if (cooldownUntil && cooldownUntil > now) {
				return count;
			}
			return count + 1;
		}, 0);
	}

	hasWorkingProxies(): boolean {
		return this.getWorkingProxyCount() > 0;
	}

	getPoolSize(): number {
		return this.proxies.length;
	}

	reset(): void {
		this.failedProxies.clear();
		this.proxyCooldowns.clear();
		this.proxyFailureCounts.clear();
		this.currentIndex = 0;
		this.shuffleProxies();
		logger.info("[PROXY] Reset failed proxies list");
	}
}
