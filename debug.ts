import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import type { Idol, Group } from './types';

const DATA_DIR = path.join(__dirname, 'data');
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');

interface ProfileAnalysis {
	availableFields: Set<string>;
	fieldPatterns: Map<string, RegExp>;
	commonSections: Set<string>;
	dataStructure: Record<string, any>;
}

async function analyzeExistingSamples() {
	console.log('🔍 Analyzing existing HTML samples...');

	const idolAnalysis: ProfileAnalysis = {
		availableFields: new Set(),
		fieldPatterns: new Map(),
		commonSections: new Set(),
		dataStructure: {}
	};

	const groupAnalysis: ProfileAnalysis = {
		availableFields: new Set(),
		fieldPatterns: new Map(),
		commonSections: new Set(),
		dataStructure: {}
	};

	// Read all HTML files from analysis directory
	const files = fs.readdirSync(ANALYSIS_DIR).filter(f => f.endsWith('_profile_raw.html'));

	for (const file of files) {
		const html = fs.readFileSync(path.join(ANALYSIS_DIR, file), 'utf-8');
		const $ = cheerio.load(html);
		const isGroup = file.includes('group');

		console.log(`\nAnalyzing ${file}...`);

		// Extract meta information
		const meta = extractMetaInfo($);
		Object.keys(meta).forEach(key => {
			if (isGroup) {
				groupAnalysis.availableFields.add(key);
			} else {
				idolAnalysis.availableFields.add(key);
			}
		});

		// Extract section headings
		$('h1, h2, h3, h4').each((_, el) => {
			const heading = $(el).text().trim().toLowerCase();
			if (isGroup) {
				groupAnalysis.commonSections.add(heading);
			} else {
				idolAnalysis.commonSections.add(heading);
			}
		});

		// Extract common data patterns
		const patterns = extractDataPatterns($);
		patterns.forEach((pattern, key) => {
			if (isGroup) {
				groupAnalysis.fieldPatterns.set(key, pattern);
			} else {
				idolAnalysis.fieldPatterns.set(key, pattern);
			}
		});

		// Build example data structure
		const data = extractStructuredData($, isGroup);
		if (isGroup) {
			mergeDataStructures(groupAnalysis.dataStructure, data);
		} else {
			mergeDataStructures(idolAnalysis.dataStructure, data);
		}
	}

	// Save analysis results
	fs.writeFileSync(
		path.join(DATA_DIR, 'idol_analysis.json'),
		JSON.stringify({
			availableFields: Array.from(idolAnalysis.availableFields),
			fieldPatterns: Object.fromEntries(idolAnalysis.fieldPatterns),
			commonSections: Array.from(idolAnalysis.commonSections),
			dataStructure: idolAnalysis.dataStructure
		}, null, 2)
	);

	fs.writeFileSync(
		path.join(DATA_DIR, 'group_analysis.json'),
		JSON.stringify({
			availableFields: Array.from(groupAnalysis.availableFields),
			fieldPatterns: Object.fromEntries(groupAnalysis.fieldPatterns),
			commonSections: Array.from(groupAnalysis.commonSections),
			dataStructure: groupAnalysis.dataStructure
		}, null, 2)
	);

	console.log('\n✅ Analysis complete! Check data/idol_analysis.json and data/group_analysis.json');

	// Compare with our types
	compareWithTypes(idolAnalysis, groupAnalysis);
}

function extractMetaInfo($: cheerio.CheerioAPI): Record<string, string> {
	const meta: Record<string, string> = {};

	// Extract meta tags
	$('meta').each((_, el) => {
		const property = $(el).attr('property');
		const content = $(el).attr('content');
		if (property && content) {
			meta[property] = content;
		}
	});

	// Extract schema.org data
	$('script[type="application/ld+json"]').each((_, el) => {
		try {
			const data = JSON.parse($(el).html() || '{}');
			if (data['@type'] === 'Person' || data['@type'] === 'Organization') {
				Object.assign(meta, {
					name: data.name,
					description: data.description,
					birthDate: data.birthDate,
					image: data.image
				});
			}
		} catch (e) { }
	});

	return meta;
}

