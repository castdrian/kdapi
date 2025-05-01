// Types for K-pop idols and groups

//---------------------------
// Enums for better type safety
//---------------------------

export enum IdolStatus {
	Active = 'active',
	Inactive = 'inactive',
	Hiatus = 'hiatus'
}

export enum GroupStatus {
	Active = 'active',
	Disbanded = 'disbanded',
	Hiatus = 'hiatus',
	Inactive = 'inactive',
	SubUnit = 'sub-unit'
}

export enum BloodType {
	A = 'A',
	B = 'B',
	O = 'O',
	AB = 'AB',
	APlus = 'A+',
	AMinus = 'A-',
	BPlus = 'B+',
	BMinus = 'B-',
	OPlus = 'O+',
	OMinus = 'O-',
	ABPlus = 'AB+',
	ABMinus = 'AB-'
}

export enum Position {
	Leader = 'Leader',
	MainVocalist = 'Main Vocalist',
	LeadVocalist = 'Lead Vocalist',
	Vocalist = 'Vocalist',
	MainRapper = 'Main Rapper',
	LeadRapper = 'Lead Rapper',
	Rapper = 'Rapper',
	MainDancer = 'Main Dancer',
	LeadDancer = 'Lead Dancer',
	Dancer = 'Dancer',
	Visual = 'Visual',
	Center = 'Center',
	FaceOfGroup = 'Face of the Group',
	Maknae = 'Maknae'
}

//---------------------------
// Shared base types
//---------------------------

export interface CoreProfile {
	id: string;
	profileUrl: string;
	imageUrl: string | null;
	names: {
		stage: string;
		korean: string | null;
		japanese: string | null;
		chinese: string | null;
		english: string | null;
		birth: {
			latin: string | null;
			hangeul: string | null;
			japanese: string | null;
			chinese: string | null;
		};
	};
	active: boolean;
	status: 'active' | 'inactive' | 'disbanded' | 'hiatus';
	company: {
		current: string | null;
		history: Array<{
			name: string;
			period: {
				start: string;
				end?: string;
			} | null;
		}>;
	} | null;
	socialMedia: SocialMedia;
	facts: Fact[];
}

//---------------------------
// Additional types
//---------------------------

export interface Fact {
	category?: 'personal' | 'career' | 'trivia' | 'pre-debut' | 'controversy';
	content: string;
	source?: string;
	date?: string;
}

export interface PhysicalInfo {
	height?: number;
	weight?: number;
	bloodType?: BloodType;
	birthDate?: string;
	zodiacSign?: string;
	mbti?: string;
	measurements?: {
		bust?: number;
		waist?: number;
		hips?: number;
	};
	dominantHand?: 'left' | 'right' | 'ambidextrous';
}

export interface PersonalInfo {
	nationality?: string;
	birthplace?: {
		city?: string;
		region?: string;
		country?: string;
	};
	religion?: string;
	education?: Array<{
		school: string;
		type?: 'elementary' | 'middle' | 'high school' | 'university' | 'college';
		status?: 'graduated' | 'attending' | 'dropped out';
		major?: string;
		year?: string;
	}>;
	family?: Array<{
		relation: string;
		name?: string;
		occupation?: string;
		description?: string;
	}>;
	languages?: Array<{
		language: string;
		level?: 'native' | 'fluent' | 'intermediate' | 'basic';
	}>;
	hobbies?: string[];
	specialties?: string[];
	nicknames?: string[];
}

export interface CareerInfo {
	debutDate?: string;
	activeYears?: Array<{
		start: string;
		end?: string;
	}>;
	trainingPeriod?: {
		duration?: string;
		start?: string;
		end?: string;
		company?: string;
	};
	predebut?: {
		company?: string;
		group?: string;
		period?: {
			start: string;
			end: string;
		};
	}[];
	showAppearances?: Array<{
		name: string;
		type?: 'survival' | 'variety' | 'drama' | 'musical' | 'radio' | 'web';
		role?: string;
		year?: string;
		episode?: string;
		result?: string;
	}>;
	awards?: Array<{
		name: string;
		category?: string;
		year: string;
		result?: 'won' | 'nominated';
	}>;
}

//---------------------------
// Idol-specific types
//---------------------------

export interface Idol extends CoreProfile {
	physicalInfo?: {
		height?: number;
		weight?: number;
		bloodType?: 'A' | 'B' | 'AB' | 'O';
		mbti?: string;
		birthDate?: string;
		zodiacSign?: string;
	};
	personalInfo?: {
		nationality?: string;
		birthplace?: {
			city: string;
			region?: string;
			country: string;
		};
		education?: Array<{
			school: string;
			type?: 'university' | 'high school' | 'middle' | 'elementary';
			status?: 'graduated' | 'attending' | 'dropped out';
		}>;
		languages?: Array<{
			language: string;
			level?: 'native' | 'fluent' | 'intermediate' | 'basic';
		}>;
		hobbies?: string[];
		specialties?: string[];
	};
	careerInfo?: {
		debutDate?: string;
		trainingPeriod?: {
			duration?: string;
			start?: string;
			end?: string;
		};
		showAppearances?: Array<{
			name: string;
			year?: string;
			type?: 'survival' | 'variety' | 'drama' | 'musical' | 'radio' | 'web';
		}>;
	};
	groups?: Array<{
		name: string;
		status: 'current' | 'former';
		period?: {
			start: string;
			end?: string;
		};
		position?: Position[];
	}>;
}

//---------------------------
// Group-specific types
//---------------------------

export interface Group extends CoreProfile {
	type: 'boy' | 'girl' | 'coed';
	memberCount: {
		current: number;
		peak: number;
	};
	memberHistory: {
		currentMembers: Array<{
			name: string;
			profileUrl?: string;
			position?: Position[];
			period?: {
				start: string;
				end?: string;
			};
		}>;
		formerMembers?: Array<{
			name: string;
			profileUrl?: string;
			position?: Position[];
			period?: {
				start: string;
				end?: string;
			};
		}>;
	};
	groupInfo?: {
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
	};
	fandom?: {
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
	};
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