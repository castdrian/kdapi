// Types for K-pop idols and groups

//---------------------------
// Enums and Types for better type safety
//---------------------------

export enum Status {
	Active = "active",
	Inactive = "inactive",
}

export enum GroupType {
	Girl = "girl",
	Boy = "boy",
	Coed = "coed",
}

export enum BloodType {
	A = "A",
	B = "B",
	AB = "AB",
	O = "O",
	Unknown = "Unknown",
}

//---------------------------
// Shared base types
//---------------------------

export interface SocialMedia {
	facebook?: string;
	twitter?: string;
	instagram?: string;
	youtube?: string;
	tiktok?: string;
	spotify?: string;
	website?: string;
	fancafe?: string;
	weibo?: string;
	vlive?: string;
}

export interface Company {
	current: string | null;
	history: Array<{
		name: string;
		period: {
			start: string;
			end?: string;
		};
	}>;
}

export interface IdolNames {
	stage: string | null;
	full: string | null;
	native: string | null;
	korean: string | null;
	japanese: string | null;
	chinese: string | null;
}

export interface GroupNames {
	stage: string | null;
	korean: string | null;
	japanese: string | null;
	chinese: string | null;
}

export interface CoreProfile {
	id: string;
	profileUrl: string;
	imageUrl: string | null;
	active: boolean;
	status: Status;
	company: {
		current: string | null;
		history: Array<{
			name: string;
			period: {
				start: string;
				end?: string;
			};
		}>;
	} | null;
	socialMedia: SocialMedia;
}

//---------------------------
// Additional types
//---------------------------

export interface PhysicalInfo {
	birthDate?: string; // ISO 8601 format
	zodiacSign?: string;
	height?: number;
	weight?: number;
	bloodType?: BloodType;
}

export interface PersonalInfo {
	mbti?: string;
}

export interface CareerInfo {
	debutDate?: string;
	activeYears?: {
		start: string;
		end?: string;
	}[];
}

//---------------------------
// Group Member Type
//---------------------------

export interface GroupMember {
	name: string;
	profileUrl: string;
	id?: string; // ID of the idol
}

//---------------------------
// Idol-specific types
//---------------------------

export interface GroupActivity {
	name: string;
	id?: string; // ID of the group
	status: "current" | "former";
	period?: {
		start: string;
		end?: string;
	};
}

export interface Idol extends CoreProfile {
	names: IdolNames; // Override with idol-specific names
	description?: string;
	personalInfo?: PersonalInfo;
	physicalInfo?: PhysicalInfo;
	careerInfo?: CareerInfo;
	groups?: GroupActivity[];
	country?: {
		name: string;
		code: string;
	};
}

//---------------------------
// Group-specific types
//---------------------------

export interface GroupInfo {
	debutDate: string | null;
	disbandmentDate: string | null;
	names: GroupNames;
	fandomName: string | null;
}

export interface MemberHistory {
	currentMembers: GroupMember[];
	formerMembers?: GroupMember[];
}

export interface Group {
	id: string;
	type: GroupType;
	profileUrl: string;
	imageUrl: string;
	active: boolean;
	status: Status;
	company: Company | null;
	socialMedia?: SocialMedia;
	memberHistory: MemberHistory;
	groupInfo: GroupInfo;
}

//---------------------------
// Dataset type
//---------------------------

export interface GroupsData {
	girlGroups: Group[];
	boyGroups: Group[];
	coedGroups: Group[];
}

export interface IdolsData {
	femaleIdols: Idol[];
	maleIdols: Idol[];
}

export interface DataSet extends GroupsData {
	femaleIdols: Idol[];
	maleIdols: Idol[];
}
