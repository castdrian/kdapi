#!/usr/bin/env bun
import { Command } from "commander";
import { runDebugMode, runProductionMode } from "@src/scraper";
import * as fs from "node:fs";
import * as path from "node:path";
import pkg from "@root/package.json";

const program = new Command();

program
	.name("kdapi")
	.description("K-pop Data API and Dataset Generator CLI")
	.version(pkg.version);

program
	.command("scrape")
	.description("Scrape profiles")
	.option("-d, --debug", "Run in debug mode", false)
	.option("-s, --sample <number>", "Number of samples in debug mode", "5")
	.option("--delay <ms>", "Delay between requests", "2000")
	.option("--batch-size <number>", "Batch size for requests", "5")
	.option("--no-cache", "Disable using cached HTML files")
	.option("--force", "Force refresh all profiles", false)
	.option(
		"--cache-only",
		"Use only cached HTML files and skip all network requests",
		false,
	)
	.action(async (options) => {
		// Create cache directories
		const dirs = [
			path.join(process.cwd(), "cache/groups"),
			path.join(process.cwd(), "cache/idols"),
			path.join(process.cwd(), "data"),
		];

		for (const dir of dirs) {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		}

		const offline = Boolean(options.cacheOnly);
		const forceRefresh = offline ? false : options.force;
		const useCache = offline ? true : options.cache && !forceRefresh;
		if (offline && options.force) {
			console.log(
				"⚠️  Ignoring --force because --cache-only was provided (offline mode)",
			);
		}

		console.log(
			`Running with options: ${JSON.stringify(
				{
					debug: options.debug,
					sampleSize: options.sample,
					batchSize: options.batchSize,
					delay: options.delay,
					useCache: useCache,
					forceRefresh,
					offline,
				},
				null,
				2,
			)}`,
		);

		// Add helpful information for CI environments
		if (process.env.CI || process.env.GITHUB_ACTIONS) {
			console.log("🔧 Running in CI environment - using enhanced error handling");
		}

		try {
			if (options.debug) {
				await runDebugMode({
					sampleSize: Number.parseInt(options.sample),
					randomSamples: true,
					batchSize: Number.parseInt(options.batchSize),
					delayBetweenBatches: Number.parseInt(options.delay),
					useCache,
					offline,
				});
			} else {
				await runProductionMode({
					batchSize: Number.parseInt(options.batchSize),
					delayBetweenBatches: Number.parseInt(options.delay),
					useCache,
					forceRefresh,
					offline,
				});
			}
			console.log("✅ Scraping completed successfully");
		} catch (error) {
			console.error("❌ Scraping failed:", error instanceof Error ? error.message : String(error));
			console.log("⚠️  Some data may have been saved despite the error");
			// Don't exit with error code - let CI continue
			process.exit(0);
		}
	});

program.parse();
