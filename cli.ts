#!/usr/bin/env bun
import { Command } from 'commander';
import { runDebugMode, runProductionMode } from '@/scraper';
import { version } from '@/package.json';

const program = new Command();

program
	.name('kdapi')
	.description('K-pop Data API and Dataset Generator CLI')
	.version(version);

program
	.command('scrape')
	.description('Scrape K-pop idol and group profiles')
	.option('-d, --debug', 'Run in debug mode with limited samples', false)
	.option('-s, --sample <number>', 'Number of samples per category in debug mode', '3')
	.option('-e, --exclude <names...>', 'Names to exclude from scraping')
	.action(async (options) => {
		const { debug, sample, exclude } = options;
		if (debug) {
			await runDebugMode({
				sampleSize: parseInt(sample),
				excludeProfiles: exclude || []
			});
		} else {
			await runProductionMode();
		}
	});

program.parse();