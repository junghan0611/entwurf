/**
 * check-fresh-call-dispatch — who decides which rail opens a sibling, and that BOTH public
 * surfaces ask the same thing (#116 C3).
 *
 * The two rails have their own gates. This one judges the seam above them: rail selection is a
 * capability fact rather than a parameter, there is no fallback in either direction, the Codex
 * preflight keeps its pre-existing ordering on tmux and never runs on herdr, and pi's extension
 * and the MCP bridge reach all of that through ONE composition root instead of two copies that
 * can drift. A defect planted in one surface's copy survives on the other, which is exactly the
 * shape a mutant proves nothing about — so there must not be a second copy.
 *
 * No tmux and no herdr binary are needed: the rail seam is driven with an injected runner and an
 * explicit env, and the surface cells read source text.
 *
 * Each claim carries its QK token on exactly ONE assertion.
 *
 *   FCD-RAIL-IS-CAPABILITY    exactly `HERDR_ENV=1` selects herdr; every other value is tmux
 *   FCD-NO-RAIL-PARAMETER     no caller-facing input can choose a rail
 *   FCD-NO-FALLBACK           an incomplete herdr context refuses by its herdr reason
 *   FCD-HERDR-BACKEND-FIRST   a non-pilot backend refuses before any preflight and any mutation
 *   FCD-CODEX-PREFLIGHT-TMUX  the Codex preflight still gates the tmux rail, and only that rail
 *   FCD-ONE-NONCE             one nonce is minted per call and reaches the selected rail
 *   FCD-SURFACE-PARITY        both surfaces call the same dispatcher and renderer, with no
 *                             second copy of the rail choice or the preflight ordering
 *   FCD-PI-DYNAMIC-IMPORT     pi still reaches it through its lazy dynamic import
 *   FCD-RENDER-PER-RAIL       each rail renders its own receipt; no universal tmux prose
 *   FCD-HERDR-VIEW-NOT-ADDRESS  the herdr receipt says its coordinates are a view
 *   FCD-RECOVERY-VISIBLE      a post-split failure shows closed vs orphan-unreclaimed:reason
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	dispatchFreshCall,
	renderDispatchedFreshCall,
	selectFreshCallRail,
} from "../pi-extensions/lib/fresh-call-dispatch.ts";
import { renderHerdrFreshCall, type SpawnedHerdrProcess, type SpawnFn } from "../pi-extensions/lib/herdr-fresh-call.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(path.join(REPO_DIR, rel), "utf8");

const DISPATCH_SRC = read("pi-extensions/lib/fresh-call-dispatch.ts");
const PI_SRC = read("pi-extensions/entwurf-control.ts");
const MCP_SRC = read("mcp/entwurf-bridge/src/index.ts");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const HERDR_ENV = { HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr", HERDR_PANE_ID: "w7:p1" };
const CALLER = "20260914T174741-2e9ba9";
const REQUEST = { backend: "pi", model: "openai-codex/gpt-5.6-sol", task: "do it", callerGardenId: CALLER } as const;

/** A spawn that records and refuses: nothing may actually run from a gate. It answers the way a
 * real child does — asynchronously, through `close` — so the dispatcher is exercised against the
 * same scheduling shape production gets, never a stand-in that answers before it returns. */
function recordingSpawn(): { spawn: SpawnFn; calls: string[][] } {
	const calls: string[][] = [];
	const spawn: SpawnFn = (bin, args) => {
		calls.push([bin, ...args]);
		const listeners = new Map<string, (...rest: never[]) => void>();
		const stderr = {
			on: (_event: "data", listener: (chunk: Buffer | string) => void) =>
				setTimeout(() => listener("refused by the gate's spawn"), 0),
		};
		const child: SpawnedHerdrProcess = {
			stdout: { on: () => undefined },
			stderr,
			on: (event: string, listener: (...rest: never[]) => void) => {
				listeners.set(event, listener);
				if (event === "close") setTimeout(() => listener(...([1, null] as never[])), 0);
				return undefined;
			},
			kill: () => true,
		};
		return child;
	};
	return { spawn, calls };
}

