import { describe, expect, it } from "vitest";
import { checkHerdrPin, versionMentions } from "./version-mentions.ts";

const kinds = (file: string, text: string) => versionMentions(file, text).map((x) => x.kind);

describe("version mention lexical inventory", () => {
	it("flags unscoped package specs and current versions, regardless of their value", () => {
		expect(kinds("guide.md", "npm install @junghanacs/entwurf@0.55.1\ncurrent 0.60.0\n현재 0.60.1")).toEqual([
			"A",
			"A",
			"A",
		]);
	});
	it("catches both original current-version failures and only exempts an adjacent upstream subject", () => {
		expect(kinds("guide.md", "| pi | optional-by-presence — current 0.60.0: `>=1.5.2 <1.6`")[0]).toBe("A");
		expect(kinds("guide.md", "The ordinary Pi CLI (§2; current 0.55.1 range `>=1.5.2 <1.6`)")[0]).toBe("A");
		expect(kinds("guide.md", "pi current 1.5.2")).toEqual(["C"]);
	});
	it("does not let nearby historical prose suppress an unmarked package spec", () => {
		expect(kinds("guide.md", "historical snapshot @junghanacs/entwurf@0.51.0")).toEqual(["A"]);
	});
	it("scopes published regions by position and excludes named history files from red", () => {
		const source =
			"current 0.60.0; <!-- entwurf:published @junghanacs/entwurf@0.51.0 pi 1.5.0 -->@junghanacs/entwurf@0.51.0<!-- /entwurf:published --> @junghanacs/entwurf@0.60.0";
		expect(kinds("guide.md", source)).toEqual(["A", "B", "B", "B", "A"]);
		expect(kinds("CHANGELOG.md", "npm install @junghanacs/entwurf@0.1.0")).toEqual(["B"]);
		expect(kinds("BASELINE.md", "current 0.1.0")).toEqual(["B"]);
		expect(kinds("docs/baseline-receipts.md", "@junghanacs/entwurf@0.1.0")).toEqual(["B"]);
		expect(kinds("NEXT--branch.md", "current 0.1.0")).toEqual(["B"]);
		expect(kinds("ROADMAP.md", "current 0.1.0")).toEqual(["B"]);
	});
	it("binds only the named Herdr pin to the independently supplied lock", () => {
		const line = "what step 5 acquires. The npm pin is `@junghanacs/entwurf@0.60.0`";
		expect(versionMentions("plugins/herdr/README.md", line, { source: "npm", version: "0.60.0" })[0]?.kind).toBe("L");
		expect(versionMentions("plugins/herdr/README.md", line, { source: "npm", version: "0.55.1" })[0]?.kind).toBe("A");
		expect(versionMentions("other.md", line, { source: "npm", version: "0.60.0" })[0]?.kind).toBe("A");
		expect(versionMentions("plugins/herdr/README.md", line, { source: "herdr-checkout" })[0]?.kind).toBe("L");
		expect(
			versionMentions("plugins/herdr/README.md", "another @junghanacs/entwurf@0.60.0", {
				source: "npm",
				version: "0.60.0",
			})[0]?.kind,
		).toBe("L");
	});
	it("skips npm pin comparison for the checkout carrier but requires one matching npm pin", () => {
		expect(checkHerdrPin({ source: "herdr-checkout" }, "checkout instructions, no npm row").mismatch).toBe(false);
		expect(checkHerdrPin({ source: "npm", version: "0.60.0" }, "no npm row").mismatch).toBe(true);
		expect(
			checkHerdrPin({ source: "npm", version: "0.60.0" }, "The npm pin is `@junghanacs/entwurf@0.60.0`").mismatch,
		).toBe(false);
		expect(() => checkHerdrPin({ source: "unknown" }, "")).toThrow();
	});
	it("reports explicitly historical Herdr paragraphs without exempting install commands", () => {
		const text =
			"Previous snapshot\n@junghanacs/entwurf@0.53.1\nnpm install @junghanacs/entwurf@0.53.1\n\n@junghanacs/entwurf@0.60.0";
		expect(kinds("plugins/herdr/README.md", text)).toEqual(["B", "A", "A"]);
		expect(kinds("other.md", "Previous snapshot @junghanacs/entwurf@0.53.1")).toEqual(["A"]);
	});
	it("reports other versions without claiming they are current", () => {
		expect(kinds("guide.md", "pi 1.5.2 and 0.60.0")).toEqual(["C", "C"]);
		expect(kinds("guide.md", "upstream 현재 0.79.0; @junghanacs/entwurf@0.51.0")).toEqual(["C", "A"]);
	});
});
