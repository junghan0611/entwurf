/**
 * check-entwurf-self-address — deterministic gate for the self-addressability
 * honesty predicate (SE-1/SE-2 slice 1). Guards the bug where the MCP bridge and
 * pi-native claim `replyable: true` purely from env presence: a pi session with no
 * --entwurf-control socket, or a meta citizen whose owner exited / whose idle-watch
 * was never armed, all advertised replyable while delivery silently failed (SE-1).
 *
 * Proves:
 *   - PURE truth table (computeSelfAddressability, facts injected): pi replyable ⟺
 *     socketAlive; external never replyable; and meta replyability splits by RAIL —
 *     self-fetch ⟺ recordBacked ∧ ownerAlive ∧ watchArmed, native-push ⟺ recordBacked ∧
 *     probeAlive (a separate axis: an agy citizen never arms a mailbox watch, so the
 *     self-fetch atom would make it un-replyable forever), and an unsupplied rail is
 *     fail-closed. socketState alive/expected/none is its own assertable field.
 *   - The two REGRESSION-PROOF rows the lock requires (record-present, not all-absent):
 *       (b) meta record present + owner-dead (start-key mismatch) → false
 *       (c) meta record present + watch-unarmed → false
 *     These stay meaningful after slice 3 mints pi/meta records, where an
 *     "everything absent → false" row would silently go green.
 *   - SOURCE GUARD (the regression this gate exists for): buildStrictPiSenderEnvelope
 *     no longer hardcodes `replyable: true` in its pi-session envelope — it derives
 *     replyable from computeSelfAddressability over a real existsSync socket probe;
 *     entwurf_self renders the socket as alive vs expected (no synthesized path lie).
 *
 * v1/v2 contract (pin so it is not later misread): the slice-1 goal is "neither
 * surface CLAIMS a false replyable", NOT "both surfaces reject". The now-removed v1
 * entwurf_send rejected wants_reply=true from a non-replyable sender (no reply
 * address); v2 entwurf_v2 passes wants_reply through as an etiquette payload and
 * surfaces the envelope's honest replyable:false. Both stopped lying about
 * replyability; only v1 also hard-rejected. They shared ONE builder, so the honesty
 * fix landed in both at once.
 *
 * Slice boundary: meta-self's watchArmed FACT is wired from the slice-2 meta-receiver
 * presence marker; the predicate already demands it here (fail-closed). Slices 1 and
 * 2 closed in the same release block. The pi-NATIVE surface (entwurf-control.ts
 * senderProvider/fallback) no longer hardcodes replyable:true — it derives replyable
 * from computeSelfAddressability + a canonical-socket existsSync probe, pinned by
 * check-entwurf-v2-surface and this gate's own pi-native source check.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	computeSelfAddressability,
	type SelfAddressabilityFacts,
	type SocketState,
} from "../pi-extensions/lib/entwurf-self-address.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── PURE truth table ────────────────────────────────────────────────────────
function row(facts: SelfAddressabilityFacts): { replyable: boolean; socketState: SocketState } {
	const r = computeSelfAddressability(facts);
	return { replyable: r.replyable, socketState: r.socketState };
}

// pi-session axis: replyable ⟺ a live control socket.
{
	const alive = row({ origin: "pi-session", socketAlive: true, socketPathComputable: true });
	ok("pi + socket alive → replyable", alive.replyable === true);
	ok("pi + socket alive → socketState alive", alive.socketState === "alive");

	// SE-1 CORE: a pi session with PI_SESSION_ID but NO --entwurf-control socket.
	const expected = row({ origin: "pi-session", socketAlive: false, socketPathComputable: true });
	ok("pi + socket absent (path computable) → NOT replyable", expected.replyable === false);
	ok("pi + socket absent → socketState expected (not a synthesized 'alive' lie)", expected.socketState === "expected");

	// No session id at all → cannot even compute a path. Distinct from 'expected'.
	const none = row({ origin: "pi-session", socketAlive: false, socketPathComputable: false });
	ok("pi + no session id → NOT replyable", none.replyable === false);
	ok("pi + no session id → socketState none", none.socketState === "none");
}

// meta-session / SELF-FETCH rail (claude-code): 3-conjunct deliverability
// (recordBacked ∧ ownerAlive ∧ watchArmed).
{
	const meta = (f: Partial<SelfAddressabilityFacts>): SelfAddressabilityFacts => ({
		origin: "meta-session",
		metaDeliveryDomain: "self-fetch",
		...f,
	});
	const full = row(meta({ recordBacked: true, ownerAlive: true, watchArmed: true }));
	ok("meta/self-fetch + record + owner-alive + watch-armed → replyable", full.replyable === true);

	// (b) REGRESSION-PROOF row: record PRESENT but owner dead.
	const ownerDead = row(meta({ recordBacked: true, ownerAlive: false, watchArmed: true }));
	ok(
		"meta/self-fetch + record present + owner-dead (start-key mismatch) → NOT replyable",
		ownerDead.replyable === false,
	);

	// (c) REGRESSION-PROOF row: record + owner present but watch never armed.
	const watchUnarmed = row(meta({ recordBacked: true, ownerAlive: true, watchArmed: false }));
	ok("meta/self-fetch + record + owner-alive + watch-unarmed → NOT replyable", watchUnarmed.replyable === false);

	// not backed by a record at all → false (the all-absent baseline; weakest row).
	const unbacked = row(meta({ recordBacked: false, ownerAlive: false, watchArmed: false }));
	ok("meta/self-fetch + no backing record → NOT replyable", unbacked.replyable === false);

	// fail-closed on missing axes (undefined treated as false, never optimistic).
	const partial = row(meta({ recordBacked: true }));
	ok("meta/self-fetch + record but undefined owner/watch → fail-closed NOT replyable", partial.replyable === false);
}

// meta-session / NATIVE-PUSH rail (antigravity): a SEPARATE axis — recordBacked ∧ probeAlive.
// The two rails must not be able to borrow each other's facts (보정①): a mailbox signal
// deciding an agy reply, or a probe deciding a Claude reply, is a category error.
{
	const push = (f: Partial<SelfAddressabilityFacts>): SelfAddressabilityFacts => ({
		origin: "meta-session",
		metaDeliveryDomain: "native-push",
		...f,
	});
	const reachable = row(push({ recordBacked: true, probeAlive: true }));
	ok("meta/native-push + record + probe-alive → replyable", reachable.replyable === true);

	// THE ROW THIS RAIL EXISTS FOR: an agy citizen never arms a mailbox watch. Under the
	// self-fetch atom it would be un-replyable forever; on its own rail it is reachable.
	ok(
		"meta/native-push + record + probe-alive + watch NEVER armed → STILL replyable (no mailbox axis leak)",
		row(push({ recordBacked: true, probeAlive: true, watchArmed: false })).replyable === true,
	);

	// Dead conversation: the host is gone, so an injected reply has nowhere to land.
	ok(
		"meta/native-push + record + probe-dead → NOT replyable",
		row(push({ recordBacked: true, probeAlive: false })).replyable === false,
	);

	// No record → not an identity, whatever the probe says.
	ok(
		"meta/native-push + no record + probe-alive → NOT replyable",
		row(push({ recordBacked: false, probeAlive: true })).replyable === false,
	);

	// fail-closed: an unsupplied probe fact is false, never optimistic.
	ok(
		"meta/native-push + record but undefined probe → fail-closed NOT replyable",
		row(push({ recordBacked: true })).replyable === false,
	);

	// A native-push citizen must NOT be able to buy replyability with mailbox facts.
	ok(
		"meta/native-push + owner-alive + watch-armed but probe-dead → NOT replyable (mailbox facts cannot rescue it) [QK:SELFADDR-RAIL-FACT-LEAK]",
		row(push({ recordBacked: true, ownerAlive: true, watchArmed: true, probeAlive: false })).replyable === false,
	);
}

// meta-session / NONE rail: no inbound transport at all. Mailbox facts and a live probe
// cannot buy replyability — there is nothing to land on. Distinct from the unsupplied
// (undefined) domain row below, which stays fail-closed for a caller that forgot the axis.
{
	const noneFacts: SelfAddressabilityFacts = {
		origin: "meta-session",
		metaDeliveryDomain: "none",
		recordBacked: true,
		ownerAlive: true,
		watchArmed: true,
		probeAlive: true,
	};
	const noneRail = computeSelfAddressability(noneFacts);
	ok("meta/none + all facts true → NOT replyable", noneRail.replyable === false);
	ok(
		"meta/none names the missing inbound rail (mailbox/probe facts cannot rescue it)",
		noneRail.reason.includes("no inbound rail"),
	);
}

// meta-session with NO rail declared: we cannot say how a reply would travel, so we do not
// claim it would arrive. The domain is derived from nativePushSupported(backend) — a caller
// that forgets it gets a refusal, not an optimistic guess.
{
	const noDomain = row({
		origin: "meta-session",
		recordBacked: true,
		ownerAlive: true,
		watchArmed: true,
		probeAlive: true,
	});
	ok("meta + NO delivery domain (all facts true) → fail-closed NOT replyable", noDomain.replyable === false);
}

// external-mcp: never replyable.
{
	const ext = row({ origin: "external-mcp" });
	ok("external-mcp → NOT replyable", ext.replyable === false);
	ok("external-mcp → socketState none", ext.socketState === "none");
}

// ── SOURCE GUARD: the MCP builders consume the predicate, no hardcoded lie ────
const indexPath = path.join(REPO_DIR, "mcp", "entwurf-bridge", "src", "index.ts");
const src = readFileSync(indexPath, "utf8");

/** Extract a top-level `function NAME(...) { ... }` body by brace-counting. */
function functionBody(name: string): string {
	const sig = `function ${name}(`;
	const at = src.indexOf(sig);
	assert.ok(at >= 0, `${name} present in MCP source`);
	const open = src.indexOf("{", at);
	assert.ok(open >= 0, `${name} has a body`);
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return src.slice(open, i + 1);
		}
	}
	throw new Error(`${name} body never closed`);
}

