// Types for K-pop idols and groups

//---------------------------
// Shared base types
//---------------------------

export interface CoreProfile {
	id: string;
	profileUrl: string;
	imageUrl?: string;
	description?: string;

	names: {
		stage: string; // Main display name
		korean: string | null; // Changed from optional to nullable
		birth?: {
			latin: string | null; // Changed from optional to nullable
			hangeul: string | null; // Changed from optional to nullable
		};
		aliases: string[]; // Changed from optional to required empty array
	};

	active: boolean;
	status: 'active' | 'inactive' | 'hiatus';

	company: {
		current: string | null; // Changed from optional to nullable
		history: Array<{
			name: string;
			period: {
				start: string;
				end: string | null;
			} | null;
		}>;
	} | null;

	socialMedia: {
		instagram?: string | null;
		twitter?: string | null;
		facebook?: string | null;
		youtube?: string | null;
		spotify?: string | null;
		weibo?: string | null;
		tiktok?: string | null;
		vlive?: string | null;
		fancafe?: string | null;
		website?: string | null;
	} | null;

	facts?: string[];
}

//---------------------------
// Idol-specific types
//---------------------------

export type BloodType = 'A' | 'B' | 'O' | 'AB' | 'A+' | 'A-' | 'B+' | 'B-' | 'O+' | 'O-' | 'AB+' | 'AB-';
export type IdolPosition = 'Leader' | 'Main Vocalist' | 'Lead Vocalist' | 'Vocalist' | 'Main Rapper' | 'Lead Rapper' | 'Rapper' | 'Main Dancer' | 'Lead Dancer' | 'Dancer' | 'Visual' | 'Center' | 'Face of the Group' | 'Maknae';

export interface PhysicalInfo {
	height: number | null; // Changed from optional to nullable
	weight: number | null; // Changed from optional to nullable
	bloodType: BloodType | null; // Changed from optional to nullable
	birthDate: string | null; // ISO format YYYY-MM-DD
	zodiacSign: string | null;
	mbti: string | null; // Stricter MBTI format validation
}

export interface PersonalInfo {
	nationality?: string;
	birthplace?: {
		city?: string;
		region?: string;
		country?: string;
	};
	education?: Array<{
		school: string;
		type?: string;
		status?: 'graduated' | 'attending' | 'dropped out';
		year?: string;
	}>;
	languages?: string[];
	hobbies?: string[];
	specialties?: string[];
}

export interface CareerInfo {
	debutDate?: string;
	activeYears?: Array<{
		start: string;
		end?: string;
	}>;
	trainingPeriod?: {
		start?: string;
		end?: string;
		duration?: string;
	};
	showAppearances?: Array<{
		name: string;
		type?: 'survival' | 'variety' | 'drama' | 'musical';
		role?: string;
		year?: string;
	}>;
}

export interface GroupHistory {
	groupName: string;
	position?: IdolPosition[];
	status: 'current' | 'former';
	period?: {
		start: string;
		end?: string;
	};
}

export interface Idol extends CoreProfile {
	physicalInfo?: PhysicalInfo;
	personalInfo?: PersonalInfo;
	careerInfo?: CareerInfo;
	groups?: GroupHistory[];
}

//---------------------------
// Group-specific types
//---------------------------

export type GroupStatus = 'active' | 'disbanded' | 'hiatus' | 'inactive' | 'sub-unit';
export type GroupType = 'boy' | 'girl' | 'coed';

export interface GroupMember {
	name: string;
	profileUrl?: string;
	position?: IdolPosition[];
	period?: {
		start: string;
		end?: string;
	};
}

export interface Fandom {
	name: string | null;
	color: string | null; // Hex color code
	lightstick: {
		name: string | null;
		imageUrl: string | null;
		description: string | null;
		version: string | null; // Added version number tracking
		releaseDate?: string | null; // ISO format YYYY-MM-DD
	} | null;
	fanCafe?: {
		name: string | null;
		url: string | null;
	} | null;
}

export interface GroupInfo {
	debutDate?: string;
	debutSong?: string;
	activeYears?: Array<{
		start: string;
		end?: string;
	}>;
	generation?: number;
	subunits?: Array<{
		name: string;
		members: string[];
		status: 'active' | 'disbanded';
	}>;
}

export interface Group extends CoreProfile {
	type: GroupType;
	memberCount: {
		current: number;
		peak: number;
	};
	memberHistory: {
		currentMembers: GroupMember[];
		formerMembers?: GroupMember[];
	};
	groupInfo?: GroupInfo;
	fandom?: Fandom;
}

//---------------------------
// Dataset type
//---------------------------

export interface DataSet {
	femaleIdols: Idol[];
	maleIdols: Idol[];
	girlGroups: Group[];
	boyGroups: Group[];
	coedGroups: Group[];
}

//---------------------------
// Validation types
//---------------------------

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

export interface ValidationError {
	path: string;
	message: string;
	value: any;
}