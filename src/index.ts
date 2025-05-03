import type { Idol, Group, DataSet, GroupsData, IdolsData } from "@src/types";
import groups from "@root/data/groups.json" assert { type: "json" };
import idols from "@root/data/idols.json" assert { type: "json" };
import Fuse from "fuse.js";

const dataset: DataSet = {
	femaleIdols: (idols as IdolsData).femaleIdols,
	maleIdols: (idols as IdolsData).maleIdols,
	girlGroups: (groups as GroupsData).girlGroups,
	boyGroups: (groups as GroupsData).boyGroups,
	coedGroups: (groups as GroupsData).coedGroups,
};

const searchOptions = {
	includeScore: true,
	threshold: 0.4,
	keys: [
		"names.stage",
		"names.korean",
		"names.japanese",
		"names.chinese",
		"names.full",
		"names.native",
		"company.current",
		"company.history.name",
	],
};

// Create search indices
const idolIndex = new Fuse(
	[...dataset.femaleIdols, ...dataset.maleIdols],
	searchOptions,
);
const groupIndex = new Fuse(
	[...dataset.girlGroups, ...dataset.boyGroups, ...dataset.coedGroups],
	searchOptions,
);

/**
 * Fuzzy search across both idols and groups
 */
export function fuzzySearch(
	query: string,
	options?: {
		type?: "idol" | "group" | "all";
		limit?: number;
		threshold?: number;
	},
) {
	const { type = "all", limit = 10, threshold = 0.4 } = options ?? {};
	const results: {
		item: Idol | Group;
		score: number;
		type: "idol" | "group";
	}[] = [];

	if (type === "all" || type === "idol") {
		const idolResults = idolIndex.search(query, { limit });
		results.push(
			...idolResults
				.filter((r): r is typeof r & { score: number } => r.score !== undefined)
				.map((r) => ({ item: r.item, score: r.score, type: "idol" as const })),
		);
	}

	if (type === "all" || type === "group") {
		const groupResults = groupIndex.search(query, { limit });
		results.push(
			...groupResults
				.filter((r): r is typeof r & { score: number } => r.score !== undefined)
				.map((r) => ({ item: r.item, score: r.score, type: "group" as const })),
		);
	}

	return results
		.filter((r) => r.score && r.score < threshold)
		.sort((a, b) => a.score - b.score)
		.slice(0, limit)
		.map(({ item, type }) => ({ item, type }));
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
