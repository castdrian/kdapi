import type { Idol, Group, DataSet, GroupsData, IdolsData } from "@src/types";
import groups from "@root/data/groups.json" assert { type: "json" };
import idols from "@root/data/idols.json" assert { type: "json" };
import Fuse, { type IFuseOptions } from "fuse.js";

const dataset: DataSet = {
	femaleIdols: (idols as IdolsData).femaleIdols,
	maleIdols: (idols as IdolsData).maleIdols,
	girlGroups: (groups as GroupsData).girlGroups,
	boyGroups: (groups as GroupsData).boyGroups,
	coedGroups: (groups as GroupsData).coedGroups,
};

const groupSearchOptions: IFuseOptions<Group> = {
	keys: [
		{ name: "groupInfo.names.stage", weight: 8 },
		{ name: "groupInfo.names.korean", weight: 6 },
		{ name: "groupInfo.names.japanese", weight: 3 },
		{ name: "groupInfo.names.chinese", weight: 3 },
		{ name: "groupInfo.fandomName", weight: 1 },
		{ name: "company.current", weight: 0.5 },
	],
	includeScore: true,
	threshold: 0.4,
	ignoreLocation: true,
	minMatchCharLength: 2,
	shouldSort: true,
};

const idolSearchOptions: IFuseOptions<Idol> = {
	keys: [
		{ name: "names.stage", weight: 2 },
		{ name: "names.full", weight: 2 },
		{ name: "names.native", weight: 1.5 },
		{ name: "names.korean", weight: 1.5 },
		{ name: "names.japanese", weight: 1 },
		{ name: "names.chinese", weight: 1 },
		{ name: "groups.name", weight: 0.5 },
	],
	includeScore: true,
	threshold: 0.4,
	ignoreLocation: true,
	minMatchCharLength: 2,
};

// Initialize searchers
const groupSearcher = new Fuse(
	[...dataset.girlGroups, ...dataset.boyGroups, ...dataset.coedGroups],
	groupSearchOptions,
);

const idolSearcher = new Fuse(
	[...dataset.femaleIdols, ...dataset.maleIdols],
	idolSearchOptions,
);

export function search(
	query: string,
	options: {
		type?: "idol" | "group" | "all";
		limit?: number;
		threshold?: number;
	} = {},
) {
	const { type = "all", limit = 10, threshold } = options;
	let results: {
		item: Idol | Group;
		type: "idol" | "group";
		score?: number;
	}[] = [];

	const normalizedQuery = query.toLowerCase().trim();
	const words = normalizedQuery.split(/\s+/);
	const hasMultipleWords = words.length > 1;

	// If threshold is provided, create new searchers with updated options
	const groupSearcherInstance =
		threshold !== undefined
			? new Fuse(
					[...dataset.girlGroups, ...dataset.boyGroups, ...dataset.coedGroups],
					{
						...groupSearchOptions,
						threshold,
					},
				)
			: groupSearcher;

	const idolSearcherInstance =
		threshold !== undefined
			? new Fuse([...dataset.femaleIdols, ...dataset.maleIdols], {
					...idolSearchOptions,
					threshold,
				})
			: idolSearcher;

	if (hasMultipleWords) {
		// Split search into individual words
		const [firstWord, ...restWords] = words;

		// Search for the first word
		const firstWordResults = firstWord ? search(firstWord, { limit: 50 }) : [];

		// Filter results that contain all words
		results = firstWordResults.filter((result) => {
			const searchStrings =
				result.type === "group"
					? [
							(result.item as Group).groupInfo.names.stage,
							(result.item as Group).groupInfo.names.korean,
							...((result.item as Group).memberHistory?.currentMembers?.map(
								(m) => m.name,
							) || []),
						]
					: [
							(result.item as Idol).names.stage,
							(result.item as Idol).names.full,
							...((result.item as Idol).groups?.map((g) => g.name) || []),
						];

			return restWords.every((word) =>
				searchStrings.some((text) => text?.toLowerCase().includes(word)),
			);
		});
	} else {
		// First check for exact group matches if we're not specifically searching for idols
		if (type !== "idol") {
			const allGroups = [
				...dataset.girlGroups,
				...dataset.boyGroups,
				...dataset.coedGroups,
			];

			// Check for exact matches and close matches
			const normalizedQueryWithoutSpaces = normalizedQuery.replace(/\s+/g, "");
			const exactMatches = allGroups.filter((group) => {
				const stageNameNoSpaces =
					group.groupInfo.names.stage?.toLowerCase().replace(/\s+/g, "") || "";
				const koreanNameNoSpaces =
					group.groupInfo.names.korean?.toLowerCase().replace(/\s+/g, "") || "";
				return (
					stageNameNoSpaces === normalizedQueryWithoutSpaces ||
					koreanNameNoSpaces === normalizedQueryWithoutSpaces
				);
			});

			if (exactMatches.length > 0) {
				results.push(
					...exactMatches.map((group) => ({
						item: group,
						type: "group" as const,
						score: -1, // Give exact matches highest priority with negative score
					})),
				);

				if (type === "group") {
					return results.slice(0, limit);
				}
			}
		}

		// If no exact matches or we want all results, proceed with fuzzy search
		if (type === "all" || type === "group") {
			const groupResults = groupSearcherInstance.search(query);
			results.push(
				...groupResults
					.filter((result) => {
						const stageNameNoSpaces =
							result.item.groupInfo.names.stage
								?.toLowerCase()
								.replace(/\s+/g, "") || "";
						const koreanNameNoSpaces =
							result.item.groupInfo.names.korean
								?.toLowerCase()
								.replace(/\s+/g, "") || "";
						const queryNoSpaces = normalizedQuery.replace(/\s+/g, "");
						return (
							stageNameNoSpaces !== queryNoSpaces &&
							koreanNameNoSpaces !== queryNoSpaces
						);
					})
					.map((result) => ({
						item: result.item,
						type: "group" as const,
						score: result.score || 1,
					})),
			);
		}

		if (type === "all" || type === "idol") {
			const idolResults = idolSearcherInstance.search(query);
			results.push(
				...idolResults.map((result) => ({
					item: result.item,
					type: "idol" as const,
					score: (result.score || 1) * 2, // Reduce idol priority by doubling their scores
				})),
			);
		}
	}

	// Sort results by score (lower is better)
	results = results.sort((a, b) => (a.score || 1) - (b.score || 1));

	// Remove duplicates
	const uniqueResults = results.filter(
		(result, index, self) =>
			index === self.findIndex((r) => r.item.id === result.item.id),
	);

	return uniqueResults.slice(0, limit);
}

export function getItemById(id: string): Idol | Group | undefined {
	return [
		...dataset.girlGroups,
		...dataset.boyGroups,
		...dataset.coedGroups,
		...dataset.femaleIdols,
		...dataset.maleIdols,
	].find((item) => item.id === id);
}

export type { Idol, Group, DataSet, GroupsData, IdolsData };
