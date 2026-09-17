/**
 * check-herdr-plugin-profile — deterministic gate for the #116 M3-a pure leaf
 * (`plugins/herdr/lib/integration-profile.mjs`), the function that turns ONE
 * `herdr integration status` listing into this plugin's activation plan.
 *
 * WHAT IS AND IS NOT UNDER TEST. The subject is a CONSUMER of a listing, so every listing
 * here is an input string, never a claim about herdr. The rows are verbatim herdr 0.9.0
 * output measured 2026-09-16 on the shipped binary in a sandboxed HOME/XDG, plus two forms
 * (`outdated (vM < vN)`, `needs repair (vN)`) the coordinator cross-checked in herdr source
 * at `c77af189`. No herdr binary is spawned, nothing is installed, no environment is read,
 * and nothing is written — if this gate ever needs any of those, the leaf stopped being pure.
 *
 * WHY THE HAZARD CASES LOOK ABSURD. `/srv/current (v9)/…` is a legal directory name, and the
 * trailing `(<path>)` on every row is operator-chosen text. A parser that scans the whole row
 * for a state can be told any answer by a directory name, and the row it misreads is the one
 * that decides whether a broken integration gets activated. So the ugly paths are the point.
 *
 * FRAMING AND STATE ARE TWO DIFFERENT PROOFS. Cross-review found the first cut reading only
 * the HEAD of a row and trusting the rest: `current (v8)` with no suffix at all, with a
 * relative path, with the closing paren missing, with `()`, and with trailing bytes after
 * the `)` all activated. So the framing cells and the front-anchoring cells are separate
 * claims with separate mutants — one is "we read the whole row", the other is "the path may
 * not spell the state", and a single token over both would have covered the hole.
 *
 * ORDER IS LOAD-BEARING. Each [QK:HIP-*] token appears exactly once, on the assertion that
 * fails for that claim, and the assertions are ordered so that a mutant of one claim cannot
 * trip an earlier claim's assertion first — that is what makes an attributed KILL mean the
 * thing it names. In particular the front-anchoring cell asserts STATES, never verdicts,
 * because the verdict table is what two later mutants move.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LEAF = path.join(REPO, "plugins", "herdr", "lib", "integration-profile.mjs");

interface SelectedFact {
	atom: string;
	backend: string;
	state: string;
	installedVersion: number | null;
	floorVersion: number | null;
}
interface PlanEntry {
	backend: string;
	atom: string;
	reason: string | null;
	state: string;
}
interface Profile {
	schemaVersion: number;
	selected: SelectedFact[];
	activate: string[];
	skip: PlanEntry[];
	fail: PlanEntry[];
	observedOtherAtoms: string[];
}
interface Leaf {
	SELECTED_ATOMS: Record<string, string>;
	buildActivationProfile: (listing: string) => Profile;
}

// A non-literal specifier: `plugins/` is outside both typecheck fences (it is plain ESM
// JavaScript herdr runs directly), so the module is loaded, not type-resolved.
const leaf = (await import(pathToFileURL(LEAF).href)) as Leaf;
const { SELECTED_ATOMS, buildActivationProfile } = leaf;

/** Build a listing from rows, the way herdr prints it: one atom per line, newline-terminated. */
function listing(...rows: string[]): string {
	return `${rows.join("\n")}\n`;
}

/** A well-formed row for the OTHER selected atom, so a cell tests exactly the row it means to. */
const CLAUDE_OK = "claude: current (v9) (/home/u/.claude/hooks/herdr-agent-state.sh)";
const PI_OK = "pi: current (v8) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)";

/** Return the refusal code for a listing, or null if it produced a profile instead. */
function refusalCode(text: string): string | null {
	try {
		buildActivationProfile(text);
		return null;
	} catch (err) {
		return (err as { code?: string }).code ?? `not-an-IntegrationProfileError:${String(err)}`;
	}
}

