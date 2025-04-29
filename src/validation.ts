import { BloodType, CoreProfile, Idol, Group, ValidationResult, ValidationError } from './types';

export function validateProfile(profile: CoreProfile): ValidationResult {
	const errors: ValidationError[] = [];

	// Validate names
	if (!profile.names.stage) {
		errors.push({
			path: 'names.stage',
			message: 'Stage name is required',
			value: profile.names.stage
		});
	}

	// Validate blood type
	if (profile.physicalInfo?.bloodType) {
		if (!isValidBloodType(profile.physicalInfo.bloodType)) {
			errors.push({
				path: 'physicalInfo.bloodType',
				message: 'Invalid blood type format',
				value: profile.physicalInfo.bloodType
			});
		}
	}

	// Validate MBTI
	if (profile.physicalInfo?.mbti) {
		if (!isValidMBTI(profile.physicalInfo.mbti)) {
			errors.push({
				path: 'physicalInfo.mbti',
				message: 'Invalid MBTI format',
				value: profile.physicalInfo.mbti
			});
		}
	}

	// Validate dates
	if (profile.physicalInfo?.birthDate) {
		if (!isValidDate(profile.physicalInfo.birthDate)) {
			errors.push({
				path: 'physicalInfo.birthDate',
				message: 'Invalid date format',
				value: profile.physicalInfo.birthDate
			});
		}
	}

	// Validate URLs
	if (profile.socialMedia) {
		Object.entries(profile.socialMedia).forEach(([platform, url]) => {
			if (url && !isValidUrl(url)) {
				errors.push({
					path: `socialMedia.${platform}`,
					message: 'Invalid URL format',
					value: url
				});
			}
		});
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

function isValidBloodType(type: string): type is BloodType {
	return /^(A|B|O|AB)[+-]?$/.test(type);
}

function isValidMBTI(mbti: string): boolean {
	return /^[IE][NS][FT][JP](-[AT])?$/.test(mbti);
}

function isValidDate(date: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

function isValidUrl(url: string): boolean {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}
