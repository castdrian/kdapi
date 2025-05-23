import { describe, expect, test } from "bun:test";
import { type Idol, type Group, search, getItemById } from "@src/index";

describe("Fuzzy Search", () => {
	test("should handle null company data", () => {
		const results = search("company");
		expect(results).toBeDefined();
	});

	test("should search by idol name", () => {
		const results = search("sumin");
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.type === "idol")).toBe(true);
	});

	test("should search by idol name + group", () => {
		const results = search("sumin stayc");
		expect(results.length).toBeGreaterThan(0);
		expect(
			results.some(
				(r) =>
					r.type === "idol" &&
					(r.item as Idol).groups?.some((g: { name: string }) =>
						g.name.toLowerCase().includes("stayc"),
					),
			),
		).toBe(true);
	});

	test("should search by group name", () => {
		const results = search("stayc");
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.type === "group")).toBe(true);
	});

	test("should return both group and members when searching for group name", () => {
		const results = search("stayc");
		const hasGroup = results.some((r) => r.type === "group");
		const hasMembers = results.some((r) => r.type === "idol");
		expect(hasGroup).toBe(true);
		expect(hasMembers).toBe(true);
	});

	test("should prioritize exact group name matches", () => {
		const results = search("stayc");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.type).toBe("group");
		expect(
			(results[0]?.item as Group).groupInfo?.names?.stage?.toLowerCase(),
		).toContain("stayc");
	});

	test("should handle Korean characters", () => {
		const results = search("스테이씨");
		expect(results.length).toBeGreaterThan(0);
	});

	test("should handle Japanese characters", () => {
		const results = search("ステイシー");
		expect(results.length).toBeGreaterThan(0);
		expect(
			results.some(
				(r) =>
					r.type === "group" &&
					(r.item as Group).groupInfo?.names?.stage
						?.toLowerCase()
						.includes("stayc"),
			),
		).toBe(true);
	});

	test("should handle empty/null values", () => {
		expect(() => search("")).not.toThrow();
		expect(() => search(" ")).not.toThrow();
	});

	test("should filter by type", () => {
		const idolResults = search("sumin", { type: "idol" });
		expect(idolResults.every((r) => r.type === "idol")).toBe(true);

		const groupResults = search("stayc", { type: "group" });
		expect(groupResults.every((r) => r.type === "group")).toBe(true);
	});
});

describe("Get Item by ID", () => {
	test("should return group when given valid group ID", () => {
		const result = search("stayc", { type: "group", limit: 1 });
		const group = result[0]?.item;
		expect(group).toBeDefined();

		if (group) {
			const foundItem = getItemById(group.id);
			expect(foundItem).toBeDefined();
			expect(foundItem?.id).toBe(group.id);
		}
	});

	test("should return idol when given valid idol ID", () => {
		const result = search("sumin", { type: "idol", limit: 1 });
		const idol = result[0]?.item;
		expect(idol).toBeDefined();

		if (idol) {
			const foundItem = getItemById(idol.id);
			expect(foundItem).toBeDefined();
			expect(foundItem?.id).toBe(idol.id);
		}
	});

	test("should return undefined for invalid ID", () => {
		const foundItem = getItemById("non-existent-id");
		expect(foundItem).toBeUndefined();
	});
});
