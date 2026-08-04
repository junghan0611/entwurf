/**
 * check-mux-placement — deterministic gate for the T0-b placement primitives
 * (`pi-extensions/lib/mux-placement.ts`).
 *
 * Scope discipline: this gate pins ONLY what is decidable without tmux — the context
 * precondition, the selector grammar, the argv shapes, the parse, the run-status
 * classification, and the close classification. It does not simulate tmux. There is no fake
 * tmux anywhere in this repo, on purpose: a fake would have written the contract before the
 * real thing was measured, which is exactly how the first mux attempt (2026-08-02) shipped
 * the wrong unit. The topology facts — one session throughout, 1,2 → 1,2,3 → 1,2,3,4 → 1,2,
 * surviving pids, unchanged focus, and the context-binding refusals — are judged by
 * `./run.sh check-mux-placement-tmux`, which drives THIS production code against a real
 * private tmux server.
 *
 * Each claim carries its QK token on exactly ONE assertion (the mutant signature must be
 * unique in this file), and that assertion states the whole invariant. The assertions around
 * it explain the invariant without re-emitting the token.
 *
 *   MUX-ANCHOR-REQUIRED      both TMUX and TMUX_PANE are required before anything runs
 *   MUX-SELECTOR-NATIVE-ID   every -t selector is a native id, validated before tmux runs
 *   MUX-ANCHOR-ECHO-BACK     tmux's rc=0 is not evidence; the pane id must echo back
 *   MUX-TMUX-FAILURE-LOUD    a nonzero/signalled tmux run is raised, never read as a fact
 *   MUX-APPEND-END-DETACHED  append is `-d -a -t <session_id>:{end}`, no carrier
 *   MUX-CONTEXT-BOUND-MUTATION a mutation matches the server pid AND the session id
 *   MUX-CLOSE-BY-WINDOW-ID   close targets `@window`, and absence needs positive proof
 */

import assert from "node:assert/strict";
import {
	APPEND_FORMAT,
	assertTmuxOk,
	buildAppendArgs,
	buildCloseArgs,
	buildInspectArgs,
	buildListWindowIdsArgs,
	classifyCloseFailure,
	INSPECT_FORMAT,
	isDecimal,
	isPaneId,
	isSameContext,
	isSessionId,
	isWindowId,
	parsePlacement,
	parseWindowFields,
	readAnchor,
} from "../pi-extensions/lib/mux-placement.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const SERVER = "/tmp/tmux-1000/default,8150,11";
const ANCHOR = "%14";
const ROW = ["8150", "$11", "@14", "2", "%14", "74235"].join("|");

/**
 * Every environment that is NOT a usable tmux context. `TMUX_PANE` alone is the dangerous
 * one: a bare `tmux` with no `TMUX` in the environment resolves to the DEFAULT server, so a
 * stale pane id would have been applied to the operator's live server.
 */
const NOT_A_CONTEXT: NodeJS.ProcessEnv[] = [
	{},
	{ TMUX_PANE: ANCHOR },
	{ TMUX_PANE: ANCHOR, TMUX: "" },
	{ TMUX: SERVER },
	{ TMUX: SERVER, TMUX_PANE: "" },
];

/** Selectors that must never reach tmux's parser. */
const HOSTILE_SELECTORS = ["%1; kill-server", "@1 ; kill-server", "$1;", "#{pane_id}", "#(id)", "1", "%", "", "%1\n"];