function extractDataPatterns($: cheerio.CheerioAPI): Map<string, RegExp> {
	const patterns = new Map<string, RegExp>();

	// Look for common data patterns in text
	$('p, li, dt, dd').each((_, el) => {
		const text = $(el).text().trim();

		// Birthday pattern
		if (text.match(/(?:Birth(?:day|date)):\s*([^,\n]+)/i)) {
			patterns.set('birthday', /(?:Birth(?:day|date)):\s*([^,\n]+)/i);
		}

		// Height pattern
		if (text.match(/Height:\s*(\d+(?:\.\d+)?)\s*(?:cm|m)/i)) {
			patterns.set('height', /Height:\s*(\d+(?:\.\d+)?)\s*(?:cm|m)/i);
		}

		// Agency pattern
		if (text.match(/(?:Agency|Label|Company):\s*([^,\n]+)/i)) {
			patterns.set('agency', /(?:Agency|Label|Company):\s*([^,\n]+)/i);
		}
	});

	return patterns;
}

function extractStructuredData($: cheerio.CheerioAPI, isGroup: boolean): Record<string, any> {
	const data: Record<string, any> = {};

	// Basic info
	data.name = $('h1').first().text().trim();

	// Profile image
	const image = $('img').first().attr('src');
	if (image) data.imageUrl = image;

	// Social media links
	const socialMedia: Record<string, string> = {};
	$('a[href*="instagram.com"], a[href*="twitter.com"], a[href*="facebook.com"]').each((_, el) => {
		const href = $(el).attr('href');
		if (href) {
			if (href.includes('instagram.com')) socialMedia.instagram = href;
			else if (href.includes('twitter.com')) socialMedia.twitter = href;
			else if (href.includes('facebook.com')) socialMedia.facebook = href;
		}
	});
	if (Object.keys(socialMedia).length > 0) {
		data.socialMedia = socialMedia;
	}

	if (isGroup) {
		// Extract member list
		const members: string[] = [];
		$('.member-list li, .members li').each((_, el) => {
			const name = $(el).text().trim();
			if (name) members.push(name);
		});
		if (members.length > 0) {
			data.members = members;
		}
	} else {
		// Extract personal info
		$('dl dt').each((_, el) => {
			const key = $(el).text().trim().replace(':', '');
			const value = $(el).next('dd').text().trim();
			if (key && value) {
				data[key.toLowerCase().replace(/\s+/g, '_')] = value;
			}
		});
	}

	return data;
}

function mergeDataStructures(target: Record<string, any>, source: Record<string, any>) {
	for (const [key, value] of Object.entries(source)) {
		if (!(key in target)) {
			target[key] = value;
		} else if (typeof target[key] === 'object' && typeof value === 'object') {
			mergeDataStructures(target[key], value);
		}
	}
}

function compareWithTypes(idolAnalysis: ProfileAnalysis, groupAnalysis: ProfileAnalysis) {
	console.log('\n🔍 Comparing available data with defined types...');

	// Load type definitions
	const typeFile = fs.readFileSync(path.join(__dirname, 'types.ts'), 'utf-8');

	// Extract type properties
	const idolProps = new Set<string>();
	const groupProps = new Set<string>();

	const idolMatch = typeFile.match(/export interface Idol {([^}]+)}/s);
	if (idolMatch) {
		idolMatch[1].split('\n').forEach(line => {
			const prop = line.match(/^\s*(\w+)[\?:]?/);
			if (prop) idolProps.add(prop[1]);
		});
	}

	const groupMatch = typeFile.match(/export interface Group {([^}]+)}/s);
	if (groupMatch) {
		groupMatch[1].split('\n').forEach(line => {
			const prop = line.match(/^\s*(\w+)[\?:]?/);
			if (prop) groupProps.add(prop[1]);
		});
	}

	// Compare and report differences
	console.log('\nIdol Type Analysis:');
	console.log('Fields in type but not found in data:');
	Array.from(idolProps).forEach(prop => {
		if (!idolAnalysis.availableFields.has(prop)) {
			console.log(`- ${prop}`);
		}
	});

	console.log('\nFields in data but not in type:');
	Array.from(idolAnalysis.availableFields).forEach(field => {
		if (!idolProps.has(field)) {
			console.log(`- ${field}`);
		}
	});

	console.log('\nGroup Type Analysis:');
	console.log('Fields in type but not found in data:');
	Array.from(groupProps).forEach(prop => {
		if (!groupAnalysis.availableFields.has(prop)) {
			console.log(`- ${prop}`);
		}
	});

	console.log('\nFields in data but not in type:');
	Array.from(groupAnalysis.availableFields).forEach(field => {
		if (!groupProps.has(field)) {
			console.log(`- ${field}`);
		}
	});
}

// Run the analysis
analyzeExistingSamples().catch(error => {
	console.error('Error running analysis:', error);
});