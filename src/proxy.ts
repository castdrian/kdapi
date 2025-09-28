import { fetch } from "undici";

export interface ProxyConfig {
	host: string;
	port: number;
	protocol: "http" | "socks4" | "socks5";
}

export class ProxyManager {
	private proxies: ProxyConfig[] = [];
	private currentIndex = 0;
	private failedProxies = new Set<string>();
	
	private readonly PROXY_LISTS = {
		http: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
		socks4: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt",
		socks5: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
	};

	async initialize(): Promise<void> {
		console.log("[PROXY] Initializing proxy manager...");
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
				console.warn("[PROXY] No proxies loaded, will use direct connection");
				return;
			}

			// Shuffle proxies for random selection
			this.shuffleProxies();
			console.log(`[PROXY] Loaded ${this.proxies.length} proxies`);
		} catch (error) {
			console.warn("[PROXY] Failed to initialize proxies, continuing with direct connection:", error);
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
			console.warn(`[PROXY] Failed to fetch ${type} proxies:`, error);
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

	getCurrentProxy(): ProxyConfig | null {
		if (this.proxies.length === 0) {
			return null;
		}

		// Find next working proxy
		const startIndex = this.currentIndex;
		do {
			const proxy = this.proxies[this.currentIndex];
			if (!proxy) {
				this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
				continue;
			}
			
			const proxyKey = `${proxy.host}:${proxy.port}`;
			
			if (!this.failedProxies.has(proxyKey)) {
				return proxy;
			}

			this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
		} while (this.currentIndex !== startIndex);

		return null; // All proxies have failed
	}

	markProxyAsFailed(proxy: ProxyConfig): void {
		const proxyKey = `${proxy.host}:${proxy.port}`;
		this.failedProxies.add(proxyKey);
		console.log(`[PROXY] Marked proxy as failed: ${proxyKey}`);
		
		// Move to next proxy
		this.rotateProxy();
	}

	rotateProxy(): void {
		this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
	}

	getWorkingProxyCount(): number {
		return this.proxies.length - this.failedProxies.size;
	}

	hasWorkingProxies(): boolean {
		return this.getWorkingProxyCount() > 0;
	}

	reset(): void {
		this.failedProxies.clear();
		this.currentIndex = 0;
		this.shuffleProxies();
		console.log("[PROXY] Reset failed proxies list");
	}
}