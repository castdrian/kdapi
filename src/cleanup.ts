import { Idol, Group, DataSet } from './types';
import { validateProfile } from './validation';

export function cleanupDataset(dataset: DataSet): DataSet {
	return {
		femaleIdols: dataset.femaleIdols.map(cleanupIdol),
		maleIdols: dataset.maleIdols.map(cleanupIdol),
		girlGroups: dataset.girlGroups.map(cleanupGroup),
		boyGroups: dataset.boyGroups.map(cleanupGroup),
		coedGroups: dataset.coedGroups.map(cleanupGroup)
	};
}

function cleanupIdol(idol: Idol): Idol {
	// Remove empty strings
	if (idol.names.korean === '') idol.names.korean = null;
	if (idol.company?.current === '') idol.company.current = null;

	// Normalize arrays
	idol.names.aliases = idol.names.aliases?.filter(Boolean) || [];

	// Validate and cleanup social media URLs
	if (idol.socialMedia) {
		Object.entries(idol.socialMedia).forEach(([platform, url]) => {
			if (!url || typeof url !== 'string') {
				delete idol.socialMedia![platform];
			}
		});

		if (Object.keys(idol.socialMedia).length === 0) {
			idol.socialMedia = null;
		}
	}

	// Validate profile
	const validation = validateProfile(idol);
	if (!validation.valid) {
		console.warn(`Validation errors for idol ${idol.names.stage}:`, validation.errors);
	}

	return idol;
}

// ... similar cleanup for groups ...
