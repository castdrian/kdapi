import type {
	Idol, Group, DataSet, BloodType,
	IdolPosition, GroupStatus, GroupType,
	GroupMember, Fandom, PhysicalInfo,
	PersonalInfo, CareerInfo
} from './types';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Dataset paths
const DATA_DIR = path.join(process.cwd(), 'data');
const IDOLS_PATH = path.join(DATA_DIR, 'idols.json');
const GROUPS_PATH = path.join(DATA_DIR, 'groups.json');

// Load and parse datasets
function loadDatasets(): DataSet {
	try {
		// Load idols data
		const idolsData = JSON.parse(fs.readFileSync(PATHS.IDOLS_FILE, 'utf-8'));

		// Load groups data
		const groupsData = JSON.parse(fs.readFileSync(PATHS.GROUPS_FILE, 'utf-8'));

		// Validate and return combined dataset
		const dataset: DataSet = {
			femaleIdols: validateArray(idolsData.femaleIdols),
			maleIdols: validateArray(idolsData.maleIdols),
			girlGroups: validateArray(groupsData.girlGroups),
			boyGroups: validateArray(groupsData.boyGroups),
			coedGroups: validateArray(groupsData.coedGroups)
		};

		return dataset;
	} catch (error) {
		throw new Error('Dataset not found or invalid. Run `kdapi scrape` to generate the dataset first.');
	}
}

// Type validation helpers
function validateArray<T>(arr: T[]): T[] {
	if (!Array.isArray(arr)) return [];
	return arr.filter(item => item && typeof item === 'object');
}

// Basic dataset access functions
export function getFemaleIdols(): Idol[] {
	return loadDatasets().femaleIdols;
}

export function getMaleIdols(): Idol[] {
	return loadDatasets().maleIdols;
}

export function getGirlGroups(): Group[] {
	return loadDatasets().girlGroups;
}

export function getBoyGroups(): Group[] {
	return loadDatasets().boyGroups;
}

export function getCoedGroups(): Group[] {
	return loadDatasets().coedGroups;
}

// Advanced search functions
type IdolQuery = string | ((idol: Idol) => boolean);
type GroupQuery = string | ((group: Group) => boolean);

export function searchIdols(query: IdolQuery): Idol[] {
	const dataset = loadDatasets();
	const allIdols = [...dataset.femaleIdols, ...dataset.maleIdols];

	if (typeof query === 'string') {
		const normalizedQuery = query.toLowerCase();
		return allIdols.filter(idol => {
			// Search in all name fields
			if (idol.names.stage.toLowerCase().includes(normalizedQuery)) return true;
			if (idol.names.korean?.toLowerCase().includes(normalizedQuery)) return true;
			if (idol.names.birth?.latin?.toLowerCase().includes(normalizedQuery)) return true;
			if (idol.names.birth?.hangeul?.toLowerCase().includes(normalizedQuery)) return true;
			if (idol.names.aliases?.some(alias => alias.toLowerCase().includes(normalizedQuery))) return true;

			// Search in groups
			if (idol.groups?.some(g => g.groupName.toLowerCase().includes(normalizedQuery))) return true;

			// Search in company
			if (idol.company?.current?.toLowerCase().includes(normalizedQuery)) return true;
			if (idol.company?.history?.some(h => h.name.toLowerCase().includes(normalizedQuery))) return true;

			return false;
		});
	}

	return allIdols.filter(query);
}

export function searchGroups(query: GroupQuery): Group[] {
	const dataset = loadDatasets();
	const allGroups = [...dataset.girlGroups, ...dataset.boyGroups, ...dataset.coedGroups];

	if (typeof query === 'string') {
		const normalizedQuery = query.toLowerCase();
		return allGroups.filter(group => {
			// Search in all name fields
			if (group.names.stage.toLowerCase().includes(normalizedQuery)) return true;
			if (group.names.korean?.toLowerCase().includes(normalizedQuery)) return true;
			if (group.names.aliases?.some(alias => alias.toLowerCase().includes(normalizedQuery))) return true;

			// Search in member names
			if (group.memberHistory.currentMembers.some(m => m.name.toLowerCase().includes(normalizedQuery))) return true;
			if (group.memberHistory.formerMembers?.some(m => m.name.toLowerCase().includes(normalizedQuery))) return true;

			// Search in fandom
			if (group.fandom?.name?.toLowerCase().includes(normalizedQuery)) return true;
			if (group.fandom?.lightstick?.name?.toLowerCase().includes(normalizedQuery)) return true;

			// Search in company
			if (group.company?.current?.toLowerCase().includes(normalizedQuery)) return true;
			if (group.company?.history?.some(h => h.name.toLowerCase().includes(normalizedQuery))) return true;

			return false;
		});
	}

	return allGroups.filter(query);
}