/** The refusal code for a single hostile `pi:` row standing beside a well-formed claude row. */
function piRowCode(row: string): string | null {
	return refusalCode(listing(row, CLAUDE_OK));
}

// ── 1. the table is closed, written out, and ours ───────────────────────────
{
	ok(
		"[QK:HIP-CLOSED-MAP] the Herdr-atom → Entwurf-backend table is EXACTLY {pi→pi, claude→claude-code} and frozen — " +
			"set P is frozen at {pi, claude-code} (#116 issuecomment-5690300559), herdr never emits the string " +
			"`claude-code`, and any rule that DERIVES a backend from an atom name (identity, lowercasing, suffixing) " +
			"silently admits whichever atom herdr adds next: OpenCode is installed on real hosts and is the negative " +
			`control this lane must keep outside the product (got ${JSON.stringify(SELECTED_ATOMS)})`,
		JSON.stringify(SELECTED_ATOMS) === '{"pi":"pi","claude":"claude-code"}' && Object.isFrozen(SELECTED_ATOMS),
	);
}

// ── 2. an absent selected atom is refused by name ───────────────────────────
{
	const missing = refusalCode(listing(CLAUDE_OK));
	ok(
		"[QK:HIP-ROW-MISSING-REFUSED] a selected atom with NO row refuses by name — a real listing prints EVERY atom " +
			"every time (17 rows on 0.9.0, 18 on 0.9.1: `[측정 2026-09-17]` the added row is `letta (experimental)` and the " +
			"other 17 are byte-identical), so a listing with no `pi:` line at all is not the protocol we think we are reading, and " +
			"the plausible-looking alternative (treat absence as 'not installed') would report a clean zero-write SKIP " +
			`for a question that was never actually asked (got ${missing})`,
		missing === "herdr-status-row-missing",
	);
}

// ── 3. a doubled selected atom is refused by name, never resolved ───────────
{
	const doubled = refusalCode(
		listing(PI_OK, CLAUDE_OK, "pi: not installed (/home/u/.pi/agent/extensions/herdr-agent-state.ts)"),
	);
	ok(
		"[QK:HIP-ROW-DUPLICATE-REFUSED] two rows for one selected atom refuse by name — a listing that says both " +
			"`current` and `not installed` for pi is a contradiction, and taking the first or the last match turns it " +
			"into a silent guess about whether an integration is installed, which is exactly the question this leaf " +
			`exists to answer (got ${doubled})`,
		doubled === "herdr-status-row-duplicate",
	);
}

// ── 4. `<atom>:` claims the line before its shape is known ──────────────────
{
	const aloneNoSpace = piRowCode("pi:current (v8) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)");
	const aloneTab = piRowCode("pi:\tcurrent (v8) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)");
	const besideValid = refusalCode(
		listing(PI_OK, "pi:current (v1) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)", CLAUDE_OK),
	);
	ok(
		"[QK:HIP-SELECTED-DELIMITER-FRAMED] a line is CLAIMED by the atom at `<atom>:`, before its shape is known — " +
			"`pi:current …` and `pi:<TAB>current …` are broken declarations BY pi, not unrelated text, so alone they are " +
			"malformed and beside a valid row they are a doubled declaration; matching on `pi: ` instead lets a row that " +
			"contradicts the one we accepted sit in the same listing and change nothing " +
			`(alone=${aloneNoSpace}/${aloneTab} beside-valid=${besideValid})`,
		aloneNoSpace === "herdr-status-row-malformed" &&
			aloneTab === "herdr-status-row-malformed" &&
			besideValid === "herdr-status-row-duplicate",
	);
}

// ── 5. an unreadable state is refused, never defaulted ──────────────────────
{
	const unknown = piRowCode(
		"pi: brand new state nobody has shipped yet (/home/u/.pi/agent/extensions/herdr-agent-state.ts)",
	);
	ok(
		"[QK:HIP-ROW-MALFORMED-REFUSED] a selected row whose state this parser cannot read refuses by name and is never " +
			"resolved to a default — a future herdr phrase quietly read as `not installed` would turn an unknown into a " +
			"zero-write SKIP and let the run report success over a state nobody has interpreted " +
			`(got ${unknown})`,
		unknown === "herdr-status-row-malformed",
	);
}

