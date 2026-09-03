/**
 * check-entwurf-v2-surface — deterministic gate for the 5d-3a surface adapter
 * (`entwurf-v2-surface.ts`) + the `entwurf-control.ts` wiring contract. It proves the PURE
 * parts (the rest — production assembly — is check-entwurf-v2-production + the 5d-5 matrix):
 *
 *   1. toDispatchInput — `wants_reply`→`wantsReply` (snake→camel), `intent`/`message`/`target`
 *      pass through, absent `mode`/`wants_reply` stay undefined (decider defaults, no double).
 *   2. renderEntwurfV2Result — each result kind → the right `{ text, isError }`, surfacing the
 *      carry-overs: reject reason + target-locked diagnostic / control N3 rejectReason /
 *      N1 delivered-but-lock-dirty — plus the two reject HINTS an operator meets after the
 *      visible-first cut (dormant-fire-forget-unsupported, indeterminate-no-spawn).
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
 *    branch. The mailbox and native-push branches both carry `lock: null`. "socket paths
 *    take a per-target lock" read as "the socket transport locks", which got native-push
 *    (a live send that does NOT lock) exactly backwards. The DOMAIN wording survived the
 *    visible-first cut; the second in-domain transport it also covered did not.
 *  - MODE: `mode` exists on exactly ONE ExecutionPlan variant, `control-socket`. The
 *    meta-mailbox and native-push plans have no such field.
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
	// The spawn-bg half of this claim went with the transport itself (visible-first cut): there is
	// no second in-domain transport left to run under the lock, so asserting one would be a green
	// gate proving retired behavior. What survives is the DOMAIN scope, pinned just above.
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
 * DORMANT HONESTY — the model-facing replacement for the retired `V2SURF-MERGED-REJECT` claim,
 * whose subject (two distinct OWNED rejects) left with the `owned-outcome` intent.
 *
 * After the visible-first cut a dormant socket-domain citizen is unreachable by every verb, and
 * these four strings are the only place a caller learns that BEFORE spending a dispatch. So each
 * one must, on its own:
 *   - name the reason it will actually get back (`dormant-fire-forget-unsupported`);
 *   - name the intent that used to answer there (`owned-outcome`) — silently deleting it leaves
 *     an operator who read last week's docs with no way to find out what happened;
 *   - say it was `withdrawn`, ADJACENTLY to that name. Presence alone is not enough: naming a
 *     retired intent without the retirement verb beside it reads as an offer, which is exactly
 *     the "advertised as selectable" failure this claim exists to forbid;
 *   - carry NEITHER retired advertisement form (`owned-outcome = …` enum styling, or the old
 *     "DORMANT socket-domain citizen … never auto-converted" sentence that described picking it).
 *
 * ORDER IS LOAD-BEARING, and not for readability. `ok` throws on the FIRST failure, and the kill
 * signature is read off the failing line — so the `[QK:…]` label must sit on the assertion this
 * claim's mutant reaches FIRST. That mutant drops the reason AND the withdrawal in one edit; with
 * the reason check leading, an UNLABELLED line would throw first and the kill would read as
 * WRONG-REASON. The adjacency check therefore goes first and carries the only token; the other two
 * run unlabelled behind it — still real assertions, just not this claim's signature.
 */
function assertDormantHonesty(tag: string, rawText: string): void {
	const text = modelText(rawText);
	const at = text.indexOf("owned-outcome");
	ok(
		`${tag} — names the withdrawn intent owned-outcome and says "withdrawn" beside it (not as an offer) [QK:V2SURF-DORMANT-HONESTY]`,
		at >= 0 && /withdrawn/.test(text.slice(at, at + 200)),
	);
	ok(`${tag} — names the reason a dormant target actually returns`, /dormant-fire-forget-unsupported/.test(text));
	ok(
		`${tag} — never advertises owned-outcome as selectable`,
		!/owned-outcome\s*=/.test(text) && !/DORMANT socket-domain citizen/.test(text) && !/auto-converted/.test(text),
	);
}

