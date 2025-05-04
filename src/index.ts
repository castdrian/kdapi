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
		{ name: "groupInfo.names.stage", weight: 2 },
		{ name: "groupInfo.names.korean", weight: 2 },
		{ name: "groupInfo.names.japanese", weight: 1.5 },
		{ name: "groupInfo.names.chinese", weight: 1.5 },
		{ name: "groupInfo.fandomName", weight: 0.7 },
		{ name: "company.current", weight: 0.3 },
		{ name: "memberHistory.currentMembers.name", weight: 1 },
	],
	includeScore: true,
	threshold: 0.3,
	ignoreLocation: true,
	minMatchCharLength: 2,
};

const idolSearchOptions: IFuseOptions<Idol> = {
	keys: [
		{ name: "names.stage", weight: 2 },
		{ name: "names.full", weight: 2 },
		{ name: "names.native", weight: 2 },
		{ name: "names.korean", weight: 2 },
		{ name: "names.japanese", weight: 1.5 },
		{ name: "names.chinese", weight: 1.5 },
		{
			name: "groups.name",
			weight: 1,
		},
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
	const results: { item: Idol | Group; type: "idol" | "group" }[] = [];

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
		const [firstWord, ...restWords] = words;
		if (!firstWord) return [];
		const restWordsStr = restWords.join(" ");

		// Search for idols matching the first word
		const potentialIdols = idolSearcherInstance.search(firstWord);

		// Add matches where idol belongs to the specified group
		for (const idolResult of potentialIdols) {
			const idol = idolResult.item;
			if (idol.groups?.some((g) => g.name.toLowerCase() === restWordsStr)) {
				results.push({
					item: idol,
					type: "idol",
				});
			}
		}

		// Try reverse order (group first, then idol name)
		const reversePotentialIdols = idolSearcherInstance.search(restWordsStr);
		for (const idolResult of reversePotentialIdols) {
			const idol = idolResult.item;
			if (idol.groups?.some((g) => g.name.toLowerCase() === firstWord)) {
				results.push({
					item: idol,
					type: "idol",
				});
			}
		}

		// If no exact matches found, fall back to fuzzy search
		if (results.length === 0) {
			for (const idolResult of potentialIdols) {
				const idol = idolResult.item;
				if (
					idol.groups?.some((g) => g.name.toLowerCase().includes(restWordsStr))
				) {
					results.push({
						item: idol,
						type: "idol",
					});
				}
			}
		}
	} else {
		if (type === "all" || type === "idol") {
			const idolResults = idolSearcherInstance.search(query);
			results.push(
				...idolResults.map((result) => ({
					item: result.item,
					type: "idol" as const,
				})),
			);
		}

		if (type === "all" || type === "group") {
			const groupResults = groupSearcherInstance.search(query);
			results.push(
				...groupResults.map((result) => ({
					item: result.item,
					type: "group" as const,
				})),
			);
		}
	}

	// Remove duplicates
	const uniqueResults = results.filter(
		(result, index, self) =>
			index === self.findIndex((r) => r.item.id === result.item.id),
	);

	return uniqueResults.slice(0, limit);
}

export type { Idol, Group };
export function getItemById(
	id: string,
): { item: Idol | Group; type: "idol" | "group" } | null {
	const idol = [...dataset.femaleIdols, ...dataset.maleIdols].find(
		(i) => i.id === id,
	);
	if (idol) return { item: idol, type: "idol" };

	const group = [
		...dataset.girlGroups,
		...dataset.boyGroups,
		...dataset.coedGroups,
	].find((g) => g.id === id);
	if (group) return { item: group, type: "group" };

	return null;
}
