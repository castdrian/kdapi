#!/usr/bin/env bun
import { Command } from 'commander';
import { runDebugMode, runProductionMode, retryFailedUrls } from './scraper';
import * as fs from 'node:fs';
import * as path from 'node:path';
import pkg from '../package.json';

const program = new Command();

program
	.name('kdapi')
	.description('K-pop Data API and Dataset Generator CLI')
	.version(pkg.version);

program.command('scrape')
	.description('Scrape K-pop idol and group profiles')
	.option('-d, --debug', 'Run in debug mode with limited samples', false)
	.option('-s, --sample <number>', 'Number of samples per category in debug mode', '5')
	.option('-r, --random', 'Randomly select profiles for debug mode', false)
	.option('-c, --categories <categories...>', 'Specific categories to scrape (femaleIdols, maleIdols, girlGroups, boyGroups, coedGroups)')
	.option('--retry', 'Retry previously failed URLs', false)
	.option('--batch-size <number>', 'Number of concurrent requests', '5')
	.option('--delay <number>', 'Delay between batches in milliseconds', '1000')
	.action(async (options) => {
		const { debug, sample, random, categories, retry, batchSize, delay } = options;

		if (retry) {
			const failedUrlsPath = path.join(process.cwd(), 'data', 'failed_urls.json');
			if (!fs.existsSync(failedUrlsPath)) {
				console.error('No failed URLs file found. Run a scrape first.');
				process.exit(1);
			}
			await retryFailedUrls({
				batchSize: parseInt(batchSize),
				delayBetweenBatches: parseInt(delay)
			});
		} else if (debug) {
			await runDebugMode({
				sampleSize: parseInt(sample),
				randomSamples: random,
				categories,
				batchSize: parseInt(batchSize),
				delayBetweenBatches: parseInt(delay)
			});
		} else {
			await runProductionMode({
				batchSize: parseInt(batchSize),
				delayBetweenBatches: parseInt(delay)
			});
		}
	});

program.parse();