// Filter functions for idols
export function filterIdolsByGroup(groupName: string): Idol[] {
	return searchIdols(idol =>
		idol.groups?.some(g =>
			g.groupName.toLowerCase() === groupName.toLowerCase()
		)
	);
}

export function filterIdolsByCompany(companyName: string): Idol[] {
	return searchIdols(idol =>
		idol.company?.current?.toLowerCase() === companyName.toLowerCase() ||
		idol.company?.history?.some(h => h.name.toLowerCase() === companyName.toLowerCase())
	);
}

export function filterIdolsByGeneration(generation: number): Idol[] {
	const groupsByGeneration = searchGroups(group => group.groupInfo?.generation === generation);
	const groupNames = new Set(groupsByGeneration.map(g => g.names.stage.toLowerCase()));

	return searchIdols(idol =>
		idol.groups?.some(g => groupNames.has(g.groupName.toLowerCase()))
	);
}

export function filterIdolsByAge(minAge: number, maxAge?: number): Idol[] {
	const currentYear = new Date().getFullYear();
	return searchIdols(idol => {
		if (!idol.physicalInfo?.birthDate) return false;
		const birthYear = parseInt(idol.physicalInfo.birthDate.split('-')[0]);
		const age = currentYear - birthYear;
		return maxAge ? age >= minAge && age <= maxAge : age >= minAge;
	});
}

export function filterIdolsByPosition(position: IdolPosition): Idol[] {
	return searchIdols(idol =>
		idol.groups?.some(g => g.position?.includes(position))
	);
}

export function filterIdolsByBirthYear(year: number): Idol[] {
	return searchIdols(idol =>
		idol.physicalInfo?.birthDate?.startsWith(year.toString())
	);
}

export function filterIdolsByBloodType(type: BloodType): Idol[] {
	return searchIdols(idol =>
		idol.physicalInfo?.bloodType === type
	);
}

// Filter functions for groups
export function filterActiveGroups(): Group[] {
	return searchGroups(group => group.status === 'active');
}

export function filterDisbandedGroups(): Group[] {
	return searchGroups(group => group.status === 'disbanded');
}

export function filterGroupsByGeneration(generation: number): Group[] {
	return searchGroups(group => group.groupInfo?.generation === generation);
}

export function filterGroupsByCompany(companyName: string): Group[] {
	return searchGroups(group =>
		group.company?.current?.toLowerCase() === companyName.toLowerCase() ||
		group.company?.history?.some(h => h.name.toLowerCase() === companyName.toLowerCase())
	);
}

export function filterGroupsByMemberCount(count: number, exact = true): Group[] {
	return searchGroups(group =>
		exact ? group.memberCount.current === count :
			group.memberCount.current >= count
	);
}

// Utility functions for working with dates
export function getDebutDate(profile: Idol | Group): Date | undefined {
	const dateStr = 'careerInfo' in profile ?
		profile.careerInfo?.debutDate :
		profile.groupInfo?.debutDate;

	return dateStr ? new Date(dateStr) : undefined;
}

export function getActiveYears(profile: Idol | Group): number {
	const years = 'careerInfo' in profile ?
		profile.careerInfo?.activeYears :
		profile.groupInfo?.activeYears;

	if (!years?.[0]) return 0;

	const start = new Date(years[0].start);
	const end = years[0].end ? new Date(years[0].end) : new Date();
	return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365));
}

// Export types for external use
export type {
	Idol, Group, DataSet,
	BloodType, IdolPosition, GroupStatus, GroupType,
	GroupMember, Fandom, PhysicalInfo,
	PersonalInfo, CareerInfo
};