/**
 * PEERS DEAD-ROW HONESTY. `entwurf_peers` is a FACT surface and stays one: this claim must never
 * be satisfiable by adding a per-row action/routing field, which is why it is asserted on the
 * DESCRIPTION and paired with a negative that forbids the row-level fix. What the description owes
 * a caller is that `dead` is a reported fact carrying no invitation — the citizen is dormant and,
 * since the visible-first cut, reachable by no verb at all.
 */
function assertPeersDeadRowHonesty(tag: string, rawBlock: string): void {
	const text = modelText(rawBlock);
	ok(
		`${tag} — entwurf_peers says a dead/dormant row is a REPORTED FACT that grants no action [QK:V2SURF-PEERS-DEAD-ROW]`,
		/REPORTED FACT/.test(text) && /grants no action/.test(text) && /not an invitation to dispatch/.test(text),
	);
	ok(
		`${tag} — entwurf_peers calls a dead row currently unreachable by any verb`,
		/dormant/.test(text) && /unreachable by any verb/.test(text),
	);
	// The forbidden repair: teaching the row itself to carry a verb. The facts-only rule is what
	// keeps this surface from becoming a second dispatch table, so a description that promised a
	// per-row action would be a worse fix than the confusion it removes.
	ok(
		`${tag} — entwurf_peers still denies per-row routing verbs (facts-only)`,
		/never per-row routing verbs|no per-row routing field/.test(text),
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
/**
 * HOST TRUNCATION CAP. Measured 2026-07-30 on both Claude ACP and stock Claude Code: a tool
 * description longer than this is cut mid-sentence and the tail is replaced with `… [truncated]`.
 * The shipped entwurf_v2 text was 4,022 chars, so everything from the INTENT contract onward —
 * the reject taxonomy, the three-valued probe, the lock scope — never reached the model that had
 * to choose an intent. Every other assertion in this file checks that a sentence is PRESENT in
 * source; none of them can see that the host threw half of it away. This one can.
 *
 * Judged on `modelText` (the rendered string), not the source slice: pi-native wraps inside one
 * template literal and the MCP surface `+`-concatenates, so only the normalized text has the
 * length the host actually measures.
 */
const HOST_DESCRIPTION_CAP = 2048;

/**
 * The string the HOST measures, recovered from either surface's source scaffolding: drop the
 * `description:` key and the outer template-literal / string-literal fence, and unescape `\"`.
 * Counting the raw slice instead would charge the text for punctuation the model never sees —
 * and the two surfaces carry DIFFERENT punctuation, so the cap would mean two different things.
 */
function renderedDescription(raw: string): string {
	const flat = modelText(raw);
	// Anchor on the description's own first word rather than on scaffolding: the two surfaces put
	// DIFFERENT preludes in front of it (the MCP slice starts at the tool name), and counting those
	// would report a number the host never measures — a cap gate that cites the wrong length gets
	// quoted as if it were the real one.
	const from = flat.indexOf("CANONICAL");
	return (from >= 0 ? flat.slice(from) : flat).replace(/[`"],?$/, "").replace(/\\"/g, '"');
}

function assertDescriptionFitsHostCap(tag: string, longDescRaw: string): void {
	const rendered = renderedDescription(longDescRaw);
	ok(
		`${tag} — long description fits the host's ${HOST_DESCRIPTION_CAP}-char cap (${rendered.length}) ` +
			"[QK:V2SURF-DESC-FITS-HOST-CAP]",
		rendered.length <= HOST_DESCRIPTION_CAP,
	);
}

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
			intent: "fire-and-forget",
			message: "hi",
			mode: "steer",
			wants_reply: true,
		};
		const di = toDispatchInput(full);
		ok(
			"1: target/intent/message pass through",
			di.target === GID && di.intent === "fire-and-forget" && di.message === "hi",
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

		// The two spawn-bg render cells (lock-retained / socket-alive) were deleted with the
		// transport itself. Nothing renders them anymore, and `EntwurfV2Transport` no longer
		// admits the literal — a cell kept here would only prove the type is still wrong.

		// meta-mailbox → enqueued, carrying the #98 R send receipt (the enqueued FILE).
		const mailbox: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "meta-mailbox" },
			transport: "meta-mailbox",
			outcome: {
				transport: "meta-mailbox",
				success: true,
				messagePath: "/home/x/.pi/agent/meta-mailbox/20260903T134455-e55e87/2026-09-03T07-19-31-803Z-113443.msg",
			},
		};
		const mb = renderEntwurfV2Result(mailbox);
		ok("2: meta-mailbox → not error + enqueued", !mb.isError && mb.text.includes("enqueued"));
		ok(
			"2: meta-mailbox names the enqueued message FILE (#98 R send receipt)",
			mb.text.includes("2026-09-03T07-19-31-803Z-113443.msg"),
		);
		// The basename alone — printing the whole path would put the operator's home and the
		// target garden id (which the caller just typed) into every send line.
		ok(
			"2: meta-mailbox prints the basename, not the whole path",
			!mb.text.includes("/home/x/") && !mb.text.includes("meta-mailbox/20260903T134455-e55e87"),
		);
		// The assertion #98 asks for BY NAME: an enqueue receipt must never carry a read
		// stamp. At enqueue time `lastReadAt` is the PREVIOUS message's read, so surfacing it
		// would read as "my message was read" — the misreading that opened the issue.
		ok(
			"2: meta-mailbox carries NO read stamp (lastReadAt is forbidden on a send receipt)",
			!/lastReadAt|lastDeliveredAt|\bread\b/i.test(mb.text),
		);
		// A dep that hands back no receipt must degrade to the old literal — never
		// "enqueued (undefined)". The delivery happened either way.
		const mailboxNoReceipt: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "meta-mailbox" },
			transport: "meta-mailbox",
			outcome: { transport: "meta-mailbox", success: true },
		};
		const mbn = renderEntwurfV2Result(mailboxNoReceipt);
		ok(
			"2: meta-mailbox with no receipt degrades to the bare literal (never 'undefined')",
			!mbn.isError && mbn.text === "entwurf_v2 meta-mailbox → enqueued",
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

		// Detour B (B-a) after the visible-first cut: the two OWNED rejects this block used to
		// exercise (`backend-liveness-unsupported`, `owned-live-no-autosend`) left the reason
		// union with the intent that produced them. The cell that now carries the whole cost of
		// the cut is `dormant-fire-forget-unsupported`, and it is the one an operator actually
		// meets — so it, not a retired reason, is what this block must prove.
		const dormantReject: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "dormant-fire-forget-unsupported", observedLiveness: "dead" },
		};
		const dr = renderEntwurfV2Result(dormantReject);
		ok(
			"2: dormant-fire-forget-unsupported reject → isError + reason surfaced",
			dr.isError && dr.text.includes("dormant-fire-forget-unsupported"),
		);
		// The dormant hint is the ONLY place a caller learns why an id that entwurf_peers listed
		// is unreachable. A reader who takes "reject" for "wrong id" goes looking in the wrong
		// place, so the hint must distinguish the two: record intact, session not running.
		const dormantHint = actionableRejectHint("dormant-fire-forget-unsupported") ?? "";
		ok(
			"2B: dormant hint separates 'record intact' from 'session not running' (not a bad id)",
			/record is intact/.test(dormantHint) && /session is not running/.test(dormantHint),
		);
		ok(
			"2B: dormant hint names the withdrawn intent and the visible-first rule, and hands the operator the resume verb",
			/owned-outcome|resume that used to answer here/.test(dormantHint) &&
				/withdrawn/.test(dormantHint) &&
				/visible-first/.test(dormantHint) &&
				/entwurf_resume_call/.test(dormantHint),
		);
		// The frozen wire id still spells "-no-spawn" although nothing spawns anymore. The id is
		// deliberately NOT renamed (renaming a public reject is its own contract cut), so the
		// hint carries the whole correction: probe inconclusive, and nothing ran.
		const indetReject: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "indeterminate-no-spawn", observedLiveness: "indeterminate" },
		};
		const ir = renderEntwurfV2Result(indetReject);
		ok(
			"2: indeterminate-no-spawn reject → isError + reason surfaced",
			ir.isError && ir.text.includes("indeterminate-no-spawn"),
		);
		const indetHint = actionableRejectHint("indeterminate-no-spawn") ?? "";
		// ORDER IS LOAD-BEARING (same rule as assertDormantHonesty): `ok` throws on the FIRST
		// failure and the kill signature is read off the failing line, so the labelled assertion
		// must be the one this claim's mutant reaches first. Its terse replacement text fails the
		// length floor too — leading with that UNLABELLED check would throw first and the kill
		// would read as WRONG-REASON. The no-start facts are also the claim's actual subject, so
		// they lead and carry the only token; existence/UNKNOWN run unlabelled behind them.
		ok(
			"2B: indeterminate hint states NOTHING was delivered and NO process was started " +
				"[QK:V2SURF-INDETERMINATE-NO-START]",
			/NOTHING was delivered/.test(indetHint) && /NO process was started/.test(indetHint),
		);
		ok("2B: indeterminate hint exists at all (the frozen '-no-spawn' id cannot explain itself)", indetHint.length > 80);
		// "the PROBE was inconclusive", never "the socket answered": `indeterminate` also covers a
		// probe that got no answer, was refused by permissions, or timed out.
		ok(
			"2B: indeterminate hint says the PROBE was inconclusive and liveness is UNKNOWN, not a measured death",
			/probe was inconclusive/.test(indetHint) && /UNKNOWN/.test(indetHint) && /not a measured death/.test(indetHint),
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

	// ── 6: RETIRED — parseEntwurfPrefixRootsEnv / ENTWURF_PREFIX_ROOTS ────────
	// The prefix-roots env SSOT existed to feed the trust preflight, and the preflight existed
	// to guard the resume verdict. Both left with the intent. The surface no longer exports
	// either symbol, so there is nothing here to certify — and a gate that kept parsing a
	// deleted export would be testing itself.

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
		// surfaces described only control-socket/mailbox and told the model that an
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
			assertDormantHonesty(`4: pi-native — ${what}`, text);
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
		assertDescriptionFitsHostCap("4: pi-native", piLongDesc);

		// 4b: pi-native entwurf_peers. Asserted on THIS surface too, not only the MCP one: the two
		// descriptions are read by different callers (a resident pi model vs a sibling reaching in
		// over MCP), and a correction that lands on one of them is a correction half the garden
		// never sees. Same real-boundary rule as every other slice here.
		const piPeersStart = src.indexOf('name: "entwurf_peers"');
		const piPeersEnd = src.indexOf("parameters:", piPeersStart + 1);
		ok(
			"4b: pi-native — entwurf_peers description block has a REAL end boundary",
			piPeersStart !== -1 && piPeersEnd > piPeersStart,
		);
		const piPeersBlock = src.slice(piPeersStart, piPeersEnd);
		ok("4b: pi-native — entwurf_peers description is isolated (non-vacuous)", piPeersBlock.length > 200);
		assertPeersDeadRowHonesty("4b: pi-native", piPeersBlock);
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
			assertDormantHonesty(`5: MCP — ${what}`, text);
		}
		ok("5: MCP — long description denies native-push a mailbox", /NO mailbox/.test(mcpLongDesc));
		ok(
			"5: MCP — long description steers live/alive peer → fire-and-forget",
			/liveness=alive/.test(mcpLongDesc) && /fire-and-forget/.test(mcpLongDesc),
		);
		assertLongDescExcludesParams("5: MCP", mcpLongDesc, ["target: z", "intent: z", "mode: z", "wants_reply: z"]);
		const mcpModeDesc = sliceDescription(v2Block, "mode: z", "wants_reply: z");
		assertRailSemantics("5: MCP", mcpLongDesc, mcpIntentDesc, mcpModeDesc);
		assertDescriptionFitsHostCap("5: MCP", mcpLongDesc);

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
		// Visible-first cut, operator-surface half: a dormant citizen still gets a row here, and a
		// caller who reads "it is in the list" as "I can dispatch to it" spends a dispatch to find
		// out otherwise. The FACT stays a fact — no per-row action field, no routing verb, which is
		// the rule this surface exists under — so the correction has to live in the description.
		assertPeersDeadRowHonesty("5: MCP", peersBlock);

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
