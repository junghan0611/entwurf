/**
 * integration-profile — the pure leaf that turns ONE `herdr integration status` listing
 * into this plugin's activation plan (#116 M3-a).
 *
 * It is a function from a string to a frozen object. It opens nothing, spawns nothing,
 * reads no environment, and writes nothing, so the answer it gives is a property of the
 * listing it was handed and of nothing else. Everything it deliberately refuses is below,
 * because in this repo the absences are the design.
 *
 * WHY A PROSE PARSER AT ALL. Herdr 0.9.0 has no machine format for this listing. Measured
 * 2026-09-16 against the shipped binary: `--json`, `--format=json` and `-o json` each exit
 * 2 with `usage: herdr integration status [--outdated-only]`, and `--outdated-only` is a
 * human remediation sentence that still exits 0. Exit code carries no verdict. So the rows
 * ARE the protocol, and a parser that misreads one is the whole failure surface.
 *
 * A ROW IS ACCEPTED WHOLE OR NOT AT ALL. Every accepted grammar consumes the ENTIRE
 * remainder: a state phrase, then exactly ` (<absolute path>)`, then end of line. Reading
 * only the head and trusting the rest was the first cross-review blocker — `current (v8)`
 * with no suffix, with a relative path, with the closing paren missing, with `()`, and with
 * trailing bytes after the `)` all activated. A row we can only partly explain is a row we
 * cannot claim to have read.
 *
 * THE PATH IS FRAMING, NOT ADDRESS. The suffix must be there and must start at `/`, and
 * that is the whole of what is checked: inside it, spaces, parentheses and the literal text
 * of another state are opaque, because `/srv/current (v9)/…` is a legal directory name. The
 * state is matched FRONT-ANCHORED so the suffix can never spell a verdict, and the path
 * itself never becomes a field — the resolved path a later bootstrap installs against is
 * owned by that bootstrap, from the environment it controls. Validating framing is not
 * promoting an address.
 *
 * THE DELIMITER IS PART OF THE DECLARATION. A row is claimed by an atom the moment it opens
 * `<atom>:`, before we know whether what follows is well formed. `pi:current (v8) (/x)` is a
 * broken declaration BY pi, not an unrelated line — dropping it silently let a contradicting
 * row sit beside a valid one and change nothing. Missing, doubled, and unreadable are three
 * distinct named refusals, and none of them may be resolved to a winner.
 *
 * VERSIONS ARE u32. Herdr's integration version is a Rust u32, so `0..4294967295` is the
 * whole domain. A 400-digit capture becomes `Infinity`, and `Infinity` serialises to `null`
 * — a version field that silently reads "no version" on a row that loudly stated one. Out of
 * range is a malformed row, not a null.
 *
 * THE MAP IS CLOSED AND IT IS OURS. Herdr's atom is `claude`; Herdr never emits the string
 * `claude-code`. The plugin's supported set P is frozen at `{pi, claude-code}` (#116
 * `issuecomment-5690300559`), so the table is written out rather than inferred — no
 * lowercasing, no suffixing, no "the atom equals the backend" shortcut that would silently
 * admit the next atom Herdr adds.
 *
 * `current` IS ADMISSION, NOT INTEGRITY. Measured: appending bytes after the version marker
 * still reads `current`, and `v999` reads `current` too — Herdr checks one marker line. So
 * this leaf re-derives no version floor of its own. Herdr decides admission; we decide only
 * what admission means for OUR activation.
 *
 * `outdated` IS NOT "OLD". Measured: an empty file, an unreadable file and a marker-less
 * hand-written file ALL collapse into `outdated (legacy < vN)`. That string therefore means
 * "no readable marker at or above the floor", which is the stale/broken case the M3 contract
 * requires to be a NAMED FAIL. It is never a SKIP and never a cosmetic pass.
 *
 * UNSELECTED ATOMS ARE OBSERVED, NEVER PLANNED. OpenCode is a first-class Herdr atom and a
 * deliberate negative control: it may be installed and current, and it still receives no
 * entry in the plan. An atom nobody has heard of yet cannot widen P, and a malformed row
 * belonging to one cannot disturb the two verdicts that matter.
 */

/**
 * Herdr integration atom → Entwurf backend. CLOSED: this object IS set P.
 * `claude` → `claude-code` is the one rename, and it is written, not derived.
 */
export const SELECTED_ATOMS = Object.freeze({ pi: "pi", claude: "claude-code" });

/** Every refusal this leaf can make carries one of these codes. */
export const PROFILE_ERROR_CODES = Object.freeze([
	"herdr-status-listing-not-a-string",
	"herdr-status-row-missing",
	"herdr-status-row-duplicate",
	"herdr-status-row-malformed",
]);

/** Herdr's integration version is a Rust u32 (`src/integration/types.rs` @ c77af189). */
const U32_MAX = 4294967295;

/** A named refusal. Never a warning, never a default value (AGENTS.md Hard Rule 15). */
export class IntegrationProfileError extends Error {
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.name = "IntegrationProfileError";
		this.code = code;
		this.detail = detail;
	}
}

/**
 * The five state phrases herdr 0.9.0 can put at the head of a row's remainder, each written
 * as the WHOLE remainder: `^<state> \(/<opaque path>\)$`. Three phrases were measured
 * black-box on the shipped binary; the `outdated (vM < vN)` and `needs repair (vN)` forms
 * are the coordinator's source cross-check at herdr `c77af189`
 * (`src/cli/integration.rs:17-90`, `src/integration/registry.rs:447-488`).
 *
 * `^` keeps the state out of reach of the path. ` \(\/` and `\)$` keep the path from being
 * half a row. Between them, `.*` asks nothing about the path at all.
 */
