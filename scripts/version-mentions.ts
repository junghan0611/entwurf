import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkReceiptVersions } from "../pi-extensions/lib/acp/receipt-versions.ts";
import { checkHerdrPin, versionMentions } from "../pi-extensions/lib/version-mentions.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check" && arg !== "--all") || new Set(args).size !== args.length) {
	console.error("usage: node --experimental-strip-types scripts/version-mentions.ts [--check] [--all]");
	process.exit(2);
}
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"], {
	encoding: "utf8",
})
	.split("\0")
	.filter(Boolean);
console.log(
	"Version inventory: lexical hints, not semantic proof. A fails; B is historical; C is any other semver; L is a Herdr pin. --all prints B/C matches.",
);
console.log("History: NEXT.md, NEXT--*.md, ROADMAP.md, CHANGELOG.md, BASELINE.md, docs/baseline-receipts.md.");
const raw: unknown = JSON.parse(readFileSync("plugins/herdr/runtime-lock.json", "utf8"));
const { lock, mismatch: pinMismatch, pinCount } = checkHerdrPin(raw, readFileSync("plugins/herdr/README.md", "utf8"));
if (lock.source === "herdr-checkout")
	console.log("Herdr pin check: SKIP — checkout carrier has no npm version or required npm pin row.");
const receipts = checkReceiptVersions(
	readFileSync("docs/acp-client-baseline.md", "utf8"),
	JSON.parse(readFileSync("package.json", "utf8")),
	readFileSync("pi-extensions/lib/acp/backend-adapter.ts", "utf8"),
);
const counts = { A: 0, B: 0, C: 0, L: 0 };
let currentLiterals = 0;
for (const file of files) {
	for (const mention of versionMentions(file, readFileSync(file, "utf8"), lock)) {
		counts[mention.kind]++;
		if (mention.kind === "A" && /^(?:current|현재)\s/i.test(mention.text)) currentLiterals++;
		if (args.includes("--all") || mention.kind === "A" || mention.kind === "L")
			console.log(`${mention.kind} ${file}:${mention.line}: ${mention.text}`);
	}
}
console.log(`Totals: A=${counts.A} B=${counts.B} C=${counts.C} L=${counts.L}`);
if (pinMismatch)
	console.error(
		`[QK:VERSION-MENTIONS-HERDR-LOCK] plugins/herdr/README.md: npm pin count ${pinCount}, lock ${lock.source === "npm" ? lock.version : lock.source}`,
	);
if (currentLiterals)
	console.error(`[QK:VERSION-MENTIONS-CURRENT-LITERAL] ${currentLiterals} current version literal(s)`);
if (counts.A) console.error(`[QK:VERSION-MENTIONS-CURRENT] ${counts.A} unscoped current package version mention(s)`);
if (receipts.claude.length)
	console.error(`[QK:ACP-RECEIPT-CLAUDE-PIN] docs/acp-client-baseline.md: ${receipts.claude.join("; ")}`);
if (receipts.agy.length)
	console.error(`[QK:ACP-RECEIPT-AGY-FLOOR] docs/acp-client-baseline.md: ${receipts.agy.join("; ")}`);
if (receipts.claudeMeasured.length)
	console.error(`[QK:ACP-RECEIPT-CLAUDE-MEASURED] docs/acp-client-baseline.md: ${receipts.claudeMeasured.join("; ")}`);
if (receipts.agyMeasured.length)
	console.error(`[QK:ACP-RECEIPT-AGY-MEASURED] docs/acp-client-baseline.md: ${receipts.agyMeasured.join("; ")}`);
const receiptIssues =
	receipts.claude.length + receipts.agy.length + receipts.claudeMeasured.length + receipts.agyMeasured.length;
if (args.includes("--check") && (counts.A || pinMismatch || receiptIssues)) process.exitCode = 1;
