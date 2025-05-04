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
		{ name: "groupInfo.names.stage", weight: 10 },
		{ name: "groupInfo.names.korean", weight: 3 },
		{ name: "groupInfo.names.japanese", weight: 2 },
		{ name: "groupInfo.names.chinese", weight: 2 },
		{ name: "groupInfo.fandomName", weight: 0.5 },
		{ name: "company.current", weight: 0.3 },
		{ name: "memberHistory.currentMembers.name", weight: 0.2 },
	],
	includeScore: true,
	threshold: 0.3,
	ignoreLocation: true,
	minMatchCharLength: 2,
	shouldSort: true,
};

const idolSearchOptions: IFuseOptions<Idol> = {
	keys: [
		{ name: "names.stage", weight: 2 },
		{ name: "names.full", weight: 2 },
		{ name: "names.native", weight: 2 },
		{ name: "names.korean", weight: 2 },
		{ name: "names.japanese", weight: 1.5 },
		{ name: "names.chinese", weight: 1.5 },
		{ name: "groups.name", weight: 1 },
	],
	includeScore: true,
	threshold: 0.3,
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

	// Split query into words for better matching
	const words = query.toLowerCase().trim().split(/\s+/);
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

		// Filter results that match all words
		results = firstWordResults.filter((result) => {
			const textToSearch =
				result.type === "group"
					? [
							(result.item as Group).groupInfo.names.stage,
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
				textToSearch.some((text) => text?.toLowerCase().includes(word)),
			);
		});
	} else {
		const normalizedQuery = query.toLowerCase().trim();

		// First check for exact group matches if we're not specifically searching for idols
		if (type !== "idol") {
			const exactGroupMatches = [
				...dataset.girlGroups,
				...dataset.boyGroups,
				...dataset.coedGroups,
			]
				.filter(
					(group) =>
						group.groupInfo.names.stage?.toLowerCase() === normalizedQuery,
				)
				.map((group) => ({
					item: group,
					type: "group" as const,
					score: 0, // Give exact matches the highest priority
				}));

			if (exactGroupMatches.length > 0) {
				results.push(...exactGroupMatches);

				// If we only want groups, return here
				if (type === "group") {
					return exactGroupMatches.slice(0, limit);
				}
			}
		}

		// If no exact matches or we want all results, proceed with fuzzy search
		if (type === "all" || type === "group") {
			const groupResults = groupSearcherInstance.search(query);
			results.push(
				...groupResults
					.filter(
						(result) =>
							// Exclude exact matches we already added
							result.item.groupInfo.names.stage?.toLowerCase() !==
							normalizedQuery,
					)
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
					score: result.score || 1,
				})),
			);
		}

		// Sort results by score (lower is better)
		results = results.sort((a, b) => (a.score || 1) - (b.score || 1));
	}

	// Remove duplicates
	const uniqueResults = results.filter(
		(result, index, self) =>
			index === self.findIndex((r) => r.item.id === result.item.id),
	);

	return uniqueResults.slice(0, limit);
}

export type { Idol, Group, DataSet, GroupsData, IdolsData };