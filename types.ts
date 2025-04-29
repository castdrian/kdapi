// Types for K-pop idols and groups

//---------------------------
// Base shared types
//---------------------------

/**
 * Core information shared by all profiles
 */
export interface CoreProfile {
	id: string;                  // Generated UUID
	name: string;                // Main name
	description?: string;        // Profile description/summary
	imageUrl?: string;          // Profile image URL
	profileUrl: string;         // URL to the profile page
	koreanName?: string;        // Korean name in Hangul
	alternateNames?: string[];  // Other names or spellings
	agency?: string;           // Entertainment agency
	socialMedia?: {            // Official social media links
		instagram?: string;
		twitter?: string;
		facebook?: string;
		youtube?: string;
		tiktok?: string;
		weibo?: string;        // Common for K-pop in China
		melon?: string;        // Korean music streaming
		spotify?: string;      // Global music streaming
	};
	facts?: string[];          // Verified facts
}

//---------------------------
// Idol-specific types
//---------------------------

export type BloodType = 'A' | 'B' | 'O' | 'AB' | 'A+' | 'A-' | 'B+' | 'B-' | 'O+' | 'O-' | 'AB+' | 'AB-';
export type IdolPosition = 'Leader' | 'Main Vocalist' | 'Lead Vocalist' | 'Vocalist' | 'Main Rapper' | 'Lead Rapper' | 'Rapper' | 'Main Dancer' | 'Lead Dancer' | 'Dancer' | 'Visual' | 'Center' | 'Face of the Group' | 'Maknae';

export interface IdolCareer {
	groupName: string;
	status: 'current' | 'former' | 'solo';
	position?: IdolPosition[];
	joinDate?: string;
	departureDate?: string;
	reason?: string;
}

/**
 * Represents a K-pop idol's profile
 */
export interface Idol extends CoreProfile {
	// Name variations
	stageName?: string;        // Stage name if different from main name
	birthName?: string;        // Birth name
	nicknames?: string[];      // Known nicknames

	// Personal details
	birthDate?: string;        // ISO date string
	zodiacSign?: string;       // Western zodiac
	chineseZodiac?: string;   // Chinese zodiac
	birthplace?: {
		city?: string;
		region?: string;
		country?: string;
	};
	nationality?: string;
	hometown?: string;

	// Physical attributes
	height?: number;           // In centimeters
	weight?: number;           // In kilograms
	bloodType?: BloodType;

	// Career information
	active?: boolean;          // Currently active in industry
	debutDate?: string;        // ISO date string
	groups?: IdolCareer[];     // Group affiliations
	soloDebut?: {             // Solo career info
		date: string;
		song?: string;
		album?: string;
	};

	// Additional details
	education?: string[];      // Educational background
	languages?: string[];      // Languages spoken
	mbti?: string;            // MBTI personality type
	pets?: string[];          // Pet names/types
	skills?: string[];        // Notable skills
	hobbies?: string[];       // Known hobbies
	specialties?: string[];   // Special talents
}

//---------------------------
// Group-specific types
//---------------------------

export type GroupStatus = 'active' | 'disbanded' | 'hiatus' | 'inactive' | 'sub-unit';
export type GroupType = 'boy' | 'girl' | 'co-ed' | 'soloist';

export interface GroupMember {
	name: string;
	stageName?: string;
	position?: IdolPosition[];
	joinDate?: string;
	departureDate?: string;
	birthDate?: string;
	nationality?: string;
	profileUrl?: string;
}

export interface Fandom {
	name: string;
	meaning?: string;
	color?: string;          // Hex color or name
	establishmentDate?: string;
}

/**
 * Represents a K-pop group's profile
 */
export interface Group extends CoreProfile {
	// Basic information
	type: GroupType;
	status: GroupStatus;
	debutDate: string;        // ISO date string
	disbandDate?: string;     // ISO date string for disbanded groups

	// Member information
	memberCount: {
		current: number;
		peak?: number;
		debut?: number;
	};
	memberHistory: {
		currentMembers: GroupMember[];
		formerMembers?: GroupMember[];
	};

	// Fandom details
	fandom?: Fandom;

	// Company details
	company: {
		current: string;
		previous?: string[];
	};

	// Career milestones
	debut: {
		date: string;
		song: string;
		album?: string;
	};
	firstWin?: {             // First music show win
		date: string;
		show: string;
		song: string;
	};

	// Additional information
	subunits?: {
		name: string;
		members: string[];
		debutDate?: string;
	}[];
	generation?: number;     // K-pop generation (1-5)
	originProgram?: string;  // If from a survival show
}

//---------------------------
// Dataset type
//---------------------------

/**
 * Complete dataset structure
 */
export interface DataSet {
	femaleIdols: Idol[];
	maleIdols: Idol[];
	girlGroups: Group[];
	boyGroups: Group[];
	coedGroups: Group[];
	metadata: {
		lastUpdated: string;
		version: string;
		totalCount: {
			femaleIdols: number;
			maleIdols: number;
			girlGroups: number;
			boyGroups: number;
			coedGroups: number;
			total: number;
		};
		coverage: {
			startDate: string;    // Earliest profile date
			endDate: string;      // Latest profile date
		};
	};
}