// ── 6. a row is accepted whole, or not at all ───────────────────────────────
{
	const cells = {
		"no suffix": "pi: current (v8)",
		"relative path": "pi: current (v8) (relative/path/herdr-agent-state.ts)",
		truncated: "pi: current (v8) (/home/u/.pi/agent/extensions/herdr-agent-state.ts",
		"empty parens": "pi: current (v8) ()",
		"trailing bytes": "pi: current (v8) (/home/u/.pi/agent/extensions/herdr-agent-state.ts) and then some",
	};
	const verdicts = Object.entries(cells).map(([name, row]) => `${name}=${piRowCode(row)}`);
	const hostileButWellFormed = buildActivationProfile(
		listing("pi: current (v8) (/srv/current (v9) (/x)/agent/extensions/herdr-agent-state.ts)", CLAUDE_OK),
	);
	ok(
		"[QK:HIP-SUFFIX-FRAMING] every accepted grammar consumes the WHOLE remainder — state, then exactly one " +
			"` (<absolute path>)`, then end of line — while the bytes INSIDE the path stay opaque. Reading only the head " +
			"and trusting the rest is the hole cross-review found: no suffix, a relative path, a missing `)`, `()` and " +
			"trailing bytes each ACTIVATED a row nobody had finished reading. Framing is checked; the path is still " +
			`never promoted to an address (${verdicts.join(" ")} hostile-but-well-formed=${hostileButWellFormed.selected[0]?.state})`,
		verdicts.every((v) => v.endsWith("=herdr-status-row-malformed")) &&
			hostileButWellFormed.selected[0]?.state === "current" &&
			hostileButWellFormed.selected[0]?.installedVersion === 8,
	);
}

// ── 7. a version outside herdr's u32 domain is malformed, not null ──────────
{
	const huge = piRowCode(`pi: current (v${"4".repeat(400)}) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)`);
	const atMax = buildActivationProfile(
		listing("pi: current (v4294967295) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)", CLAUDE_OK),
	);
	ok(
		"[QK:HIP-VERSION-U32] a captured version must land inside herdr's own u32 domain (0..4294967295) or the row is " +
			"malformed — a 400-digit capture becomes `Infinity`, `Infinity` serialises to `null`, and the plan would then " +
			"carry 'no version' for a row that loudly stated one; the boundary value itself must still parse, so this is " +
			`a domain check and not a length heuristic (400-digit=${huge} at-max=${atMax.selected[0]?.installedVersion})`,
		huge === "herdr-status-row-malformed" && atMax.selected[0]?.installedVersion === 4294967295,
	);
}

// ── 8. the state is read front-anchored; the display path is never scanned ──
{
	const hostile = buildActivationProfile(
		listing(
			"pi: outdated (legacy < v8) (/srv/current (v9) (/x)/agent/extensions/herdr-agent-state.ts)",
			"claude: not installed (/home/u/My (v9) dir/hooks (outdated (legacy < v3))/herdr-agent-state.sh)",
		),
	);
	const [pi, claude] = hostile.selected;
	ok(
		"[QK:HIP-STATE-FRONT-ANCHORED] the state is matched at the HEAD of the remainder and the path between the " +
			"framing parens is never searched — `/srv/current (v9) (/x)/…` and `…/hooks (outdated (legacy < v3))/…` are " +
			"legal directory names an operator chose, so a parser that looks for a state anywhere in the row lets a " +
			`DIRECTORY NAME decide whether a broken integration reads as installed (pi=${pi?.state}/floor=${pi?.floorVersion} claude=${claude?.state})`,
		pi?.state === "outdated" &&
			pi?.floorVersion === 8 &&
			pi?.installedVersion === null &&
			claude?.state === "not-installed",
	);
}

