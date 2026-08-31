/**
 * check-harness-admission-parity — the edge between two parity loops that were each closed and
 * had nothing between them (#87 Bundle C).
 *
 * ── The defect this owns ──
 *
 * Two gates already held their own halves tight:
 *
 *   `check-entwurf-capabilities`            registry  ==  META_CITIZEN_BACKENDS
 *   `fresh-call-surfaces.contract.test.ts`  surfaces  ==  FRESH_CALL_BACKENDS
 *
 * and NO file imported both constants. So a harness could be admitted as a full D6 citizen —
 * birth, MCP hand, receive, a garden id on its own status line — while `entwurf_fresh_call`
 * could not open it, and every gate in the repo stayed green. `docs/adding-a-harness.md` step 9
 * says a backend is **supported** only when it can be opened as one visible fresh sibling, but
 * that sentence had no consumer: the honest prose in `DELIVERY.md` ("Visible fresh is NOT
 * implemented, so OMP is not a supported harness under step 9") sat there being true while a
 * release package containing that backend passed the whole floor.
 *
 * `[측정]` 2026-08-30, on the Bundle A+B candidate: registry carried six backends, all D6;
 * `FRESH_CALL_BACKENDS` carried three. The omp row read `unsupported` in the docs and shipped
 * anyway. GLG's finding: **an `unsupported` label is not a partial-release permit.**
 *
 * ── The rule ──
 *
 * Every backend a meta-record may name is either
 *   (a) openable by `entwurf_fresh_call` — it walked step 9; or
 *   (b) a PRE-#82 admission, named here AND described as such in the delivery matrix.
 *
 * There is no third state. A post-#82 harness that is a citizen but not fresh-openable makes
 * this gate red, which is what stops the release package rather than only the docs.
 *
 * ── Why the exception is a literal here plus a sentence there ──
 *
 * Same shape `check-release-gate-outcomes` cell 7 already uses for aggregate omissions, and for
 * the same reason it states: *an exclusion that only this gate believes in is how the omission
 * would come back.* The pair is deliberately redundant — the literal makes the exception a
 * decision someone had to type, and the doc sentence makes it a thing an operator can read
 * without opening this file. Neither half alone is the contract.
 *
 * This introduces NO new authority: the capability registry keeps its schema (there is no
 * `supported` field and there must not be one — a self-declared grade is exactly what step 9
 * refuses), and the fresh set stays the composition's own constant.
 *
 * Pure parse over shipped source + docs. No backend, no network, no subprocess.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { META_CITIZEN_BACKENDS, type MetaCitizenBackend } from "../pi-extensions/lib/meta-session.ts";
import { FRESH_CALL_BACKENDS } from "../pi-extensions/lib/mux-fresh-call.ts";

const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/**
 * Backends admitted BEFORE the #82 step 9 contract, which `docs/adding-a-harness.md` step 9
 * preserves explicitly: "a pre-contract backend that has not walked this step remains
 * legacy/probe evidence and must not be described as supported until it is re-evaluated here."
 * Copilot is the first admission made UNDER that contract (step 9's worked example), so nothing
 * admitted after it qualifies for this list.
 *
 * `claude-code` and `pi` are also pre-contract and are deliberately absent: they are fresh-
 * openable, so they need no exception. An exception is for a backend that CANNOT be opened —
 * never a convenience for one that simply has not been wired yet.
 *
 * Each value is the file and the sentence in it that carries the exception for a reader. The
 * sentence must be the one that says WHY the backend is not step-9 supported; a row that merely
 * mentions the backend is not an exception.
 */
const PRE_82_LEGACY: Partial<Record<MetaCitizenBackend, [file: string, sentence: string]>> = {
	antigravity: [
		"DELIVERY.md",
		"Admitted before the #82 step 9 contract and not re-evaluated under it, so it is legacy citizen evidence, not a step-9 supported harness",
	],
	codex: ["DELIVERY.md", "No owned native-citizen install/invocation lane."],
};

const fresh = new Set<string>(FRESH_CALL_BACKENDS);
const legacy = Object.keys(PRE_82_LEGACY);

// ---------------------------------------------------------------------------
// 1. The join itself. This assertion is the entire point of the file: it is the
//    first line in the repo that reads both constants at once.
// ---------------------------------------------------------------------------
const unaccounted = META_CITIZEN_BACKENDS.filter((b) => !fresh.has(b) && !(b in PRE_82_LEGACY));
ok(
	"[QK:ADMISSION-FRESH-PARITY] every citizen backend is either openable by entwurf_fresh_call or a declared pre-#82 legacy admission — a post-contract harness that mints records but cannot be opened is not admissible, and an `unsupported` note is not a partial-release permit (docs/adding-a-harness.md step 9). Unaccounted: " +
		(unaccounted.length === 0 ? "none" : unaccounted.join(", ")),
	unaccounted.length === 0,
);

// ---------------------------------------------------------------------------
// 2. The exception must be readable OUTSIDE this file. A literal nobody else
//    carries is how the omission comes back (check-release-gate-outcomes cell 7).
// ---------------------------------------------------------------------------
for (const backend of legacy) {
	const [file, sentence] = PRE_82_LEGACY[backend as MetaCitizenBackend] as [string, string];
	const body = fs.readFileSync(path.join(REPO_DIR, file), "utf8");
	ok(
		`[QK:ADMISSION-LEGACY-DOCUMENTED] ${backend}'s pre-#82 exception is carried by a sentence an operator can read in ${file}, not only by this gate's literal`,
		body.includes(sentence),
	);
}

// ---------------------------------------------------------------------------
// 3. The two states are exclusive, and the exception list has no dead entries.
//    A backend that got wired for fresh while keeping its legacy excuse would
//    leave a stale "cannot be opened" sentence in the matrix pointing at a
//    capability that now exists.
// ---------------------------------------------------------------------------
for (const backend of legacy) {
	ok(
		`[QK:ADMISSION-LEGACY-EXCLUSIVE] ${backend} is excused OR fresh-openable, never both — a backend that walked step 9 must lose its exception and its matrix sentence together`,
		!fresh.has(backend),
	);
	ok(
		`[QK:ADMISSION-LEGACY-SCOPE] ${backend} is still a citizen backend — an exception for a backend no record may name is dead weight that hides the next real one`,
		(META_CITIZEN_BACKENDS as readonly string[]).includes(backend),
	);
}

// ---------------------------------------------------------------------------
// 4. The reverse direction. The fresh set naming something that can never mint a
//    record would be a launchable window with no address to call home from —
//    `freshCall` would open it and the callback could carry no garden id.
// ---------------------------------------------------------------------------
const openableNonCitizens = [...fresh].filter((b) => !(META_CITIZEN_BACKENDS as readonly string[]).includes(b));
ok(
	"[QK:ADMISSION-FRESH-IS-CITIZEN] every fresh-openable backend is also a citizen backend — opening a harness that cannot mint a record would produce a window with no address to call back from. Offenders: " +
		(openableNonCitizens.length === 0 ? "none" : openableNonCitizens.join(", ")),
	openableNonCitizens.length === 0,
);

console.log(`[check-harness-admission-parity] ${passed} assertions ok`);
