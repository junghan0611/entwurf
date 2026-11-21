import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXPECTED = [
	...Array.from({ length: 16 }, (_, i) => `L${i + 1}`),
	"P1",
	"P2",
	...Array.from({ length: 9 }, (_, i) => `Z${i + 1}`),
	"V1",
	"V2",
	"V3",
	"V4",
	"V5",
	"V6",
	...Array.from({ length: 10 }, (_, i) => `U${i + 1}`),
	...Array.from({ length: 5 }, (_, i) => `U${i + 12}`),
];
const STATES = new Set(["implemented", "declined", "deferred", "not-wired", "unmeasured"]);

function testFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return testFiles(path);
		return entry.isFile() && /\.test\.(?:ts|mjs)$/.test(entry.name) ? [path] : [];
	});
}

function oracleCounts(): Map<string, number> {
	const counts = new Map<string, number>();
	for (const dir of ["pi-extensions", "plugins/herdr", "plugins/openclaw"]) {
		for (const path of testFiles(join(ROOT, dir))) {
			const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
			const visit = (node: ts.Node): void => {
				if (
					ts.isCallExpression(node) &&
					ts.isIdentifier(node.expression) &&
					["it", "test"].includes(node.expression.text)
				) {
					const title = node.arguments[0];
					if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
						for (const match of title.text.matchAll(/\[QK:[A-Z0-9-]+\]/g))
							counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
		}
	}
	return counts;
}

function scriptCounts(): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entry of readdirSync(join(ROOT, "scripts"), { withFileTypes: true })) {
		if (!entry.isFile() || !/^check-.*\.ts$/.test(entry.name)) continue;
		const path = join(ROOT, "scripts", entry.name);
		const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node): void => {
			if (
				ts.isStringLiteral(node) ||
				ts.isNoSubstitutionTemplateLiteral(node) ||
				ts.isTemplateHead(node) ||
				ts.isTemplateMiddle(node) ||
				ts.isTemplateTail(node)
			) {
				for (const match of node.text.matchAll(/\[QK:[A-Z0-9-]+\]/g))
					counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return counts;
}

it("[QK:ACP-ORACLE-ROW-COVERAGE] baseline rows are complete and implemented QKs name exactly one test title", () => {
	const document = readFileSync(join(ROOT, "docs/acp-client-baseline.md"), "utf8");
	expect(document).toMatch(/^\|\s*Row\s*\|\s*Name\s*\|\s*Status\s*\|\s*Note\s*\|\s*QK\s*\|/m);
	// The page is a short comparison table; the evidence lives in the full document (decision 14).
	expect(document.length, "the short page must stay short").toBeLessThan(24_000);
	const rows = document
		.split(/\r?\n/)
		.flatMap((line, index) =>
			/^\|\s*(?:L\d+|P\d+|Z\d+|V\d+|U\d+)\s*\|/.test(line) ? [{ line, number: index + 1 }] : [],
		);
	const parsed = rows.map(({ line, number }) => {
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
		expect(cells.length, `${cells[0] || "unknown row"} at line ${number}: expected 5 cells`).toBe(5);
		return { cells, number };
	});
	const ids = parsed.map(({ cells }) => cells[0]);
	expect(ids).toEqual(EXPECTED);
	const noteOf = new Map(parsed.map(({ cells }) => [cells[0], cells[3]]));
	const titles = oracleCounts();
	const scripts = scriptCounts();
	const rowClaims = new Map<string, string>();
	for (const {
		cells: [id, , state, evidence, qk],
		number,
	} of parsed) {
		expect(STATES.has(state), `${id}:${number}: unknown state ${state}`).toBe(true);
		expect(evidence.replace(/[\s\-–—]/g, ""), `${id}:${number}: evidence or reason is empty`).toBeTruthy();
		expect(evidence.length, `${id}:${number}: a note is one short sentence`).toBeLessThanOrEqual(140);
		expect(evidence, `${id}:${number}: no file:line inside a table cell`).not.toMatch(/\.(?:ts|mjs|js|md):\d/);
		if (id.startsWith("U")) {
			expect(state, `${id}:${number}: a U row is unmeasured`).toBe("unmeasured");
			const parent = /\b[LPZV]\d+\b/.exec(evidence)?.[0];
			expect(parent && ids.includes(parent), `${id}:${number}: names a parent row`).toBe(true);
			expect(
				noteOf.get(parent ?? "")?.match(new RegExp(`\\b${id}\\b`)),
				`${id}:${number}: parent ${parent} must point back to ${id}`,
			).toBeTruthy();
			expect(evidence, `${id}:${number}: ends with its close line`).toMatch(/(?:blocks close: step \d|stays: .+)\.$/);
		}
		const tokens = [...qk.matchAll(/\[QK:[^\]\r\n]+\]/g)].map((match) => match[0]);
		if (state === "implemented") {
			expect(tokens.length, `${id}:${number}: implemented row needs QK`).toBeGreaterThan(0);
			for (const token of tokens) {
				expect(rowClaims.has(token), `${id}:${number}: ${token} already claimed by ${rowClaims.get(token)}`).toBe(
					false,
				);
				rowClaims.set(token, id);
			}
		} else expect(qk, `${id}:${number}: non-implemented QK must be —`).toBe("—");
		for (const token of tokens) {
			expect(titles.get(token) ?? 0, `${id}:${number}: ${token} must occur in exactly one test title`).toBe(1);
		}
		for (const match of evidence.matchAll(/\bU\d+\b/g)) {
			expect(ids.includes(match[0]), `${id}:${number}: unknown evidence pointer ${match[0]}`).toBe(true);
		}
		for (const match of evidence.matchAll(/\[QK:[^\]\r\n]+\]/g)) {
			const token = match[0];
			expect(
				(titles.get(token) ?? 0) + (scripts.get(token) ?? 0),
				`${id}:${number}: evidence ${token} must occur in exactly one test title or script string`,
			).toBe(1);
		}
	}
});
