import fs from 'node:fs';
import path from 'path';
import crypto from 'crypto';

export class CacheManager {
	private cacheDir: string;

	constructor() {
		this.cacheDir = path.join(process.cwd(),'cache');
		this.ensureCacheDir();
	}

	private ensureCacheDir() {
		const dirs = ['idols', 'groups'].map(d => path.join(this.cacheDir, d));
		dirs.forEach(dir => {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		});
	}

	public getKey(url: string): string {
		return crypto.createHash('md5').update(url).digest('hex');
	}

	public getPath(type: 'idol' | 'group', key: string): string {
		return path.join(this.cacheDir, `${type}s`, `${key}.html`);
	}

	public async get(type: 'idol' | 'group', url: string): Promise<string | null> {
		const key = this.getKey(url);
		const cachePath = this.getPath(type, key);

		try {
			if (fs.existsSync(cachePath)) {
				return fs.readFileSync(cachePath, 'utf-8');
			}
		} catch (e) {
			console.warn(`Cache read error for ${url}:`, e);
		}
		return null;
	}

	public async set(type: 'idol' | 'group', url: string, html: string): Promise<void> {
		const key = this.getKey(url);
		const cachePath = this.getPath(type, key);

		try {
			fs.writeFileSync(cachePath, html);
		} catch (e) {
			console.warn(`Cache write error for ${url}:`, e);
		}
	}

	public exists(type: 'idol' | 'group', url: string): boolean {
		return fs.existsSync(this.getPath(type, this.getKey(url)));
	}
}