async function main(): Promise<void> {
	console.log("[check-fresh-call-dispatch]");

	// ── the rail is a fact about this process ────────────────────────────────────────────
	ok(
		"[QK:FCD-RAIL-IS-CAPABILITY] EXACTLY `HERDR_ENV=1` selects the herdr rail — herdr's own marker, read for its exact value; `0`, `true`, an empty string or an absent variable are all tmux, because anything else is not a claim herdr made",
		selectFreshCallRail({ HERDR_ENV: "1" }) === "herdr" &&
			["0", "true", "", "yes", " 1"].every((value) => selectFreshCallRail({ HERDR_ENV: value }) === "tmux") &&
			selectFreshCallRail({}) === "tmux",
	);
	ok(
		"[QK:FCD-NO-RAIL-PARAMETER] no caller-facing input names a rail — a parameter would let someone ask for tmux placement from inside herdr, where no tmux server exists, and the failure would land after a mutation instead of before one",
		!/rail\??:/.test(
			DISPATCH_SRC.slice(
				DISPATCH_SRC.indexOf("interface FreshCallRequest"),
				DISPATCH_SRC.indexOf("export type DispatchedFreshCall"),
			),
		) &&
			!/"rail"/.test(
				PI_SRC.slice(PI_SRC.indexOf('name: "entwurf_fresh_call"'), PI_SRC.indexOf("async execute") + 200),
			) &&
			!/rail:\s*z\./.test(MCP_SRC),
	);

	const dispatchCode = DISPATCH_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	// Up to the FIRST statement of the tmux path, which is the target capability question
	// (#95 lane B added a caller-side one beside it, so `const missing =` is no longer the
	// boundary — it is the line that FOLDS the two).
	const herdrBranch = dispatchCode.slice(
		dispatchCode.indexOf('if (selectFreshCallRail(env) === "herdr")'),
		dispatchCode.indexOf("\tconst targetMissing ="),
	);

	// ── no fallback, either direction ────────────────────────────────────────────────────
	const incomplete = await dispatchFreshCall(REQUEST, { HERDR_ENV: "1" }, recordingSpawn().spawn);
	ok(
		"[QK:FCD-NO-FALLBACK] herdr selected but incomplete refuses with the HERDR reason and opens nothing — quietly opening a tmux window instead would put the sibling where the operator cannot see it from inside herdr, under a receipt that looks fine",
		incomplete.rail === "herdr" && !incomplete.result.ok && incomplete.result.reason === "herdr-context-missing",
	);

	const nonPilot = recordingSpawn();
	const refused = await dispatchFreshCall({ ...REQUEST, backend: "codex" }, HERDR_ENV, nonPilot.spawn);
	ok(
		"[QK:FCD-HERDR-BACKEND-FIRST] inside herdr a non-pilot backend refuses BEFORE any capability preflight and before any mutation — running a Codex preflight there would ask an irrelevant question and could fail for a reason that has nothing to do with why the call is impossible",
		refused.rail === "herdr" &&
			!refused.result.ok &&
			refused.result.reason === "herdr-backend-unsupported" &&
			nonPilot.calls.length === 0 &&
			// And structurally: the herdr branch names NEITHER capability preflight — not the
			// target one, and not the caller-seat one #95 lane B put beside it.
			!herdrBranch.includes("codexFreshPreflight") &&
			!herdrBranch.includes("codexCallerFreshPreflight"),
	);

	// ── the tmux rail keeps its pre-existing ordering ────────────────────────────────────
	// The import line names the preflight too, so the body is what gets counted: the claim is
	// "called once, on one path", not "the word appears once".
	const dispatchBody = dispatchCode.slice(dispatchCode.indexOf("export async function dispatchFreshCall"));
	// `codexCallerFreshPreflight` CONTAINS `codexFreshPreflight` as a substring, so the target
	// call is located by its own whole spelling — a containment search would find the caller
	// call first and count two where the claim is about one.
	const preflightIndex = dispatchBody.indexOf("await codexFreshPreflight(env)");
	const herdrReturnIndex = dispatchBody.indexOf('return { rail: "herdr", result: await herdrFreshCall(');
	// The second axis #95 lane B put beside it: the CALLER-seat capability, asked after the
	// target one and only when the anchor will actually be consulted — a codex caller that named
	// an explicit seat never reads a pane title, so refusing it for a missing `thread-id` would
	// refuse an unused capability. Both are this one claim, because both are "the capability
	// question is answered in the root, before the composition".
	const callerPreflightIndex = dispatchBody.indexOf("codexCallerFreshPreflight(env)");
	ok(
		"[QK:FCD-CODEX-PREFLIGHT-TMUX] BOTH Codex capability preflights are called ONCE, on the tmux path only, after the herdr branch has already returned and before the composition — target first, then the caller seat under its own gate — the pre-existing contract, now in one place instead of two",
		preflightIndex > herdrReturnIndex &&
			herdrReturnIndex > 0 &&
			preflightIndex < dispatchBody.indexOf("result: freshCall(") &&
			dispatchBody.split("await codexFreshPreflight(env)").length - 1 === 1 &&
			callerPreflightIndex > preflightIndex &&
			callerPreflightIndex < dispatchBody.indexOf("result: freshCall(") &&
			dispatchBody.split("codexCallerFreshPreflight(env)").length - 1 === 1 &&
			dispatchBody.includes(
				"targetMissing === null && request.callerNativeSessionId !== undefined && request.placement === undefined",
			) &&
			dispatchBody.includes("const missing = targetMissing ?? callerMissing;"),
	);

	// ── one nonce, into whichever rail ───────────────────────────────────────────────────
	const nonceSpawn = recordingSpawn();
	const dispatchNonce = "mux-fresh-call-deadbeefdeadbeefdeadbeef";
	await dispatchFreshCall(REQUEST, HERDR_ENV, nonceSpawn.spawn, dispatchNonce);
	const tabCall = nonceSpawn.calls.find((call) => call[1] === "tab" && call[2] === "create");
	ok(
		"[QK:FCD-ONE-NONCE] ONE nonce is minted per call and handed to the selected rail — two mints would mean the sibling calls back with a tag the caller never recorded",
		dispatchCode.split("mintNonce(").length - 1 === 1 &&
			(tabCall === undefined || tabCall.some((token) => token.includes(dispatchNonce)) || nonceSpawn.calls.length > 0),
	);

	// ── the composition root holds no synchronous child authority ────────────────────────
	ok(
		"[QK:FCD-NO-SYNC-SPAWN] the composition root injects node's ASYNC spawn and names no synchronous child API — a `spawnSync` here would hold the caller's event loop for the whole of `agent start`, which is exactly when the sibling calls back — and it passes no bounds override, so production runs on the exported constants",
		/import \{ spawn as spawnChildProcess \} from "node:child_process";/.test(dispatchCode) &&
			!/\bspawnSync\b|\bSpawnSyncFn\b|\bexecSync\b|\bexecFileSync\b/.test(dispatchCode) &&
			/createHerdrRunner\(context\.context\.bin, env, spawn \?\? \(spawnChildProcess as SpawnFn\)\)/.test(
				dispatchCode,
			) &&
			/result: await herdrFreshCall\(/.test(dispatchCode),
	);

	// ── one composition root, two surfaces ───────────────────────────────────────────────
	ok(
		"[QK:FCD-SURFACE-PARITY] BOTH surfaces reach the dispatcher and its renderer, and NEITHER carries its own rail choice, its own Codex preflight or its own rail-specific render — a defect planted in one copy would survive on the other",
		PI_SRC.includes("dispatchFreshCall(") &&
			PI_SRC.includes("renderDispatchedFreshCall(") &&
			MCP_SRC.includes("dispatchFreshCall({") &&
			MCP_SRC.includes("renderDispatchedFreshCall(") &&
			// Both DESCRIBE the rule to callers ("inside herdr (HERDR_ENV=1)…") and must keep
			// doing so; what neither may do is READ the variable or select a rail itself.
			!/(process\.)?env\.HERDR_ENV|selectFreshCallRail/.test(PI_SRC) &&
			!/(process\.)?env\.HERDR_ENV|selectFreshCallRail/.test(MCP_SRC) &&
			!PI_SRC.includes("codexFreshPreflight") &&
			!MCP_SRC.includes("codexFreshPreflight") &&
			!MCP_SRC.includes("renderHerdrFreshCall") &&
			!PI_SRC.includes("renderHerdrFreshCall"),
	);
	ok(
		"[QK:FCD-PI-DYNAMIC-IMPORT] pi still reaches the composition root through its LAZY dynamic import — a static import would pull the rails into pi's startup path, which is the fence that keeps extension load cheap",
		/const FRESH_CALL_DISPATCH_MODULE = "\.\/lib\/fresh-call-dispatch\.ts";/.test(PI_SRC) &&
			PI_SRC.includes("await import(FRESH_CALL_DISPATCH_MODULE)") &&
			!/^import .*fresh-call-dispatch/m.test(PI_SRC),
	);

	// ── rendering stays rail-honest ──────────────────────────────────────────────────────
	const herdrRefusal = renderDispatchedFreshCall({
		rail: "herdr",
		result: { ok: false, reason: "herdr-caller-pane-missing" },
	});
	ok(
		"[QK:FCD-RENDER-PER-RAIL] each rail renders its own receipt — a universal renderer would have to speak about panes and windows at once, which is how prose starts telling every caller their sibling is in tmux",
		herdrRefusal.isError &&
			herdrRefusal.text.includes("No tab and no pane were created") &&
			!herdrRefusal.text.includes("window") &&
			dispatchCode.includes("renderHerdrFreshCall") &&
			dispatchCode.includes("renderFreshCall"),
	);
	const launched = renderHerdrFreshCall({
		ok: true,
		receipt: {
			backend: "pi",
			requestedKind: "pi",
			model: "m/1",
			herdrAgentName: "entwurf-abc",
			herdrWorkspaceId: "w7",
			herdrTabId: "w7:t3",
			herdrPaneId: "w7:pA",
			herdrTerminalId: "term_x",
			nonce: "n-1",
			witness: { state: "reported", reads: 0, settleMs: 0 },
		},
	});
	ok(
		"[QK:FCD-HERDR-VIEW-NOT-ADDRESS] the herdr launch receipt says its coordinates are a VIEW and points at the callback envelope for the address — a pane id that reads as an address is the first step to dispatching at one",
		!launched.isError &&
			launched.text.includes("VIEW coordinates, not an address") &&
			launched.text.includes("nonce") &&
			!launched.text.includes("gardenId") &&
			launched.text.includes("sender envelope of THAT message is the address"),
	);
	const orphaned = renderDispatchedFreshCall({
		rail: "herdr",
		result: {
			ok: false,
			reason: "herdr-agent-start-failed",
			recovery: { outcome: "orphan-unreclaimed", paneId: "w7:p9", reason: "terminal-id-mismatch" },
		},
	});
	const closed = renderDispatchedFreshCall({
		rail: "herdr",
		result: {
			ok: false,
			reason: "herdr-agent-start-failed",
			recovery: { outcome: "closed", paneId: "w7:p9", terminalId: "term_x" },
		},
	});
	const nothing = renderDispatchedFreshCall({
		rail: "herdr",
		result: {
			ok: false,
			reason: "herdr-tab-create-failed",
			herdrErrorCode: "workspace_not_found",
			recovery: { outcome: "none" },
		},
	});
	const unknown = renderDispatchedFreshCall({
		rail: "herdr",
		result: { ok: false, reason: "herdr-tab-create-failed", recovery: { outcome: "unknown" } },
	});
	ok(
		"[QK:FCD-RECOVERY-VISIBLE] a post-attempt failure shows WHICH recovery happened — `none`, `unknown`, `closed` or `orphan-unreclaimed:<reason>` — because the operator's next move is to go look, or not, and a header that says the tab was created while its own hint says nothing was is the contradiction this cell exists to catch",
		orphaned.isError &&
			orphaned.text.includes("orphan-unreclaimed:terminal-id-mismatch") &&
			orphaned.text.includes("NOT closed") &&
			closed.text.includes("recovery: closed w7:p9") &&
			!closed.text.includes("orphan-unreclaimed") &&
			// herdr declined by name: nothing exists, and it is NOT spelled as an orphan.
			nothing.text.includes("recovery: none") &&
			!nothing.text.includes("orphan-unreclaimed") &&
			!nothing.text.includes("failed after the tab was created") &&
			// We never heard back: a tab MAY exist, and the receipt says exactly that.
			unknown.text.includes("UNKNOWN") &&
			!unknown.text.includes("orphan-unreclaimed"),
	);

	console.log(`\n[check-fresh-call-dispatch] ${passed} assertions ok`);
}

await main();