const STATE_GRAMMAR = Object.freeze([
	{ state: "not-installed", re: /^not installed \(\/.*\)$/, installed: () => null, floor: () => null },
	{ state: "current", re: /^current \(v(\d+)\) \(\/.*\)$/, installed: (m) => Number(m[1]), floor: () => null },
	{
		state: "outdated",
		re: /^outdated \(legacy < v(\d+)\) \(\/.*\)$/,
		installed: () => null,
		floor: (m) => Number(m[1]),
	},
	{
		state: "outdated",
		re: /^outdated \(v(\d+) < v(\d+)\) \(\/.*\)$/,
		installed: (m) => Number(m[1]),
		floor: (m) => Number(m[2]),
	},
	{
		state: "needs-repair",
		re: /^needs repair \(v(\d+)\) \(\/.*\)$/,
		installed: (m) => Number(m[1]),
		floor: () => null,
	},
]);

/** What each state means for OUR activation. The whole policy, in one table. */
const VERDICT = Object.freeze({
	current: "activate",
	"not-installed": "skip",
	outdated: "fail",
	"needs-repair": "fail",
});

/** The name a skip or a fail is reported under. `activate` needs no reason. */
const REASON = Object.freeze({
	current: null,
	"not-installed": "herdr-integration-not-installed",
	outdated: "herdr-integration-outdated",
	"needs-repair": "herdr-integration-needs-repair",
});

/** `<atom>: ` at the head of a line is how herdr opens every well-formed row. */
const ATOM_LINE = /^([a-z0-9-]+): /;

/** A captured version is real only inside herdr's own u32 domain. */
function isU32(text) {
	return /^\d+$/.test(text) && Number(text) <= U32_MAX;
}

/**
 * Read the ONE row a selected atom must have. A line is CLAIMED by the atom at `<atom>:`,
 * before its shape is known, so a broken declaration cannot hide as unrelated text. Missing,
 * doubled and unreadable are three distinct named refusals; none is resolved to a winner.
 */
function readSelectedRow(lines, atom) {
	const prefix = `${atom}: `;
	const declared = lines.filter((line) => line.startsWith(`${atom}:`));
	if (declared.length === 0) {
		throw new IntegrationProfileError("herdr-status-row-missing", `no \`${atom}:\` row in the listing`);
	}
	if (declared.length > 1) {
		throw new IntegrationProfileError(
			"herdr-status-row-duplicate",
			`${declared.length} \`${atom}:\` rows in one listing: ${JSON.stringify(declared)}`,
		);
	}
	const row = declared[0];
	if (!row.startsWith(prefix)) {
		throw new IntegrationProfileError(
			"herdr-status-row-malformed",
			`\`${atom}:\` is not followed by the single space herdr writes: ${JSON.stringify(row)}`,
		);
	}
	const remainder = row.slice(prefix.length);
	for (const entry of STATE_GRAMMAR) {
		const m = entry.re.exec(remainder);
		if (m === null) continue;
		if (m.slice(1).some((captured) => !isU32(captured))) break;
		return Object.freeze({
			atom,
			backend: SELECTED_ATOMS[atom],
			state: entry.state,
			installedVersion: entry.installed(m),
			floorVersion: entry.floor(m),
		});
	}
	throw new IntegrationProfileError(
		"herdr-status-row-malformed",
		`unreadable \`${prefix}\` row: ${JSON.stringify(remainder)}`,
	);
}

/**
 * Atom names present in the listing that are NOT in P. Observation only — this array is a
 * negative control an operator can read, and it feeds nothing.
 */
function observeOtherAtoms(lines) {
	const seen = new Set();
	for (const line of lines) {
		const m = ATOM_LINE.exec(line);
		if (m === null) continue;
		if (Object.hasOwn(SELECTED_ATOMS, m[1])) continue;
		seen.add(m[1]);
	}
	return Object.freeze([...seen].sort());
}

/**
 * `A = E ∩ H ∩ P` for one listing.
 *
 * @param {string} listing stdout of `herdr integration status`
 * @returns frozen plan: `{schemaVersion, selected, activate, skip, fail, observedOtherAtoms}`
 */
export function buildActivationProfile(listing) {
	if (typeof listing !== "string") {
		throw new IntegrationProfileError(
			"herdr-status-listing-not-a-string",
			`the listing must be the stdout string of \`herdr integration status\`, got ${typeof listing}`,
		);
	}
	const lines = listing.split(/\r?\n/);
	const selected = Object.keys(SELECTED_ATOMS).map((atom) => readSelectedRow(lines, atom));

	const activate = [];
	const skip = [];
	const fail = [];
	for (const fact of selected) {
		const verdict = VERDICT[fact.state];
		const entry = Object.freeze({
			backend: fact.backend,
			atom: fact.atom,
			reason: REASON[fact.state],
			state: fact.state,
		});
		if (verdict === "activate") activate.push(fact.backend);
		else if (verdict === "skip") skip.push(entry);
		else fail.push(entry);
	}

	return Object.freeze({
		schemaVersion: 1,
		selected: Object.freeze(selected),
		activate: Object.freeze(activate),
		skip: Object.freeze(skip),
		fail: Object.freeze(fail),
		observedOtherAtoms: observeOtherAtoms(lines),
	});
}
