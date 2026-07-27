/**
 * check-entwurf-v2-surface — deterministic gate for the 5d-3a surface adapter
 * (`entwurf-v2-surface.ts`) + the `entwurf-control.ts` wiring contract. It proves the PURE
 * parts (the rest — production assembly — is check-entwurf-v2-production + the 5d-5 matrix):
 *
 *   1. toDispatchInput — `wants_reply`→`wantsReply` (snake→camel), `intent`/`message`/`target`
 *      pass through, absent `mode`/`wants_reply` stay undefined (decider defaults, no double).
 *   2. renderEntwurfV2Result — each result kind → the right `{ text, isError }`, surfacing the
 *      carry-overs: reject reason + target-locked diagnostic / control N3 rejectReason /
 *      spawn lock-retained diagnostic / N1 delivered-but-lock-dirty.
 *   3. surface source guard — `entwurf-v2-surface.ts` is ctx-free (no ExtensionContext/API).
 *   4. control wiring guard — `entwurf-control.ts` registers `entwurf_v2`, reaches the fence
 *      ONLY via a NON-LITERAL dynamic import (a string-const specifier), NEVER a static import
 *      of the fence v2 modules (which would break the emit-capable root tsc with TS5097), and
 *      decorates the sender as `origin:"pi-session"` with HONEST replyability (SE-1 2e-a:
 *      computeSelfAddressability + socket existsSync, not a hardcoded `replyable:true`).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EntwurfV2RunResult } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import {
	actionableRejectHint,
	ENTWURF_PREFIX_ROOTS_ENV,
	parseEntwurfPrefixRootsEnv,
	renderEntwurfV2Result,
	type SurfaceEntwurfV2Params,
	toDispatchInput,
} from "../pi-extensions/lib/entwurf-v2-surface.ts";

/** Cut ONE model-facing string out of a registration block so two descriptions in the same
 * block cannot satisfy an assertion for each other (round-4 masking, 2026-07-27). Returns ""
 * when either marker is missing, which the callers' `length > 120` guard turns into a loud
 * failure rather than a silent pass. */
function sliceDescription(block: string, startMarker: string, endMarker: string): string {
	const s = block.indexOf(startMarker);
	if (s === -1) return "";
	const e = block.indexOf(endMarker, s + startMarker.length);
	return e === -1 ? "" : block.slice(s, e);
}

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/**
 * Collapse a model-facing string's SOURCE form into the text the model actually reads:
 * drop TS string-concat glue between adjacent literals and normalize whitespace.
 */
