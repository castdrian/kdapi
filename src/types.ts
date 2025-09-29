// Types for K-pop idols and groups

//---------------------------
// Enums and Types for better type safety
//---------------------------

export enum BloodType {
	A = "A",
	B = "B",
	O = "O",
	AB = "AB",
}

export enum Status {
	Active = "active",
	Inactive = "inactive",
}

export enum GroupType {
	Girl = "girl",
	Boy = "boy",
	Coed = "coed",
}

//---------------------------
// Shared base types
//---------------------------

export type SocialMedia = {
	instagram?: string;
	twitter?: string;
	facebook?: string;
	youtube?: string;
	spotify?: string;
	weibo?: string;
	tiktok?: string;
	vlive?: string;
	fancafe?: string;
	website?: string;
};

export type AttributeField = {
	label: string;
	value: string;
	context?: string;
};

export type EntityStats = {
	wins?: number;
	pictures?: number;
	videos?: number;
	albums?: number;
	views?: number;
	favorites?: number;
};

export type FandomInfo = {
	name?: string | null;
	colors?: string[];
	lightstick?: string | null;
};

export type Period = {
	start: string;
	end?: string;
};

export type CompanyInfo = {
	current: string | null;
	history: Array<{
		name: string;
		period: Period;
	}>;
};

export type IdolNames = {
	stage: string;
	korean: string | null;
	japanese: string | null;
	chinese: string | null;
	full: string | null;
	native: string | null;
};

export type GroupNames = {
	stage: string | null;
	korean: string | null;
	japanese: string | null;
	chinese: string | null;
};

//---------------------------
// Additional types
//---------------------------

export type GroupInfo = {
	debutDate: string | null;
	disbandmentDate: string | null;
	names: GroupNames;
	fandomName: string | null;
};

export type GroupMember = {
	id?: string;
	name: string;
	profileUrl: string;
};

export type MemberHistory = {
	currentMembers: GroupMember[];
	formerMembers: GroupMember[];
};

export type GroupActivity = {
	id?: string;
	name: string;
	status: "current" | "former";
	period?: Period;
};

export type PersonalInfo = {
	mbti?: string;
};

export type PhysicalInfo = {
	birthDate?: string;
	bloodType?: BloodType;
	heightCm?: number;
	weightKg?: number;
};

export type CareerInfo = {
	debutDate?: string;
	activeYears: Period[];
};

export type IdolProfile = {
	positions?: string[];
	representativeColors?: string[];
	languages?: string[];
	education?: string[];
	nicknames?: string[];
	trainingPeriod?: string | null;
	debutToFirstWin?: string[];
	rankings?: string[];
	categories?: string[];
	zodiacSign?: string | null;
};

//---------------------------
// Idol-specific types
//---------------------------

export interface Idol {
	id: string;
	profileUrl: string;
	imageUrl: string | null;
	active: boolean;
	status: Status;
	company: CompanyInfo | null;
	socialMedia?: SocialMedia;
	names: IdolNames;
	description?: string;
	country?: {
		name: string;
		code: string;
	};
	physicalInfo?: PhysicalInfo;
	personalInfo?: PersonalInfo;
	careerInfo?: CareerInfo;
	groups?: GroupActivity[];
	stats?: EntityStats;
	profile?: IdolProfile;
	fandom?: FandomInfo;
	tags?: string[];
	extraFields?: AttributeField[];
}

//---------------------------
// Group-specific types
//---------------------------

export interface Group {
	id: string;
	type: GroupType;
	profileUrl: string;
	imageUrl: string;
	active: boolean;
	status: Status;
	company: CompanyInfo | null;
	socialMedia?: SocialMedia;
	memberHistory: MemberHistory;
	groupInfo: GroupInfo;
	stats?: EntityStats;
	fandom?: FandomInfo;
	country?: {
		name: string;
		code?: string;
	};
	profile?: GroupProfile;
	tags?: string[];
	extraFields?: AttributeField[];
}

export type GroupProfile = {
	mainGroup?: string | null;
	subgroups?: string[];
	representativeColors?: string[];
	mostPopularMember?: string | null;
	debutToFirstWin?: string | null;
	aliases?: string[];
};

//---------------------------
// Dataset type
//---------------------------

export type DataSet = {
	femaleIdols: Idol[];
	maleIdols: Idol[];
	girlGroups: Group[];
	boyGroups: Group[];
	coedGroups: Group[];
};

//---------------------------
// Search-related types
//---------------------------

export type SearchResult = {
	type: "idol" | "group";
	item: Idol | Group;
	score: number;
};

export type SearchOptions = {
	type?: "idol" | "group";
	limit?: number;
	threshold?: number;
};

export type GroupsData = {
	girlGroups: Group[];
	boyGroups: Group[];
	coedGroups: Group[];
};

export type IdolsData = {
	femaleIdols: Idol[];
	maleIdols: Idol[];
};
