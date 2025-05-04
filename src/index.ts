import type { Idol, Group, DataSet, GroupsData, IdolsData } from "@src/types";
import groups from "@root/data/groups.json" assert { type: "json" };
import idols from "@root/data/idols.json" assert { type: "json" };
import * as fuzzySearchLib from "@m31coding/fuzzy-search";

const dataset: DataSet = {
	femaleIdols: (idols as IdolsData).femaleIdols,
	maleIdols: (idols as IdolsData).maleIdols,
	girlGroups: (groups as GroupsData).girlGroups,
	boyGroups: (groups as GroupsData).boyGroups,
	coedGroups: (groups as GroupsData).coedGroups,
};

// Configure searcher to handle all character types (for Korean, Japanese, Chinese characters)
const config = fuzzySearchLib.Config.createDefaultConfig();
config.normalizerConfig.allowCharacter = (_c: string) => true;

// Create separate searchers for idols and groups for better performance
const idolSearcher = fuzzySearchLib.SearcherFactory.createSearcher<
	Idol,
	string
>(config);
const groupSearcher = fuzzySearchLib.SearcherFactory.createSearcher<
	Group,
	string
>(config);

// Index the idols and groups
idolSearcher.indexEntities(
	[...dataset.femaleIdols, ...dataset.maleIdols],
	(entity) => entity.id,
	(entity) =>
		[
			entity.names.stage,
			entity.names.full,
			entity.names.native,
			entity.names.korean,
			entity.names.japanese,
			entity.names.chinese,
			// Add group names to search terms
			...(entity.groups
				?.flatMap((g) => [
					g.name, // Group name by itself
					`${entity.names.stage} ${g.name}`, // "Name Group"
					`${g.name} ${entity.names.stage}`, // "Group Name"
				]) || []),
		].filter((name): name is string => name !== null),
);

groupSearcher.indexEntities(
	[...dataset.girlGroups, ...dataset.boyGroups, ...dataset.coedGroups],
	(entity) => entity.id,
	(entity) =>
		[
			entity.groupInfo.names.stage,
			entity.groupInfo.names.korean,
			entity.groupInfo.names.japanese,
			entity.groupInfo.names.chinese,
			entity.groupInfo.fandomName,
			entity.company?.current,
			...(entity.company?.history.map((h) => h.name) || []),
			...entity.memberHistory.currentMembers.map((m) => m.name),
			...(entity.memberHistory.formerMembers?.map((m) => m.name) || []),
		].filter((name): name is string => name !== null),
);

/**
 * Search across both idols and groups with improved accuracy
 */
export function search(
	query: string,
	options: {
		type?: "idol" | "group" | "all";
		limit?: number;
		threshold?: number;
	} = {},
) {
	const { type = "all", limit = 10, threshold = 0.4 } = options;
	const results: { item: Idol | Group; type: "idol" | "group" }[] = [];

	const searchQuery = new fuzzySearchLib.Query(query, limit, threshold);

	if (type === "all" || type === "idol") {
		const idolResults = idolSearcher.getMatches(searchQuery);
		results.push(
			...idolResults.matches.map((match) => ({
				item: match.entity,
				type: "idol" as const,
			})),
		);
	}

	if (type === "all" || type === "group") {
		const groupResults = groupSearcher.getMatches(searchQuery);
		results.push(
			...groupResults.matches.map((match) => ({
				item: match.entity,
				type: "group" as const,
			})),
		);
	}

	return results;
}

/**
 * Get a specific idol or group by ID
 */
export function getItemById(
	id: string,
): { item: Idol | Group; type: "idol" | "group" } | null {
	// Search idols
	const idol = [...dataset.femaleIdols, ...dataset.maleIdols].find(
		(i) => i.id === id,
	);
	if (idol) return { item: idol, type: "idol" };

	// Search groups
	const group = [
		...dataset.girlGroups,
		...dataset.boyGroups,
		...dataset.coedGroups,
	].find((g) => g.id === id);
	if (group) return { item: group, type: "group" };

	return null;
}

// Export types for external use
export type {
	Idol,
	DataSet,
	GroupType,
	Company,
	SocialMedia,
	GroupNames,
	GroupInfo,
	MemberHistory,
	Group,
	GroupsData,
} from "@src/types";