function modelText(slice: string): string {
	return slice
		.replace(/["']\s*\+\s*["']/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * F-2 (2026-07-27): the two model-facing surfaces described the lock, `mode`, and the
 * unsupported-citizen outcome set in ways the code does not support. Measured against
 * source, not prose:
 *  - LOCK: `entwurf-v2-decider.ts` returns a held claim ONLY on the control-socket-domain
 *    branch — and that branch covers the live send AND the dormant cell's spawn-bg resume.
 *    The mailbox and native-push branches both carry `lock: null`. "socket paths take a
 *    per-target lock" read as "the socket transport locks", which got spawn-bg (a SEPARATE
 *    relaunch transport that nonetheless locks) and native-push (a live send that does NOT)
 *    exactly backwards.
 *  - MODE: `mode` exists on exactly ONE ExecutionPlan variant, `control-socket`. The
 *    meta-mailbox and native-push plans have no such field and spawn-bg says so in a comment.
 *    "mode applies to a live send" is false for native-push, which IS a live send.
 *  - THIRD RESULT: `resolveDispatch` downgrades the unsupported fire-and-forget cell to
 *    `mailbox-undeliverable` when the separate deliverability fact is false, so an
 *    `unsupported` citizen has THREE outcomes (mailbox / native-push / reject), not two.
 *
 * Applied to BOTH surfaces from one predicate so they cannot drift apart again.
 */
function assertRailSemantics(tag: string, longDescRaw: string, intentDescRaw: string, modeDescRaw: string): void {
	// Compare the text the MODEL reads, not the shape the author happened to type. pi-native
	// wraps inside one template literal; the MCP surface wraps by `+`-concatenating literals.
	// Without this normalization the same sentence matches on one surface and not the other,
	// and the assertion silently measures line-wrapping instead of meaning.
	const longDesc = modelText(longDescRaw);
	const intentDesc = modelText(intentDescRaw);
	const modeDesc = modelText(modeDescRaw);
	ok(
		`${tag} — long description scopes the per-target lock to the control-socket DOMAIN [QK:V2SURF-MCP-LOCK-DOMAIN]`,
		/control-socket-DOMAIN\s+dispatch/.test(longDesc) && /lock-free/.test(longDesc),
	);
	ok(
		`${tag} — long description says spawn-bg ALSO runs under that domain's lock`,
		/spawn-bg/.test(longDesc) && /still runs under that domain's lock/.test(longDesc),
	);
	ok(
		`${tag} — long description says the mailbox AND native-push rails are lock-free`,
		/mailbox and native-push rails are lock-free/.test(longDesc),
	);
	// NEGATIVE (exact false sentence): the shipped wording, whitespace-tolerant because the
	// pi-native template literal wrapped it across a newline.
	ok(
		`${tag} — long description no longer says "socket paths … per-target lock"`,
		!/socket\s+paths\s+(take a )?per-target lock/.test(longDesc),
	);
	ok(`${tag} — long description scopes mode to a CONTROL-SOCKET send`, /CONTROL-SOCKET send/.test(longDesc));
	// NEGATIVE (exact false sentence), both shipped spellings.
	ok(
		`${tag} — long description no longer applies mode to "a live send"`,
		!/\bfor a live send\b/.test(longDesc) && !/mode\/wants_reply apply to a live send/.test(longDesc),
	);
	ok(
		`${tag} — long description names the THIRD result for an unsupported citizen`,
		/mailbox-undeliverable/.test(longDesc) && /THIRD RESULT/.test(longDesc),
	);
	ok(
		`${tag} — intent param names a rail's reject, not only its allow cell`,
		/mailbox-undeliverable/.test(intentDesc) && /native-push-target-dead/.test(intentDesc),
	);
	// The native-push probe is THREE-valued (NATIVE_PUSH_DISPATCH_TABLE): alive / dead /
	// indeterminate. Both surfaces collapsed it to two and labelled indeterminate as dead —
	// reporting an unestablished probe as a measured death. Presence of both reason names is
	// not enough: they must sit next to the liveness they belong to, or a text can list both
	// names while still mapping them the wrong way round. So require ADJACENCY — the liveness
	// word appears in the run of text immediately preceding its reason.
	const adjacent = (text: string, liveness: string, reason: string): boolean => {
		const at = text.indexOf(reason);
		if (at < 0) return false;
		return new RegExp(`\\b${liveness}\\b`, "i").test(text.slice(Math.max(0, at - 90), at));
	};
	for (const [which, text] of [
		["long description", longDesc],
		["intent param", intentDesc],
	] as const) {
		ok(
			`${tag} — ${which} keeps the native-push probe 3-valued (dead ≠ indeterminate)`,
			/native-push-target-dead/.test(text) && /native-push-probe-indeterminate/.test(text),
		);
		ok(
			`${tag} — ${which} maps dead→native-push-target-dead and indeterminate→native-push-probe-indeterminate (adjacency, not just presence)`,
			adjacent(text, "dead", "native-push-target-dead") &&
				adjacent(text, "indeterminate", "native-push-probe-indeterminate"),
		);
	}
	ok(`${tag} — mode param is isolated (non-vacuous)`, modeDesc.length > 60);
	ok(
		`${tag} — mode param scopes itself to a CONTROL-SOCKET send and denies the other rails [QK:V2SURF-PI-MODE-SCOPE]`,
		/CONTROL-SOCKET send/.test(modeDesc) && /no mode/.test(modeDesc),
	);
	ok(
		`${tag} — mode param no longer calls itself "Delivery mode for a live send"`,
		!/Delivery mode for a live send/.test(modeDesc) && !/\bfor a live send\b/.test(modeDesc),
	);
}

/**
 * Containment-disjointness is NOT enough to prove a description slice is tight. Round 5
 * (2026-07-27) shipped a "long description" slice of 4,468 chars that SPANNED the parameter
 * entries because a bare `description:` marker matched the `target` param first — and two
 * over-wide slices can still be mutually non-containing. So pin the ABSENCE of every
 * parameter marker in the long-description slice: if the slice ever swallows the schema
 * again, this fails instead of silently satisfying the schema's own text.
 */
function assertLongDescExcludesParams(tag: string, longDesc: string, markers: readonly string[]): void {
	for (const marker of markers) {
		ok(`${tag} — long description slice excludes the \`${marker}\` parameter marker`, !longDesc.includes(marker));
	}
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const SURFACE_SRC = path.join(REPO, "pi-extensions/lib/entwurf-v2-surface.ts");
const CONTROL_SRC = path.join(REPO, "pi-extensions/entwurf-control.ts");
const MCP_SRC = path.join(REPO, "mcp/entwurf-bridge/src/index.ts");

const GID = "20260613T100000-aaaaaa";
const SUCCESS_RECEIPT = {
	ok: true as const,
	action: "send" as const,
	transport: "control-socket" as const,
	ownership: "ack-only" as const,
	observedLiveness: "alive" as const,
};

async function main(): Promise<void> {
	// ── 1: toDispatchInput mapping ────────────────────────────────────────────
	{
		const full: SurfaceEntwurfV2Params = {
			target: GID,
			intent: "owned-outcome",
			message: "hi",
			mode: "steer",
			wants_reply: true,
		};
		const di = toDispatchInput(full);
		ok(
			"1: target/intent/message pass through",
			di.target === GID && di.intent === "owned-outcome" && di.message === "hi",
		);
		ok("1: wants_reply → wantsReply (snake→camel)", di.wantsReply === true);
		ok("1: mode passes through", di.mode === "steer");

		const minimal: SurfaceEntwurfV2Params = { target: GID, intent: "fire-and-forget", message: "m" };
		const dm = toDispatchInput(minimal);
		ok("1: absent mode stays undefined (decider default)", dm.mode === undefined);
		ok("1: absent wants_reply stays undefined (no double default)", dm.wantsReply === undefined);
	}

	// ── 2: renderEntwurfV2Result per kind ─────────────────────────────────────
	{
		// reject + target-locked diagnostic
		const rejected: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "target-locked", observedLiveness: null },
			diagnostic: {
				kind: "target-locked",
				conflict: {
					reason: "target-locked",
					lockPath: "/locks/x.lock",
					holder: {
						gardenId: GID,
						pid: 999,
						hostname: "h",
						createdAt: "2026-06-13T01:00:00.000Z",
						nonce: "n",
						owner: "entwurf_v2",
						lockPath: "/locks/x.lock",
					},
					detail: "held by pid 999",
				},
			},
		};
		const rr = renderEntwurfV2Result(rejected);
		ok(
			"2: reject → isError + reason + diagnostic surfaced",
			rr.isError && rr.text.includes("target-locked") && rr.text.includes("pid 999"),
		);

		// control sent → delivered
		const sent: EntwurfV2RunResult = {
			kind: "executed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			outcome: { transport: "control-socket", outcome: "sent" },
		};
		ok(
			"2: control sent → not error",
			!renderEntwurfV2Result(sent).isError && renderEntwurfV2Result(sent).text.includes("sent"),
		);

		// control in-band rejected with N3 rejectReason → non-delivery
		const ctlReject: EntwurfV2RunResult = {
			kind: "executed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			outcome: { transport: "control-socket", outcome: "rejected", rejectReason: "dormant-fire-forget-unsupported" },
		};
		const cr = renderEntwurfV2Result(ctlReject);
		ok(
			"2: control rejected → isError + N3 rejectReason surfaced",
			cr.isError && cr.text.includes("dormant-fire-forget-unsupported"),
		);

		// spawn lock-retained → fail-closed diagnostic
		const retained: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "spawn-bg" },
			transport: "spawn-bg",
			outcome: {
				transport: "spawn-bg",
				result: {
					kind: "lock-retained",
					released: false,
					reason: "observe-failed",
					diagnostic: {
						targetGardenId: GID,
						lockPath: "/locks/x.lock",
						expectedSocketPath: "/ctl/x.sock",
						observeTimeoutMs: 30000,
						killGraceMs: 5000,
					},
				},
			},
		};
		const ret = renderEntwurfV2Result(retained);
		ok(
			"2: spawn lock-retained → isError + diagnostic surfaced",
			ret.isError && ret.text.includes("LOCK RETAINED") && ret.text.includes("/locks/x.lock"),
		);

		// spawn socket-alive → delivered
		const alive: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "spawn-bg" },
			transport: "spawn-bg",
			outcome: { transport: "spawn-bg", result: { kind: "socket-alive", released: true, pid: 7 } },
		};
		ok("2: spawn socket-alive → not error", !renderEntwurfV2Result(alive).isError);

		// meta-mailbox → enqueued
		const mailbox: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "meta-mailbox" },
			transport: "meta-mailbox",
			outcome: { transport: "meta-mailbox", success: true },
		};
		ok(
			"2: meta-mailbox → not error + enqueued",
			!renderEntwurfV2Result(mailbox).isError && renderEntwurfV2Result(mailbox).text.includes("enqueued"),
		);

		// native-push → delivered (no retry)
		const np: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "native-push" },
			transport: "native-push",
			outcome: { transport: "native-push", success: true, retried: false },
		};
		ok(
			"2: native-push → not error + delivered",
			!renderEntwurfV2Result(np).isError && renderEntwurfV2Result(np).text.includes("delivered"),
		);

		// native-push delivered after a 1-shot re-probe retry → retry note surfaced
		const npRetried: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "native-push" },
			transport: "native-push",
			outcome: { transport: "native-push", success: true, retried: true },
		};
		ok(
			"2: native-push retried → not error + retry note surfaced",
			!renderEntwurfV2Result(npRetried).isError && renderEntwurfV2Result(npRetried).text.includes("retry"),
		);

		// native-push owned reject → hint to switch to fire-and-forget
		const npReject: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "native-push-no-resume-authority", observedLiveness: "alive" },
		};
		const npRej = renderEntwurfV2Result(npReject);
		ok(
			"2: native-push-no-resume-authority → isError + fire-and-forget hint",
			npRej.isError && npRej.text.includes("fire-and-forget"),
		);

		// N1: execution-failed with finalizedOutcome + releaseFailed → delivered-but-dirty
		const n1: EntwurfV2RunResult = {
			kind: "execution-failed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			error: "release boom",
			finalizedOutcome: "sent",
			releaseFailed: true,
			retrySafe: false,
		};
		const n1r = renderEntwurfV2Result(n1);
		ok(
			"2: N1 → isError + 'do NOT retry' + DIRTY surfaced",
			n1r.isError && n1r.text.includes("DIRTY") && n1r.text.includes("do NOT retry"),
		);

		// plain execution-failed → error
		const failed: EntwurfV2RunResult = {
			kind: "execution-failed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			error: "boom",
			retrySafe: false,
		};
		ok("2: plain execution-failed → isError", renderEntwurfV2Result(failed).isError);

		// Detour B (B-a): backend-liveness-unsupported reject → still a reject (isError),
		// but the text carries the actionable "use fire-and-forget → mailbox" hint. The
		// reject stays honest (reason unchanged, no auto-convert) — only the render guides.
		const metaReject: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "backend-liveness-unsupported", observedLiveness: "unsupported" },
		};
		const mr = renderEntwurfV2Result(metaReject);
		ok(
			"2: backend-liveness-unsupported reject → isError + actionable fire-and-forget/mailbox hint",
			mr.isError &&
				mr.text.includes("backend-liveness-unsupported") &&
				mr.text.includes("fire-and-forget") &&
				mr.text.includes("mailbox"),
		);
		ok(
			"2B: actionableRejectHint guides meta-session owned → fire-and-forget mailbox",
			(actionableRejectHint("backend-liveness-unsupported") ?? "").includes("fire-and-forget"),
		);
		ok(
			"2B: actionableRejectHint guides owned-live → fire-and-forget",
			(actionableRejectHint("owned-live-no-autosend") ?? "").includes("fire-and-forget"),
		);
		ok(
			"2B: actionableRejectHint returns undefined for a reject with no next step",
			actionableRejectHint("bad-target") === undefined,
		);
		// #50 C4: the record-less-socket reject must name the TRUE cause (no record
		// claims the socket; the record is the address authority) AND the fresh-cut fix —
		// a migration-shaped state never surfaces as a bare reason code.
		const rls = actionableRejectHint("record-less-socket") ?? "";
		ok(
			"2C: record-less-socket hint names the record authority + both fixes (restart / fresh-cut)",
			rls.includes("NO meta-record claims it") &&
				rls.includes("sole address authority") &&
				rls.includes("restart it under the current runtime") &&
				rls.includes("meta-bridge-fresh-cut"),
		);
	}

	// ── 6: parseEntwurfPrefixRootsEnv (5d-4b operator-policy SSOT) ─────────────
	{
		const D = path.delimiter;
		ok("6: env name is ENTWURF_PREFIX_ROOTS", ENTWURF_PREFIX_ROOTS_ENV === "ENTWURF_PREFIX_ROOTS");
		ok("6: undefined → [] (no prefix promotion)", parseEntwurfPrefixRootsEnv(undefined).length === 0);
		ok("6: empty string → []", parseEntwurfPrefixRootsEnv("").length === 0);
		ok("6: delimiters-only → []", parseEntwurfPrefixRootsEnv(`${D}${D}`).length === 0);
		const two = parseEntwurfPrefixRootsEnv(`/repos/gh${D}/repos/work`);
		ok("6: delimiter-separated → entries", two.length === 2 && two[0] === "/repos/gh" && two[1] === "/repos/work");
		const trimmed = parseEntwurfPrefixRootsEnv(`  /a ${D} ${D} /b  `);
		ok("6: trims + drops empty segments", trimmed.length === 2 && trimmed[0] === "/a" && trimmed[1] === "/b");
		// A nonexistent/typo path is KEPT verbatim (no throw, no validation) — preflight's
		// normalize handles it, and a typo must never broaden approve nor fail the dispatch.
		const typo = parseEntwurfPrefixRootsEnv("/this/does/not/exist");
		ok("6: nonexistent path kept verbatim (no throw)", typo.length === 1 && typo[0] === "/this/does/not/exist");
	}

	// ── 3: surface source guard — ctx-free ────────────────────────────────────
	{
		const src = await fs.readFile(SURFACE_SRC, "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok("3: surface is ctx-free — no ExtensionContext", !code.includes("ExtensionContext"));
		ok("3: surface is ctx-free — no ExtensionAPI", !code.includes("ExtensionAPI"));
	}

	// ── 4: pi-native control wiring guard ─────────────────────────────────────
	{
		const src = await fs.readFile(CONTROL_SRC, "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok("4: pi-native — entwurf-control registers entwurf_v2", /name:\s*"entwurf_v2"/.test(src));
		ok(
			"4: pi-native — reaches the fence via a NON-LITERAL dynamic import (string-const specifier)",
			/const ENTWURF_V2_SURFACE_MODULE\s*=/.test(code) && /await import\(ENTWURF_V2_SURFACE_MODULE\)/.test(code),
		);
		// The whole point of the dynamic import: NO static import of the fence v2 chain into the
		// emit-capable root program (those literal `.ts` imports would be TS5097).
		ok(
			"4: pi-native — NO static import of the v2 fence (runner/production/surface) — TS5097 stays closed",
			!/import[^;]*from\s*"\.\/lib\/entwurf-v2-(runner|production|surface)\.(js|ts)"/.test(code),
		);
		// SE-1 2e-a: senderProvider decorates origin:'pi-session' but `replyable` is now an
		// HONEST fact (canonical socket existsSync via computeSelfAddressability), NOT a
		// hardcoded true. The self-address fence lib is reached through the same non-literal
		// dynamic import pattern as the v2 surface.
		ok(
			"4: pi-native — senderProvider decorates origin:'pi-session' (no hardcoded replyable:true)",
			/origin:\s*"pi-session"/.test(code) && !/replyable:\s*true/.test(code),
		);
		ok(
			"4: pi-native — replyability via computeSelfAddressability + existsSync, dynamic-imported",
			/const ENTWURF_SELF_ADDRESS_MODULE\s*=/.test(code) &&
				/await import\(ENTWURF_SELF_ADDRESS_MODULE\)/.test(code) &&
				/computeSelfAddressability/.test(code) &&
				/existsSync\(/.test(code),
		);
		ok(
			"4: pi-native — NO static import of the self-address fence (TS5097 stays closed)",
			!/import[^;]*from\s*"\.\/lib\/entwurf-self-address\.(js|ts)"/.test(code),
		);
		// Every SHIPPED rail must appear in the model-facing text. Measured 2026-07-27: both
		// surfaces described only control-socket/spawn-bg/mailbox and told the model that an
		// `unsupported` citizen is reached "→ mailbox" — false for Antigravity, whose native-push
		// rail is intercepted BEFORE the mailbox mini-table and has no mailbox at all. A model
		// reading that would pick mailbox semantics for a citizen that has none.
		//
		// Scope this to the registration block, NOT the whole file: the first version of this
		// assertion swept `src`, so deleting the sentence from the description still passed on an
		// unrelated `native-push` string elsewhere in the module. A rail-completeness claim that
		// any import line can satisfy is not a claim.
		const piV2Start = src.indexOf("function registerEntwurfV2Tool");
		const piV2End = src.indexOf("\nfunction ", piV2Start + 1);
		// Require a REAL end marker. `piV2End === -1 ? undefined : …` would silently widen the
		// block to end-of-file and keep passing, which is the opposite of the fail-loud this
		// scope exists for.
		ok(
			"4: pi-native — registration block is isolated (non-vacuous scope for the description checks)",
			piV2Start !== -1 && piV2End > piV2Start,
		);
		const piV2Block = src.slice(piV2Start, piV2End);
		ok("4: pi-native — registration block is substantial", piV2Block.length > 500);
		// BLOCK SCOPE IS NOT ENOUGH — the two model-facing strings mask each other. Measured
		// 2026-07-27 (round 4): the `intent` param description was corrected to split the two
		// reject reasons while the LONG tool description still advertised the merged, false one,
		// and this gate stayed green at 51 checks because both live in the same block and only
		// ONE had to carry each literal. So slice them apart and require EACH to be true.
		// The start marker MUST be unique to the long description. Measured 2026-07-27 (round 5):
		// a bare `description:` matched the `target` PARAM first, so this "long description"
		// slice was 4,468 chars spanning target + intent + the long text — the very masking the
		// split was added to remove. An over-wide slice is a silent pass, so pin the exact
		// backtick opening instead, and assert the two slices are actually disjoint.
		const piLongDesc = sliceDescription(piV2Block, "description: `CANONICAL", "\n\t\tparameters:");
		const piIntentDesc = sliceDescription(piV2Block, "intent: StringEnum(", "message:");
		ok(
			"4: pi-native — long/intent slices are disjoint (neither can satisfy the other's claim)",
			piLongDesc.length > 0 &&
				piIntentDesc.length > 0 &&
				!piLongDesc.includes(piIntentDesc) &&
				!piIntentDesc.includes(piLongDesc),
		);
		for (const [what, text] of [
			["long tool description", piLongDesc],
			["intent param description", piIntentDesc],
		] as const) {
			ok(`4: pi-native — ${what} is isolated (non-vacuous)`, text.length > 120);
			ok(`4: pi-native — ${what} names the native-push rail`, /native-push/.test(text));
			// The two no-resume-authority rejects are DIFFERENT reasons: a native-push backend IS
			// probe-measured, so calling its reject `backend-liveness-unsupported` is the exact lie
			// `entwurf-v2-contract.ts:143` warns about in so many words.
			ok(
				`4: pi-native — ${what} separates the self-fetch and native-push owned rejects`,
				/backend-liveness-unsupported/.test(text) && /native-push-no-resume-authority/.test(text),
			);
			// Direct tripwire for the exact sentence that shipped: merging the two backends under
			// one reason. Presence-only pins cannot catch this — the merged claim can sit right
			// beside the correct literals.
			ok(
				`4: pi-native — ${what} never merges the two backends under one reject reason`,
				!/self-fetch and native-push alike/.test(text),
			);
			// Caller-intent steer (live-peer owned-outcome bug): owned-outcome is dormant-only and
			// NEVER auto-converted. Pinned PER STRING — the file-wide version of this check could
			// be satisfied by whichever description still carried it.
			ok(
				`4: pi-native — ${what} says owned-outcome is dormant-only + never auto-converted`,
				/DORMANT socket-domain citizen/.test(text) && /auto-converted/.test(text),
			);
		}
		ok("4: pi-native — long description denies native-push a mailbox", /NO mailbox/.test(piLongDesc));
		ok(
			"4: pi-native — long description steers live/alive peer → fire-and-forget",
			/liveness=alive/.test(piLongDesc) && /fire-and-forget/.test(piLongDesc),
		);
		assertLongDescExcludesParams("4: pi-native", piLongDesc, [
			"target: Type.String(",
			"intent: StringEnum(",
			"mode: Type.Optional(",
			"wants_reply: Type.Optional(",
		]);
		const piModeDesc = sliceDescription(piV2Block, "mode: Type.Optional(", "wants_reply:");
		assertRailSemantics("4: pi-native", piLongDesc, piIntentDesc, piModeDesc);
	}

	// ── 5: MCP bridge wiring guard ────────────────────────────────────────────
	// The MCP bridge is a `.ts`-import fence consumer (mcp/tsconfig allowImportingTsExtensions),
	// so it STATICALLY imports the surface adapter (no dynamic import). The v2 handler runs the
	// production runner IN-PROCESS via runAndRenderEntwurfV2FromSurface — it does NOT route the
	// v2 dispatch through legacy rpcCall/enqueueMetaMessage (those stay as the v2 runner's transport primitives).
	{
		const src = await fs.readFile(MCP_SRC, "utf8");
		ok("5: MCP — registers entwurf_v2 server.tool", /server\.tool\(\s*"entwurf_v2"/.test(src));
		ok(
			"5: MCP — static imports runAndRenderEntwurfV2FromSurface from the surface fence module",
			/import\s*\{[^}]*runAndRenderEntwurfV2FromSurface[^}]*\}\s*from\s*"[^"]*entwurf-v2-surface\.ts"/.test(src),
		);
		// Isolate the entwurf_v2 server.tool(...) block: from its name literal to the NEXT
		// server.tool( registration. The v2 handler must build the sender + call the surface
		// adapter, and must NOT itself reach for a legacy transport (the decider routes).
		const v2Start = src.indexOf('"entwurf_v2"');
		const after = src.indexOf("server.tool(", v2Start + 1);
		// F-6: require a REAL end boundary, the same fail-loud rule block 4 already applies.
		// `after === -1 ? undefined : after` meant that the moment the NEXT `server.tool(` was
		// renamed, reordered, or removed, this block silently widened to end-of-file — and every
		// "must NOT appear in the v2 block" assertion below would then be reading other tools'
		// text. A boundary that disappears has to fail, not grow.
		ok(
			"5: MCP — v2 registration block has a REAL end boundary (next server.tool present)",
			v2Start !== -1 && after > v2Start,
		);
		const v2Block = src.slice(v2Start, after);
		ok("5: MCP — v2 handler builds buildSendSenderEnvelope()", /buildSendSenderEnvelope\(\)/.test(v2Block));
		ok("5: MCP — v2 handler passes senderProvider: () => sender", /senderProvider:\s*\(\)\s*=>\s*sender/.test(v2Block));
		ok(
			"5: MCP — v2 handler calls runAndRenderEntwurfV2FromSurface",
			/runAndRenderEntwurfV2FromSurface\(/.test(v2Block),
		);
		ok(
			"5: MCP — v2 handler routes through the runner, NOT legacy rpcCall/enqueueMetaMessage",
			!/\brpcCall\(/.test(v2Block) && !/\benqueueMetaMessage\(/.test(v2Block),
		);
		// Same shipped-rail completeness rule as the pi-native surface (4), and split the SAME
		// two ways: the long tool description and the `intent` param description must EACH be
		// true on their own (see the round-4 masking note in block 4).
		// Same fail-loud rule as block 4: a missing marker would make `slice(0, -1)` return
		// nearly the whole block and sail past the length guard, so assert the boundary first.
		const mcpSchemaStart = v2Block.indexOf("\t{");
		ok("5: MCP — schema boundary marker is present (slice cannot silently widen)", mcpSchemaStart > 0);
		const mcpLongDesc = v2Block.slice(0, mcpSchemaStart);
		const mcpIntentDesc = sliceDescription(v2Block, "intent: z", "message: z");
		ok(
			"5: MCP — long/intent slices are disjoint (neither can satisfy the other's claim)",
			mcpLongDesc.length > 0 &&
				mcpIntentDesc.length > 0 &&
				!mcpLongDesc.includes(mcpIntentDesc) &&
				!mcpIntentDesc.includes(mcpLongDesc),
		);
		for (const [what, text] of [
			["long tool description", mcpLongDesc],
			["intent param description", mcpIntentDesc],
		] as const) {
			ok(`5: MCP — ${what} is isolated (non-vacuous)`, text.length > 120);
			ok(`5: MCP — ${what} names the native-push rail`, /native-push/.test(text));
			ok(
				`5: MCP — ${what} separates the self-fetch and native-push owned rejects [QK:V2SURF-MERGED-REJECT]`,
				/backend-liveness-unsupported/.test(text) && /native-push-no-resume-authority/.test(text),
			);
			ok(
				`5: MCP — ${what} never merges the two backends under one reject reason`,
				!/self-fetch and native-push alike/.test(text),
			);
			// Same per-string caller-intent pin as block 4 (a sibling reaching in over MCP reads
			// THIS description, not the pi-native one).
			ok(
				`5: MCP — ${what} says owned-outcome is dormant-only + never auto-converted`,
				/DORMANT socket-domain citizen/.test(text) && /auto-converted/.test(text),
			);
		}
		ok("5: MCP — long description denies native-push a mailbox", /NO mailbox/.test(mcpLongDesc));
		ok(
			"5: MCP — long description steers live/alive peer → fire-and-forget",
			/liveness=alive/.test(mcpLongDesc) && /fire-and-forget/.test(mcpLongDesc),
		);
		assertLongDescExcludesParams("5: MCP", mcpLongDesc, ["target: z", "intent: z", "mode: z", "wants_reply: z"]);
		const mcpModeDesc = sliceDescription(v2Block, "mode: z", "wants_reply: z");
		assertRailSemantics("5: MCP", mcpLongDesc, mcpIntentDesc, mcpModeDesc);

		// entwurf_peers is a FACT surface, but it still told the model what `unsupported` means —
		// and "does NOT mean unreachable" is false for a record whose backend has no adapter on
		// this lane (codex, or a self-fetch citizen that has exited): `resolveDispatch` rejects it
		// as mailbox-undeliverable. Sliced with the same real-boundary rule as the v2 block.
		const peersStart = src.indexOf('"entwurf_peers"');
		const peersAfter = src.indexOf("server.tool(", peersStart + 1);
		ok(
			"5: MCP — entwurf_peers block has a REAL end boundary (next server.tool present)",
			peersStart !== -1 && peersAfter > peersStart,
		);
		const peersBlock = src.slice(peersStart, peersAfter);
		ok("5: MCP — entwurf_peers block is isolated (non-vacuous)", peersBlock.length > 200);
		ok(
			"5: MCP — entwurf_peers names the THIRD answer (a reject), not just the two allow rails",
			/mailbox-undeliverable/.test(peersBlock) && /native-push-target-dead/.test(peersBlock),
		);
		ok(
			"5: MCP — entwurf_peers no longer claims `unsupported` does NOT mean unreachable",
			!/does NOT mean unreachable/.test(peersBlock),
		);

		// F-7: entwurf_inbox_read described itself as draining "your own" inbox while the handler
		// passes the CALLER-SUPPLIED gardenId straight to readMetaInbox with no comparison against
		// an authoritative self identity. README/setup-clean-host deliberately keep that surface open
		// (a plain external host with no garden record may call the read tools), so the honest repair
		// is the description, not a new guard — but a false access claim must not survive either.
		const inboxStart = src.indexOf('"entwurf_inbox_read"');
		const inboxAfter = src.indexOf("server.tool(", inboxStart + 1);
		ok(
			"5: MCP — entwurf_inbox_read block has a REAL end boundary (next server.tool present)",
			inboxStart !== -1 && inboxAfter > inboxStart,
		);
		const inboxBlock = src.slice(inboxStart, inboxAfter);
		const inboxText = modelText(inboxBlock);
		ok("5: MCP — entwurf_inbox_read block is isolated (non-vacuous)", inboxText.length > 200);
		ok(
			"5: MCP — entwurf_inbox_read states the garden id is CALLER-SUPPLIED and unverified [QK:V2SURF-INBOX-SCOPE-HONESTY]",
			/CALLER-SUPPLIED/.test(inboxText) && /NOT verified against your own identity/.test(inboxText),
		);
		ok(
			"5: MCP — entwurf_inbox_read warns that a foreign id drains THEIR mail and stamps THEIR receipt",
			/drains THEIR mail and stamps THEIR receipt/.test(inboxText),
		);
		// NEGATIVE (exact false sentence): the shipped "your own inbox" access claim.
		ok(
			"5: MCP — entwurf_inbox_read no longer claims it drains `your own` inbox",
			!/your own meta-bridge inbox/.test(inboxText) && !/receipt on your meta-record/.test(inboxText),
		);
		// The description↔handler agreement has to be pinned on the HANDLER's side too, and
		// `readMetaInbox({ gardenId })` alone does not do it: a handler could resolve its
		// authoritative self and enforce equality FIRST and still end in that same call, leaving
		// this row green while the description's "not verified" sentence became false. So require
		// the pass-through POSITIVELY *and* require the absence of any identity-equality guard.
		// If a future change decides to enforce own-inbox (a behaviour change — see NEXT §QUEUE 1),
		// this goes red and forces the description to change with it.
		ok(
			"5: MCP — entwurf_inbox_read passes the caller's gardenId straight to readMetaInbox",
			/readMetaInbox\(\{ gardenId \}\)/.test(inboxBlock),
		);
		const inboxIdentityGuard =
			/buildAuthoritativeSelfEnvelope|buildTrustedMetaSenderEnvelope|resolveTrustedMetaSenderIdentity/.test(
				inboxBlock,
			) || /sender\.sessionId|self\.envelope|envelope\.sessionId/.test(inboxBlock);
		ok(
			"5: MCP — entwurf_inbox_read resolves NO authoritative self identity (so 'caller-supplied, not verified' is true)",
			!inboxIdentityGuard,
		);
	}

	console.log(`\ncheck-entwurf-v2-surface: ${passed} checks passed`);
}

await main();
