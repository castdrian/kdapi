#!/usr/bin/env bun
import { Command } from "commander";
import { runDebugMode, runProductionMode } from "./scraper";
import * as fs from "node:fs";
import * as path from "node:path";
import pkg from "../package.json";

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
	.option("--cache", "Use cached HTML files", true)
	.option("--force", "Force refresh all profiles", false)
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

		if (options.debug) {
			await runDebugMode({
				sampleSize: Number.parseInt(options.sample),
				randomSamples: true,
				batchSize: Number.parseInt(options.batchSize),
				delayBetweenBatches: Number.parseInt(options.delay),
				useCache: options.cache,
			});
		} else {
			await runProductionMode({
				batchSize: Number.parseInt(options.batchSize),
				delayBetweenBatches: Number.parseInt(options.delay),
				useCache: options.cache,
				forceRefresh: options.force,
			});
		}
	});

program.parse();
