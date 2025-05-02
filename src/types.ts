// Types for K-pop idols and groups

//---------------------------
// Enums for better type safety
//---------------------------

export enum IdolStatus {
	Active = "active",
	Inactive = "inactive",
}

export enum GroupStatus {
	Active = "active",
	Inactive = "inactive",
}

export enum BloodType {
	A = "A",
	B = "B",
	O = "O",
	AB = "AB",
}

export enum Position {
	Leader = "leader",
	MainVocalist = "main vocalist",
	LeadVocalist = "lead vocalist",
	Vocalist = "vocalist",
	MainRapper = "main rapper",
	LeadRapper = "lead rapper",
	Rapper = "rapper",
	MainDancer = "main dancer",
	LeadDancer = "lead dancer",
	Dancer = "dancer",
	Visual = "visual",
	Center = "center",
	FaceOfGroup = "face of group",
	Maknae = "maknae",
}

export enum GroupType {
	Girl = "girl",
	Boy = "boy",
	Coed = "coed",
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

export interface CompanyHistory {
	name: string;
	period: {
		start: string;
		end?: string;
	};
}

export interface Company {
	current: string | null;
	history: CompanyHistory[];
}

export interface Names {
	stage: string;
	korean: string | null;
	japanese: string | null;
	chinese: string | null;
}

export interface CoreProfile {
	id: string;
	profileUrl: string;
	imageUrl: string | null;
	active: boolean;
	status: IdolStatus | GroupStatus;
	company: Company | null;
	socialMedia?: SocialMedia;
	names: Names;
}

//---------------------------
// Additional types
//---------------------------

export interface PhysicalInfo {
	birthDate?: string;
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
	position?: Position[];
	period?: {
		start: string;
		end?: string;
	};
}

//---------------------------
// Idol-specific types
//---------------------------

export interface GroupActivity {
	name: string;
	status: "current" | "former";
	period?: {
		start: string;
		end?: string;
	};
}

export interface Idol extends CoreProfile {
	personalInfo?: PersonalInfo;
	physicalInfo?: PhysicalInfo;
	careerInfo?: CareerInfo;
	groups?: GroupActivity[];
}

//---------------------------
// Group-specific types
//---------------------------

export interface GroupInfo {
	debutDate?: string;
	disbandmentDate?: string;
}

export interface Group extends CoreProfile {
	type: GroupType;
	memberHistory: {
		currentMembers: GroupMember[];
		formerMembers: GroupMember[];
	};
	groupInfo?: GroupInfo;
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