/** Extract a `server.tool("NAME", ...)` call region by brace-counting from its open paren. */
function toolRegion(name: string): string {
	const sig = `server.tool(\n\t"${name}"`;
	const at = src.indexOf(sig);
	assert.ok(at >= 0, `server.tool("${name}") present`);
	const open = src.indexOf("(", at);
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) return src.slice(open, i + 1);
		}
	}
	throw new Error(`server.tool("${name}") region never closed`);
}

ok(
	"MCP imports computeSelfAddressability from the shared lib",
	/computeSelfAddressability/.test(src) && /entwurf-self-address\.ts/.test(src),
);

const piBody = functionBody("buildStrictPiSenderEnvelope");
ok("buildStrictPiSenderEnvelope calls computeSelfAddressability", /computeSelfAddressability\s*\(/.test(piBody));
// Scoped to THIS function body (not a broad grep): the pi-session envelope must NOT
// hardcode `replyable: true`; it must derive from the predicate result.
ok(
	"buildStrictPiSenderEnvelope no longer hardcodes `replyable: true` [QK:SELFADDR-NO-HARDCODED-REPLYABLE]",
	!/replyable:\s*true/.test(piBody),
);
// existsSync alone is too loose — pin that it probes the CANONICAL socket path,
// not some other file, so the honesty signal cannot drift to a path that does not
// represent this session's socket.
//
// This assertion used to match a MENTION of `ENTWURF_DIR` + `SOCKET_SUFFIX` in the
// body, which pinned a LOCAL re-implementation of the socket-path grammar instead
// of forbidding one — the bridge was one of three independent producers of
// `<dir>/<gid>.sock`. The grammar now has a single definition
// (`pi-extensions/lib/control-socket-path.js`), so the assertion pins the SHARED
// call: the dir is still this adapter's own policy (ENTWURF_DIR honours the env
// override the pi side does not), but the join is not re-authored here.
ok(
	"buildStrictPiSenderEnvelope existsSync-probes the canonical socket via the shared grammar (controlSocketPathIn(ENTWURF_DIR, …))",
	/existsSync\s*\(/.test(piBody) && /controlSocketPathIn\s*\(\s*ENTWURF_DIR\s*,/.test(piBody),
);

const metaBuilder = functionBody("buildTrustedMetaSenderEnvelope");
// FIRST of the two derivation claims so a binary-fallback mutant dies here, not at the seam pin.
ok(
	"buildTrustedMetaSenderEnvelope does not fall back every non-native-push backend to self-fetch [QK:SELFADDR-NO-FALLBACK-SELF-FETCH]",
	!/\?\s*"native-push"\s*:\s*"self-fetch"/.test(metaBuilder),
);
ok(
	"buildTrustedMetaSenderEnvelope derives self-fetch through resolveMailboxWakeModeCapability(identity), not a backend-name list [QK:SELFADDR-MAILBOX-WAKE-SEAM]",
	/resolveMailboxWakeModeCapability\s*\(\s*identity\s*\)/.test(metaBuilder),
);

const selfRegion = toolRegion("entwurf_self");
ok(
	"entwurf_self existsSync-probes the pi socket (alive vs expected, no synthesized path lie)",
	/existsSync\s*\(/.test(selfRegion),
);

// ── SLICE INTEGRITY (before any claim is read off the slice) ─────────────────
// A source-slice assertion is only as good as its boundaries. `toolRegion` counts
// parens, so an unbalanced paren inside a string literal would silently widen the
// slice to a LATER tool and let a neighbour's text satisfy an assertion about this
// one. Pin both ends explicitly instead of trusting the counter: the slice must
// contain THIS tool's own error label and must NOT reach the next `server.tool(`.
ok("entwurf_self slice contains its own handler tail (start boundary real)", /entwurf_self error:/.test(selfRegion));
ok(
	"entwurf_self slice stops before the next tool (end boundary real, no silent widen)",
	!/entwurf_peers/.test(selfRegion) && !/entwurf_inbox_read/.test(selfRegion),
);

// ── F-1: entwurf_self must render the RAIL, never a universal mailbox ────────
// The defect: `origin === "meta-session"` unconditionally synthesized
// `<mailboxDir>/<gardenId>`. `origin` is sender PROVENANCE; the rail is the second
// axis. A native-push citizen (antigravity) has NO mailbox at all (AGENTS Hard Rule
// 10, VERIFY "No mailbox/receiver-marker evidence counts on this rail"), so that
// branch printed a path that will never exist and taught the model mailbox semantics
// its own rail does not have. Pinned PER RAIL, as one reusable predicate so the same
// judgement can be driven over negative controls below.
/** Brace-balanced body of the `if (<guard>) { … }` that follows `guard`, or null. */
function branchBody(region: string, guard: string): string | null {
	const at = region.indexOf(guard);
	if (at < 0) return null;
	const open = region.indexOf("{", at);
	if (open < 0) return null;
	let depth = 0;
	for (let i = open; i < region.length; i++) {
		const c = region[i];
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return region.slice(open, i + 1);
		}
	}
	return null;
}

function metaRailRenderIsHonest(region: string): { honest: boolean; reason: string } {
	// The mailbox path may be built at most once in the whole render branch…
	const mailboxCalls = region.split("defaultMetaMailboxDir(").length - 1;
	if (mailboxCalls !== 1) {
		return { honest: false, reason: `expected exactly 1 defaultMetaMailboxDir() call, found ${mailboxCalls}` };
	}
	// …and that one call must sit INSIDE the self-fetch branch body. Ordering alone is not
	// containment: an `if (rail === "self-fetch") {}` with an EMPTY body followed by an
	// unconditional mailbox build satisfies "guard appears before mailbox" while still
	// synthesizing a mailbox for every rail — the exact defect this predicate exists to
	// reject. Extract the body by brace-counting and require the call to be in it.
	const selfFetchBody = branchBody(region, 'rail === "self-fetch"');
	if (selfFetchBody === null) {
		return { honest: false, reason: 'no brace-balanced `rail === "self-fetch"` branch body' };
	}
	const inBranch = selfFetchBody.split("defaultMetaMailboxDir(").length - 1;
	if (inBranch !== 1) {
		return {
			honest: false,
			reason: `the self-fetch branch BODY must build the mailbox path exactly once, found ${inBranch} (ordering is not containment)`,
		};
	}
	const pushBody = branchBody(region, 'rail === "native-push"');
	if (pushBody === null) {
		return { honest: false, reason: 'no brace-balanced `rail === "native-push"` branch body' };
	}
	// The native-push branch must deny an inbox AND keep the direct-inject claim conditional
	// on the probe: a dead probe has no live conversation to inject into, so an unconditional
	// "injects a reply into this live conversation" invents the very rail F-1 is about.
	if (!/no inbox/.test(pushBody)) {
		return { honest: false, reason: "the native-push branch does not state that there is no inbox" };
	}
	if (!/while the adapter probe is alive/.test(pushBody)) {
		return {
			honest: false,
			reason: "the native-push branch states direct injection unconditionally (a dead probe has no live conversation)",
		};
	}
	return {
		honest: true,
		reason:
			"the sole mailbox build is INSIDE the self-fetch branch body; native-push denies an inbox and gates injection on the probe",
	};
}

{
	const verdict = metaRailRenderIsHonest(selfRegion);
	ok(`entwurf_self renders the meta rail honestly [QK:SELFADDR-RAIL-RENDER] (${verdict.reason})`, verdict.honest);
	ok(
		"entwurf_self reads the rail from the builder (not re-derived at the render site)",
		/self\.metaDeliveryDomain/.test(selfRegion),
	);

	// NEGATIVE CONTROLS — two KINDS, because a gate that only rejects the exact old
	// sentence would pass a version where the branch is simply gone (and vice versa).
	// Driving the same predicate over synthetic sources is what proves this assertion
	// BLOCKS, not merely that it exists.
	const retiredUnconditional = [
		'} else if (sender.origin === "meta-session") {',
		"\tconst mailboxPath = path.join(defaultMetaMailboxDir(), sender.sessionId);",
		"\textra.mailboxPath = mailboxPath;",
		"}",
	].join("\n");
	ok(
		"NEGATIVE 1/3 (exact false sentence): the retired unconditional meta-session mailbox is REJECTED",
		metaRailRenderIsHonest(retiredUnconditional).honest === false,
	);

	const selfFetchOnlyNoPushBranch = [
		"const rail = self.metaDeliveryDomain;",
		'if (rail === "self-fetch") {',
		"\tconst mailboxPath = path.join(defaultMetaMailboxDir(), sender.sessionId);",
		"\textra.mailboxPath = mailboxPath;",
		"}",
	].join("\n");
	ok(
		"NEGATIVE 2/3 (omission): a self-fetch-guarded render with the native-push branch DELETED is REJECTED",
		metaRailRenderIsHonest(selfFetchOnlyNoPushBranch).honest === false,
	);

	// NEGATIVE 3/3 — the form the FIRST version of this predicate wrongly accepted (caught in
	// cross-review, 2026-07-27): every marker present, guard textually BEFORE the mailbox, yet
	// the guard's body is empty and the mailbox is built unconditionally. Ordering satisfied,
	// containment violated. This row is why the predicate brace-counts the branch body.
	const guardedInNameOnly = [
		"const rail = self.metaDeliveryDomain;",
		'if (rail === "self-fetch") { }',
		"const mailboxPath = path.join(defaultMetaMailboxDir(), sender.sessionId);",
		"extra.mailboxPath = mailboxPath;",
		'if (rail === "native-push") {',
		'\tlines.push("mailbox: none — no inbox; direct-inject only while the adapter probe is alive");',
		"}",
	].join("\n");
	ok(
		"NEGATIVE 3/3 (ordering-but-not-containment): an EMPTY self-fetch guard followed by an unconditional mailbox build is REJECTED",
		metaRailRenderIsHonest(guardedInNameOnly).honest === false,
	);
}

// ── F-1: the identity-wiring errors must not teach one backend's hook as THE hook ──
// Both native backends mint a garden id from their OWN hook (Claude Code SessionStart,
// Antigravity PreInvocation). Naming only SessionStart/Claude sent an agy operator
// looking for a hook its backend never runs.
{
	/** Extract a `class NAME extends Error { ... }` body by brace-counting. */
	const classBody = (name: string): string => {
		const sig = `class ${name} extends Error {`;
		const at = src.indexOf(sig);
		assert.ok(at >= 0, `${name} present in MCP source`);
		const open = src.indexOf("{", at);
		let depth = 0;
		for (let i = open; i < src.length; i++) {
			const c = src[i];
			if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) return src.slice(open, i + 1);
			}
		}
		throw new Error(`class ${name} body never closed`);
	};

	// Anchored per class (not a repo-wide grep) so a mention somewhere else in the file
	// cannot make either row vacuously green.
	for (const cls of ["EntwurfEnvelopeWiringError", "EntwurfSenderIdentityError"]) {
		const body = classBody(cls);
		ok(
			`${cls} names BOTH native hooks (SessionStart AND PreInvocation)`,
			/SessionStart/.test(body) && /PreInvocation/.test(body),
		);
		ok(
			`${cls} no longer presents SessionStart/Claude as THE marker writer`,
			!/The native SessionStart hook writes that marker/.test(body) &&
				!/whose SessionStart hook wrote a live/.test(body) &&
				!/keyed by the\s+Claude Code parent pid/.test(body),
		);
	}
}

// ── SE-2 2e-b: meta-session sender replyability from the receiver presence marker ──
// Identity stays trusted (record-backed), but `replyable` is now derived from whether
// THIS session's own receiver inbox can actually wake (slice-2 presence marker), not a
// hardcoded true. An inactive receiver must still return the meta identity (replyable:false)
// — degrading to null would erase who-sent and fall through to external-mcp.
const metaBody = functionBody("buildTrustedMetaSenderEnvelope");
ok("buildTrustedMetaSenderEnvelope calls computeSelfAddressability", /computeSelfAddressability\s*\(/.test(metaBody));
ok("buildTrustedMetaSenderEnvelope no longer hardcodes `replyable: true`", !/replyable:\s*true/.test(metaBody));
ok(
	// #101: the identity match alone is no longer the whole answer. `entwurf_self` composes
	// the SAME `resolveMailboxReceiverFacts` the v2 dispatch seam uses — reading the receiver
	// marker AND, where the watch owner is the sender-marker process, the join that says that
	// owner is still serving this garden. A citizen's self-reported replyability and what
	// dispatch decides about it come from one measurement, so they cannot disagree.
	"buildTrustedMetaSenderEnvelope derives active-receiver from the SHARED receiver composition (both markers)",
	/resolveMailboxReceiverFacts\s*\(/.test(metaBody) &&
		/readMetaReceiverMarker\s*\(/.test(metaBody) &&
		/readMetaSenderMarker\s*\(/.test(metaBody),
);
ok(
	"buildTrustedMetaSenderEnvelope no longer copies one match into both receiver facts",
	!/ownerAlive:\s*active/.test(metaBody) && !/watchArmed:\s*active/.test(metaBody),
);
ok(
	// #101 (cross-review): both markers are read with their liveness guards ON. A reader that
	// opted out would accept a dead session's leftover file as "which garden this pid serves
	// now", and every fixture pid in a gate is live, so nothing dynamic here could tell.
	"buildTrustedMetaSenderEnvelope reads neither marker with the owner guard disabled",
	!/verifyOwner:\s*false/.test(metaBody),
);
ok(
	"buildTrustedMetaSenderEnvelope keeps meta identity + derived replyable (inactive → not null)",
	/origin:\s*"meta-session"/.test(metaBody) && /replyable:\s*self\.replyable/.test(metaBody),
);

// ── SE-1 2e-a: pi-native surface derives pi-session replyability the SAME way ──
// entwurf-control.ts is a root-tsc emit surface, so it reaches the self-address fence via a
// non-literal dynamic import (never a static `.ts` import — TS5097), then decorates the
// sender with computeSelfAddressability + canonical socket existsSync (no hardcoded true).
const nativeSrc = readFileSync(path.join(REPO_DIR, "pi-extensions", "entwurf-control.ts"), "utf8");
ok(
	"pi-native: decoratePiSenderAddressability derives replyable from computeSelfAddressability + canonical existsSync",
	/function\s+decoratePiSenderAddressability/.test(nativeSrc) &&
		/computeSelfAddressability/.test(nativeSrc) &&
		/existsSync\s*\(\s*getSocketPath/.test(nativeSrc),
);
ok(
	"pi-native: reaches the self-address fence via non-literal dynamic import (no static import; TS5097)",
	/const ENTWURF_SELF_ADDRESS_MODULE\s*=/.test(nativeSrc) &&
		/await import\(ENTWURF_SELF_ADDRESS_MODULE\)/.test(nativeSrc) &&
		!/import[^;]*from\s*"\.\/lib\/entwurf-self-address\.(js|ts)"/.test(nativeSrc),
);

console.log(`\ncheck-entwurf-self-address: ${passed} checks passed`);
