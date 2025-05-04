import { describe, expect, test } from "bun:test";
import { type Idol, type Group, search } from "@src/index";

describe("Fuzzy Search", () => {
	const testJapaneseName = "ステイシー";

	test("should handle null company data", () => {
		const results = search("company");
		expect(results).toBeDefined();
		// Should not throw any errors
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
					(r.item as Idol).groups?.some((g) => g.name.toLowerCase().includes("fromis")),
			),
		).toBe(true);
	});

	test("should search by group name", () => {
		const results = search("stayc");
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.type === "group")).toBe(true);
	});

	test("should handle Korean characters", () => {
		const results = search("스테이씨");
		expect(results.length).toBeGreaterThan(0);
	});

	test("should handle Japanese characters", () => {
		const results = search(testJapaneseName);
		expect(results.length).toBeGreaterThan(0);
		expect(
			results.some(
				(r) =>
					r.type === "group" &&
					(r.item as Group).groupInfo?.names?.stage
						?.toLowerCase()
						.includes("twice"),
			),
		).toBe(true);
	});

	test("should handle empty/null values", () => {
		expect(() => search("")).not.toThrow();
		expect(() => search(" ")).not.toThrow();
	});

	test("should filter by type", () => {
		const idolResults = search("jin", { type: "idol" });
		expect(idolResults.every((r) => r.type === "idol")).toBe(true);

		const groupResults = search("bts", { type: "group" });
		expect(groupResults.every((r) => r.type === "group")).toBe(true);
	});
});
