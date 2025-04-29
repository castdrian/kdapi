// Types for K-pop idols and groups

/**
 * Core information that can be reliably extracted
 */
interface CoreProfile {
	id: string;           // Generated UUID
	name: string;         // Main name
	imageUrl?: string;    // Profile image URL
	description?: string; // Profile description/summary
	socialMedia?: {       // Social media links
		instagram?: string;
		twitter?: string;
		facebook?: string;
		youtube?: string;
		tiktok?: string;
	};
	facts?: string[];     // Verified facts
}

/**
 * Represents a K-pop idol
 */
export interface Idol extends CoreProfile {
	// Basic information
	stageName?: string;
	birthName?: string;
	koreanName?: string;
	nicknames?: string[];

	// Personal details
	birthDate?: string;
	birthplace?: {
		city?: string;
		country?: string;
	};
	nationality?: string;

	// Physical attributes
	height?: string;
	weight?: string;
	bloodType?: string;

	// Career information
	agency?: string;
	position?: string;
	positions?: string[];
	groups?: {
		name: string;
		status: 'current' | 'former';
		position?: string;
	}[];

	// Additional details
	mbti?: string;
	education?: string;
	debut?: {
		date?: string;
		group?: string;
	};
}

/**
 * Represents a K-pop group
 */
export interface Group extends CoreProfile {
	// Basic information
	koreanName?: string;
	alternateNames?: string[];

	// Formation details
	formation?: {
		debutDate?: string;
		company?: string;
		status?: 'active' | 'disbanded' | 'hiatus';
	};

	// Member information
	memberHistory: {
		currentMembers?: {
			name: string;
			position?: string;
			joinDate?: string;
		}[];
		formerMembers?: {
			name: string;
			position?: string;
			joinDate?: string;
			departureDate?: string;
			reason?: string;
		}[];
	};

	// Fandom information
	fandom?: {
		name?: string;
		color?: string;
	};

	// Discography highlights
	discography?: {
		title: string;
		releaseDate?: string;
		type?: 'album' | 'single' | 'ep';
	}[];
}

/**
 * Complete dataset
 */
export interface DataSet {
	femaleIdols: Idol[];
	maleIdols: Idol[];
	girlGroups: Group[];
	boyGroups: Group[];
	coedGroups: Group[];

	// Metadata
	lastUpdated?: string;
	totalCount?: {
		femaleIdols: number;
		maleIdols: number;
		girlGroups: number;
		boyGroups: number;
		coedGroups: number;
		total: number;
	};
}