// ── 9. no path ever becomes a field of the plan ─────────────────────────────
{
	const profile = buildActivationProfile(
		listing(
			"pi: current (v9) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)",
			"claude: outdated (legacy < v9) (/home/u/.claude/hooks/herdr-agent-state.sh)",
		),
	);
	const keysets = profile.selected.map((f) => Object.keys(f).sort().join(","));
	const expected = ["atom", "backend", "floorVersion", "installedVersion", "state"].join(",");
	ok(
		"[QK:HIP-PATH-IS-NOT-AUTHORITY] the display path is opaque and leaves no trace in the plan — not a field, not a " +
			"substring, not one `/` anywhere in the serialised profile. Checking that a row is FRAMED by a path is not " +
			"the same as carrying one: the resolved path a later bootstrap installs against is owned by that bootstrap " +
			"from the environment it controls (measured: the same bytes read `current` or `not installed` depending only " +
			`on PI_CODING_AGENT_DIR), and two layers must not each hold their own answer (keysets=${JSON.stringify(keysets)})`,
		keysets.every((k) => k === expected) && !JSON.stringify(profile).includes("/"),
	);
}

// ── 10. outdated and needs-repair are named FAILs ───────────────────────────
{
	const profile = buildActivationProfile(
		listing(
			"pi: outdated (v7 < v8) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)",
			"claude: needs repair (v9) (/home/u/.claude/hooks/herdr-agent-state.sh)",
		),
	);
	ok(
		"[QK:HIP-OUTDATED-IS-FAIL] `outdated` and `needs repair` on a SELECTED atom are named FAILs, never a skip and " +
			"never a cosmetic pass — measured 2026-09-16, an empty file, a chmod-000 file and a marker-less hand-written " +
			"file ALL collapse into `outdated (legacy < vN)`, so that word means 'no readable marker at or above the " +
			"floor', which is exactly the stale/broken case the M3 contract requires to stop the run " +
			`(activate=${JSON.stringify(profile.activate)} fail=${JSON.stringify(profile.fail.map((f) => f.reason))})`,
		profile.activate.length === 0 &&
			profile.skip.length === 0 &&
			profile.fail.map((f) => `${f.backend}:${f.reason}`).join("|") ===
				"pi:herdr-integration-outdated|claude-code:herdr-integration-needs-repair",
	);
}

// ── 11. not-installed is a zero-write SKIP, not a failure ───────────────────
{
	const profile = buildActivationProfile(
		listing("pi: not installed (/home/u/.pi/agent/extensions/herdr-agent-state.ts)", CLAUDE_OK),
	);
	ok(
		"[QK:HIP-ABSENT-IS-SKIP-ZERO-WRITE] `not installed` on a selected atom is a NAMED, zero-write SKIP and the rest " +
			"of the plan proceeds — a host that simply has not added that Herdr integration is not broken, and turning " +
			"its absence into a red is the shape that invites the plugin to go install the harness it must never install " +
			`(AGENTS.md Hard Rule 17) (skip=${JSON.stringify(profile.skip)} activate=${JSON.stringify(profile.activate)})`,
		profile.fail.length === 0 &&
			profile.activate.join(",") === "claude-code" &&
			profile.skip.map((s) => `${s.backend}:${s.reason}`).join("|") === "pi:herdr-integration-not-installed",
	);
}

// ── 12. `current` is herdr's admission, and we add no floor of our own ──────
{
	const profile = buildActivationProfile(
		listing(
			"pi: current (v1) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)",
			"claude: current (v999) (/home/u/.claude/hooks/herdr-agent-state.sh)",
		),
	);
	ok(
		"[QK:HIP-CURRENT-IS-ADMISSION-ONLY] every `current` activates, at any version inside the domain, because " +
			"`current` is HERDR's admission and not an integrity claim — measured, appending bytes after the marker still " +
			"reads current and `v999` reads current too, so a second version floor invented here would reject hosts herdr " +
			"already admitted while proving nothing about the bytes it was pretending to check " +
			`(activate=${JSON.stringify(profile.activate)} versions=${JSON.stringify(profile.selected.map((f) => f.installedVersion))})`,
		profile.activate.join(",") === "pi,claude-code" &&
			profile.fail.length === 0 &&
			profile.selected.map((f) => f.installedVersion).join(",") === "1,999",
	);
}