function main(): void {
	// ── the caller must be inside tmux, with BOTH variables ──────────────────────────
	ok(
		"[QK:MUX-ANCHOR-REQUIRED] a usable anchor needs BOTH a non-empty TMUX and a non-empty TMUX_PANE — TMUX_PANE alone would let a bare tmux resolve to the DEFAULT server",
		NOT_A_CONTEXT.every((env) => {
			const r = readAnchor(env);
			return r.ok === false && r.reason === "no-tmux-context";
		}),
	);
	ok(
		"anchor: with both present, TMUX_PANE is the anchor verbatim and TMUX is never parsed",
		(() => {
			const r = readAnchor({ TMUX: SERVER, TMUX_PANE: ANCHOR });
			return r.ok === true && r.anchor === ANCHOR;
		})(),
	);
	ok(
		"anchor: a present-but-malformed TMUX_PANE is anchor-malformed, not a context problem",
		(() => {
			const r = readAnchor({ TMUX: SERVER, TMUX_PANE: "%1; kill-server" });
			return r.ok === false && r.reason === "anchor-malformed";
		})(),
	);

	// ── selectors are native ids, checked BEFORE tmux runs ───────────────────────────
	// T0-a measured that tmux reinterprets values it is handed (a trailing `;` can split a
	// command, `#{…}`/`#(…)` expand), so "we passed argv, not a shell string" is not on its
	// own a safety argument. The grammar is the argument.
	ok(
		"[QK:MUX-SELECTOR-NATIVE-ID] every builder refuses a non-native selector BEFORE invoking tmux — no `;`, no `#{}`/`#()`, no bare index, no newline",
		HOSTILE_SELECTORS.every((s) => {
			let refusedInspect = false;
			let refusedAppend = false;
			let refusedClose = false;
			try {
				buildInspectArgs(s);
			} catch {
				refusedInspect = true;
			}
			try {
				buildAppendArgs(s);
			} catch {
				refusedAppend = true;
			}
			try {
				buildCloseArgs(s);
			} catch {
				refusedClose = true;
			}
			return refusedInspect && refusedAppend && refusedClose;
		}),
	);
	ok(
		"grammar: %N / $N / @N / decimal are the entire accepted vocabulary",
		isPaneId("%14") &&
			!isPaneId("@14") &&
			isSessionId("$11") &&
			!isSessionId("11") &&
			isWindowId("@14") &&
			!isWindowId("%14") &&
			isDecimal("74235") &&
			!isDecimal("7 4"),
	);
	ok(
		"grammar: each builder accepts only its OWN id kind",
		(() => {
			const wrongKind = [() => buildInspectArgs("$11"), () => buildAppendArgs("@14"), () => buildCloseArgs("%14")];
			return wrongKind.every((f) => {
				try {
					f();
					return false;
				} catch {
					return true;
				}
			});
		})(),
	);

	// ── rc=0 is not evidence ─────────────────────────────────────────────────────────
	// Measured against real tmux 3.6a: `display-message` on a nonexistent pane exits 0, and
	// an EMPTY target exits 0 while answering about the CURRENT pane. Worse, a nonexistent
	// target still fills the SERVER field and leaves the rest empty — so the row is non-empty
	// and would pass a naive "did we get output?" test.
	ok(
		"[QK:MUX-ANCHOR-ECHO-BACK] a row whose pane_id is not the anchor is never accepted: empty, server-only, short, malformed-field and other-pane rows all refuse",
		(() => {
			const cases: Array<[string, string]> = [
				[ANCHOR, ""],
				[ANCHOR, "8150|||||"],
				[ANCHOR, "8150|$11|@14"],
				[ANCHOR, `8150|nope|@14|2|${ANCHOR}|74235`],
				["%13", ROW],
			];
			return cases.every(([anchor, stdout]) => parsePlacement(anchor, stdout).ok === false);
		})(),
	);
	ok(
		"echo-back: an unresolvable row is `anchor-unresolved`, a foreign row is `anchor-mismatch`",
		(() => {
			const unresolved = parsePlacement(ANCHOR, "8150|||||");
			const mismatch = parsePlacement("%13", ROW);
			return (
				unresolved.ok === false &&
				unresolved.reason === "anchor-unresolved" &&
				mismatch.ok === false &&
				mismatch.reason === "anchor-mismatch"
			);
		})(),
	);
	ok(
		"echo-back: an exact match yields the native facts",
		(() => {
			const r = parsePlacement(ANCHOR, `${ROW}\n`);
			return (
				r.ok === true &&
				r.placement.serverPid === "8150" &&
				r.placement.sessionId === "$11" &&
				r.placement.windowId === "@14" &&
				r.placement.paneId === ANCHOR &&
				r.placement.panePid === "74235"
			);
		})(),
	);
	ok(
		"echo-back: the machine row carries native ids only — no free-form name or path that a `|` could split",
		!INSPECT_FORMAT.includes("session_name") &&
			!INSPECT_FORMAT.includes("socket_path") &&
			INSPECT_FORMAT.includes("#{pane_id}") &&
			INSPECT_FORMAT.includes("#{session_id}"),
	);
	ok(
		"echo-back: the query is anchored on the caller's pane",
		buildInspectArgs(ANCHOR).join(" ") === `display-message -p -t ${ANCHOR} ${INSPECT_FORMAT}`,
	);

	// ── a failed tmux call is a failure, not a fact ───────────────────────────────────
	// rc=0 not being proof of existence does NOT make a nonzero exit ignorable. "no server
	// running", EACCES and a usage error must surface as themselves — reading them as
	// "the anchor did not resolve" would report a missing pane when tmux never answered.
	ok(
		"[QK:MUX-TMUX-FAILURE-LOUD] a nonzero exit and a signal kill both raise, carrying status and stderr; only rc=0 is allowed through to be parsed",
		(() => {
			let nonzero = false;
			let signalled = false;
			try {
				assertTmuxOk("display-message", { status: 1, stdout: "", stderr: "no server running on /tmp/x" });
			} catch (err) {
				nonzero = err instanceof Error && err.message.includes("exit 1") && err.message.includes("no server running");
			}
			try {
				assertTmuxOk("kill-window", { status: null, stdout: "", stderr: "" });
			} catch (err) {
				signalled = err instanceof Error && err.message.includes("terminated by signal");
			}
			let passedThrough = true;
			try {
				assertTmuxOk("display-message", { status: 0, stdout: ROW, stderr: "" });
			} catch {
				passedThrough = false;
			}
			return nonzero && signalled && passedThrough;
		})(),
	);

	// ── a handle belongs to one server AND one session ───────────────────────────────
	// A restarted tmux server hands out `$0` again, and one server holds many sessions. So a
	// mutation must match BOTH halves before it runs; either half alone would let an env
	// naming a different (or restarted) server redirect the operation to a same-named id the
	// caller never looked at. The wiring — re-reading the placement before every mutation —
	// is proven against real tmux by check-mux-placement-tmux.
	ok(
		"[QK:MUX-CONTEXT-BOUND-MUTATION] a context matches only when the server pid AND the session id both match — either half alone accepts a foreign server or a foreign session",
		(() => {
			const origin = { serverPid: "8150", sessionId: "$11" };
			return (
				isSameContext(origin, { serverPid: "8150", sessionId: "$11" }) &&
				!isSameContext(origin, { serverPid: "9999", sessionId: "$11" }) &&
				!isSameContext(origin, { serverPid: "8150", sessionId: "$12" }) &&
				!isSameContext(origin, { serverPid: "9999", sessionId: "$12" })
			);
		})(),
	);
	ok(
		"binding: a window handle carries the context it was born in",
		(() => {
			const h = { serverPid: "8150", sessionId: "$11", windowId: "@2", windowIndex: "3", paneId: "%2", panePid: "1" };
			return isSameContext(h, { serverPid: h.serverPid, sessionId: h.sessionId });
		})(),
	);

	// ── append shape ─────────────────────────────────────────────────────────────────
	// `-a … :{end}` is append; a bare `new-window` takes the lowest FREE index, which is a
	// different verb and not this contract. The carrier stays shut: a caller-supplied
	// command, cwd, window name, or label would hand tmux's own parser a value we did not
	// author.
	const appendArgs = buildAppendArgs("$11");
	ok(
		"[QK:MUX-APPEND-END-DETACHED] append is exactly `new-window -d -a -t <session_id>:{end} -P -F <handle format>` — detached, at the end, by session id, with no carrier",
		appendArgs.join(" ") === `new-window -d -a -t $11:{end} -P -F ${APPEND_FORMAT}`,
	);
	ok(
		"append: no -n/-c/-e/-b carrier and no shell-command positional (default shell only)",
		!["-n", "-c", "-e", "-b"].some((f) => appendArgs.includes(f)) &&
			appendArgs.length === 8 &&
			appendArgs[appendArgs.length - 1] === APPEND_FORMAT,
	);
	ok(
		"append: the printed handle is @window/%pane, not an index alone",
		APPEND_FORMAT.includes("#{window_id}") && APPEND_FORMAT.includes("#{pane_id}"),
	);
	ok(
		"append: the reported handle parses to stable ids",
		(() => {
			const h = parseWindowFields("@2|3|%2|76957\n");
			return h.windowId === "@2" && h.paneId === "%2" && h.windowIndex === "3" && h.panePid === "76957";
		})(),
	);
	assert.throws(() => parseWindowFields(""), /did not report a window handle/, "a silent new-window must fail loud");
	assert.throws(
		() => parseWindowFields("w2|3|%2|76957"),
		/non-native handle/,
		"a non-native handle must fail loud rather than be carried",
	);
	ok("append: a handle-less or non-native new-window report fails loud", true);

	// ── close shape + absence needs proof ────────────────────────────────────────────
	// remain-on-exit off (measured in T0-a): a runtime's own exit can remove the window
	// first. That is a race, not an error — but `already-gone` is only honest when the
	// window is provably NOT in the inventory.
	ok(
		"[QK:MUX-CLOSE-BY-WINDOW-ID] close targets the stable @window and `already-gone` requires positive absence — a still-listed window yields no outcome at all",
		buildCloseArgs("@3").join(" ") === "kill-window -t @3" &&
			classifyCloseFailure("@3", "@0\n@1\n") === "already-gone" &&
			classifyCloseFailure("@3", "@0\n@1\n@3\n") === null,
	);
	ok(
		"close: the absence proof lists window ids server-wide",
		buildListWindowIdsArgs().join(" ") === "list-windows -a -F #{window_id}",
	);
	ok("close: an empty inventory is still positive absence", classifyCloseFailure("@3", "") === "already-gone");
	ok(
		"close: a prefix is not the handle — @30 present does not prove @3 absent, and does prove @30 present",
		classifyCloseFailure("@3", "@30\n") === "already-gone" && classifyCloseFailure("@30", "@30\n") === null,
	);

	console.log(`\ncheck-mux-placement: ${passed} checks passed`);
}

main();