// ── 13. atoms outside P are observed, never planned ─────────────────────────
{
	// "may not refuse the whole listing" is HALF of this claim, so the refusal is CAUGHT and judged
	// by the assertion below. Calling straight through would let a leaf that started refusing kill
	// this cell with its own error before the claim it violates is ever evaluated — a red attributed
	// to nobody.
	const crowded = listing(
		PI_OK,
		"omp: not installed (/home/u/.omp/agent/extensions/herdr-omp-agent-state.ts)",
		CLAUDE_OK,
		"codex: current (v8) (/home/u/.codex/herdr-agent-state.sh)",
		"opencode: current (v11) (/home/u/.config/opencode/plugins/herdr-agent-state.js)",
		"grok: outdated (legacy < v1) (/home/u/.grok/hooks/herdr-agent-state.sh)",
		"weirdatom: a state this plugin has never heard of (/home/u/.weird/x)",
		"kilo:broken declaration with no space (/home/u/.config/kilo/plugin/herdr-agent-state.js)",
	);
	let full: ReturnType<typeof buildActivationProfile> | null = null;
	let refused: string | null = null;
	try {
		full = buildActivationProfile(crowded);
	} catch (err) {
		refused = `${(err as { code?: string }).code ?? "unknown"}: ${(err as Error).message}`;
	}
	const plan = full === null ? "<refused>" : JSON.stringify([full.activate, full.skip, full.fail]);
	ok(
		"[QK:HIP-UNSELECTED-NEVER-ACTIVATES] rows outside P are OBSERVED and never planned, and neither an unsupported " +
			"atom nor an unparsable one disturbs the two verdicts that matter — OpenCode current v11 is the deliberate " +
			"negative control (it must receive zero Entwurf state even while herdr reports it installed), Codex is out " +
			"of this lane by GLG decision, and neither a future atom this parser cannot read nor a broken declaration " +
			`belonging to one may refuse the whole listing (plan=${plan} refused=${JSON.stringify(refused)} ` +
			`observed=${JSON.stringify(full === null ? null : full.observedOtherAtoms)})`,
		refused === null &&
			full !== null &&
			full.activate.join(",") === "pi,claude-code" &&
			full.skip.length === 0 &&
			full.fail.length === 0 &&
			!plan.includes("opencode") &&
			!plan.includes("codex") &&
			full.observedOtherAtoms.join(",") === "codex,grok,omp,opencode,weirdatom",
	);
}

// ── 14. the leaf is pure, and stays that way ────────────────────────────────
{
	const source = fs.readFileSync(LEAF, "utf8");
	const impurities = [/\bimport\s/, /\brequire\(/, /\bprocess\./, /node:/, /\bMath\.random\b/, /\bDate\.now\b/];
	const found = impurities.filter((re) => re.test(source)).map((re) => re.source);
	const twice = listing(PI_OK, "claude: not installed (/home/u/.claude/hooks/herdr-agent-state.sh)");
	const a = JSON.stringify(buildActivationProfile(twice));
	const b = JSON.stringify(buildActivationProfile(twice));
	ok(
		"[QK:HIP-PURE-LEAF] the leaf imports nothing and touches no process, clock, randomness or filesystem, and the " +
			"same listing yields byte-identical plans — the whole worth of deciding activation HERE is that the answer " +
			"is a property of the listing and of nothing else; the moment it can read an environment, the plan and the " +
			`bootstrap that acts on it can disagree about which host they are on (found=${JSON.stringify(found)})`,
		found.length === 0 && a === b,
	);
}

console.log(`\ncheck-herdr-plugin-profile: ${passed} assertions passed`);
