/**
 * check-meta-hook-session-switch — the regression line under a Claude Code SESSION
 * SWITCH: one native process that stops serving one garden and starts serving another
 * (#101). It is the gate that did not exist when the defect shipped, and its shape is
 * the reason it did not: every claude-side cell the suite had asked about ONE session
 * per process, so "one owner pid, two gardens" had no cell anywhere.
 *
 * WHAT A SESSION SWITCH IS. Opening `claude` mints a new session, and an in-session
 * `/resume` (or `/clear`) then fires a SECOND SessionStart inside that one pid, for a
 * DIFFERENT native id — the session the process started with is left behind. Measured on
 * oracle 2026-09-04 (`~/.pi/agent/meta-bridge-hook.log`): the field case at pid 143742,
 * 09:31:35 create `…-ac7a1a`, 09:31:39 attach `…-e09b66`, both arming a receiver marker
 * under that one pid — the first garden's transcript was never written and a message
 * enqueued to it at 09:33 was still an undelivered `.msg` an hour later; then reproduced
 * deliberately at 13:13:04 → 13:13:37 (raw lab S4, `source=startup` → `source=resume`).
 * `claude --resume`, with or without the picker, does NOT do this: it fires exactly one
 * SessionStart carrying the real id (raw lab S2/S3), and compaction re-fires SessionStart
 * for the SAME id (S6), which this rule leaves alone.
 *
 * WHAT IT PROVES, and each cell is a different half:
 *
 *   A (hook)   the second SessionStart RETIRES the marker of the garden this pid no
 *              longer serves — and only that one. A same-garden re-registration (every
 *              UserPromptSubmit) retires NOTHING, which is the cell that keeps the
 *              repair from eating the live citizen it was meant to protect.
 *   B (reader) even with a retired marker still on disk — an older deployed hook, a
 *              crash between the two events — the garden is NOT deliverable, because
 *              `watchArmed` is measured against the owner's sender marker rather than
 *              copied from the identity match. Fail-closed at the reader, so the repair
 *              does not depend on the writer having run.
 *   C (surface) the reject says WHICH axis failed, in the predicate's own words.
 *
 * THE HEADLINE. After a switch, exactly ONE of the two gardens is deliverable, and it is
 * the one the operator is actually sitting in.
 *
 * HOW IT PLAYS CLAUDE. Like check-hook-launch-topology: the gate spawns the SHIPPED
 * `hook-launch.sh` with the manifest's own argv, which `exec`s the payload, so the
 * hook's parent is this gate process — one fake owner pid for every drive, which is
 * exactly the topology the defect needs. Every meta root is sandboxed (agent dir + the
 * four `ENTWURF_META_*_DIR`), so nothing here can read or write the operator's garden.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE. The vendor's `source` field (startup | resume |
 * clear | compact) is LOGGED by the hook and branched on by nothing, so this gate asserts
 * the log line, not a behaviour keyed to the value. The retirement is decided by what is
 * on disk, which is true on every host and every Claude version; a live measurement of
 * the envelope order belongs to the raw lab (scripts/raw-claude-session-switch), not here.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMailboxReceiverFacts } from "../pi-extensions/lib/entwurf-deliverability.ts";
import { listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import { renderEntwurfPeers } from "../pi-extensions/lib/entwurf-peers-render.ts";
import type { DispatchDecision } from "../pi-extensions/lib/entwurf-v2-decider.ts";
import { makeProductionEntwurfV2Deps } from "../pi-extensions/lib/entwurf-v2-production.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { renderEntwurfV2Result } from "../pi-extensions/lib/entwurf-v2-surface.ts";
import {
	listAllMetaIdentitiesDir,
	type MetaIdentity,
	makeStoreRecordReader,
	metaReceiverMarkerPath,
	readActiveStoreEntries,
	readMetaReceiverMarker,
	readMetaSenderMarker,
	upsertMetaSession,
	writeMetaReceiverMarker,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SRC = path.join(REPO_DIR, "pi", "meta-bridge", "entwurf-meta-receive");
const LAUNCHER = path.join(PLUGIN_SRC, "scripts", "hook-launch.sh");
const PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";

const manifest = JSON.parse(readFileSync(path.join(PLUGIN_SRC, "hooks", "hooks.json"), "utf8")) as {
	hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command?: string; args?: string[] }> }>>;
};
const sessionStartLeaf = manifest.hooks.SessionStart?.[0]?.hooks[0] ?? {};

/** Stage a plugin bundle: entry + lib closure + the launcher, exactly as installed. */
function makeBundle(root: string): void {
	mkdirSync(path.join(root, "lib"), { recursive: true });
	mkdirSync(path.join(root, "scripts"), { recursive: true });
	copyFileSync(path.join(REPO_DIR, "pi-extensions", "meta-bridge-hook.ts"), path.join(root, "meta-bridge-hook.ts"));
	copyFileSync(
		path.join(REPO_DIR, "pi-extensions", "lib", "meta-session.ts"),
		path.join(root, "lib", "meta-session.ts"),
	);
	copyFileSync(path.join(REPO_DIR, "pi-extensions", "lib", "session-id.js"), path.join(root, "lib", "session-id.js"));
	const launcher = path.join(root, "scripts", "hook-launch.sh");
	copyFileSync(LAUNCHER, launcher);
	chmodSync(launcher, 0o755);
}

/** Resolve one manifest element the way Claude does: plain-string substitution, no shell. */
function resolveEl(value: string, pluginRoot: string): string {
	return value
		.replace("__NODE_BIN__", process.execPath)
		.replaceAll(PLACEHOLDER, pluginRoot)
		.replace("__HOOK_ENTRY__", "meta-bridge-hook.ts");
}

// ── one sandbox for the whole switch story (the pid is what ties it together) ──
const AGENT_ROOT = mkdtempSync(path.join(tmpdir(), "psa-hook-switch-agent-"));
const PLUGIN_ROOT = mkdtempSync(path.join(tmpdir(), "psa-hook-switch-plugin-"));
const CWD = mkdtempSync(path.join(tmpdir(), "psa-hook-switch-cwd-"));
makeBundle(PLUGIN_ROOT);

const ROOTS = {
	sessionsDir: path.join(AGENT_ROOT, "meta-sessions"),
	sendersDir: path.join(AGENT_ROOT, "meta-senders"),
	receiversDir: path.join(AGENT_ROOT, "meta-receivers"),
	mailboxDir: path.join(AGENT_ROOT, "meta-mailbox"),
	locksDir: path.join(AGENT_ROOT, "entwurf-v2-locks"),
	socketsDir: path.join(AGENT_ROOT, "entwurf-control"),
};
const HOOK_LOG = path.join(AGENT_ROOT, "meta-bridge-hook.log");

function hookEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
		PI_CODING_AGENT_DIR: AGENT_ROOT,
		ENTWURF_META_SESSIONS_DIR: ROOTS.sessionsDir,
		ENTWURF_META_SENDERS_DIR: ROOTS.sendersDir,
		ENTWURF_META_RECEIVERS_DIR: ROOTS.receiversDir,
		ENTWURF_META_MAILBOX_DIR: ROOTS.mailboxDir,
	};
	// Only the launcher may stamp the provenance token; an inherited one would let the
	// owner join pass vacuously if this gate were ever run from inside a hook.
	delete env.ENTWURF_META_HOOK_LAUNCH;
	return env;
}

// The gate's OWN readers must see the same sandbox as the hook children (the marker
// readers resolve their dirs from the environment at call time).
process.env.PI_CODING_AGENT_DIR = AGENT_ROOT;
process.env.ENTWURF_META_SESSIONS_DIR = ROOTS.sessionsDir;
process.env.ENTWURF_META_SENDERS_DIR = ROOTS.sendersDir;
process.env.ENTWURF_META_RECEIVERS_DIR = ROOTS.receiversDir;
process.env.ENTWURF_META_MAILBOX_DIR = ROOTS.mailboxDir;

/** Drive the shipped hook once, through the shipped launcher, as Claude would. */
function driveHook(opts: { event: string; nativeSessionId: string; source: string; transcriptPath: string }): void {
	const exe = resolveEl(sessionStartLeaf.command ?? "", PLUGIN_ROOT);
	const argv = (sessionStartLeaf.args ?? []).map((a) => resolveEl(a, PLUGIN_ROOT));
	const result = spawnSync(exe, argv, {
		encoding: "utf8",
		input: JSON.stringify({
			hook_event_name: opts.event,
			session_id: opts.nativeSessionId,
			transcript_path: opts.transcriptPath,
			cwd: CWD,
			source: opts.source,
		}),
		env: hookEnv(),
	});
	assert.equal(result.status, 0, `hook drive ${opts.nativeSessionId} exited ${result.status}: ${result.stderr}`);
}

/** The gate's own marker readers, pointed at the sandbox — one definition, so every cell that
 * composes receiver facts reads the same two files the production seam would. */
const gateReaders = {
	readReceiverMarker: (gardenId: string) => readMetaReceiverMarker({ gardenId, receiversDir: ROOTS.receiversDir }),
	readSenderMarker: (backend: string, ownerPid: number) =>
		readMetaSenderMarker({ backend: backend as "claude-code", ownerPid, sendersDir: ROOTS.sendersDir }),
};

function gardenIdFor(nativeSessionId: string): string {
	const { identities } = listAllMetaIdentitiesDir(ROOTS.sessionsDir);
	const hit = identities.find((i) => i.nativeSessionId === nativeSessionId);
	assert.ok(hit, `no record for native session ${nativeSessionId}`);
	return hit.gardenId;
}

function identityFor(gardenId: string): MetaIdentity {
	const { identities } = listAllMetaIdentitiesDir(ROOTS.sessionsDir);
	const hit = identities.find((i) => i.gardenId === gardenId);
	assert.ok(hit, `no record for garden ${gardenId}`);
	return hit;
}

// ── the switch: one pid, a startup session, then the one the operator resumed ───
// The abandoned session's transcript is NEVER written — that is what a session opened and
// left before its first turn looks like on disk, and it is why it was invisible to every
// surface that only reads records.
const GHOST_NATIVE = "79e05f96-abandoned-startup";
const REAL_NATIVE = "f654eed7-resumed-conversation";
const REAL_TRANSCRIPT = path.join(CWD, `${REAL_NATIVE}.jsonl`);
writeFileSync(REAL_TRANSCRIPT, "");

driveHook({
	event: "SessionStart",
	nativeSessionId: GHOST_NATIVE,
	source: "startup",
	transcriptPath: path.join(CWD, `${GHOST_NATIVE}.jsonl`),
});
const GHOST_GID = gardenIdFor(GHOST_NATIVE);
ok(
	"the startup session arms a receiver marker (the state the switch has to clean up)",
	readMetaReceiverMarker({ gardenId: GHOST_GID, receiversDir: ROOTS.receiversDir })?.ownerPid === process.pid,
);

driveHook({
	event: "SessionStart",
	nativeSessionId: REAL_NATIVE,
	source: "resume",
	transcriptPath: REAL_TRANSCRIPT,
});
const REAL_GID = gardenIdFor(REAL_NATIVE);
ok("the switch mints a SECOND garden id (two records, one pid)", GHOST_GID !== REAL_GID);

// ── A. the hook retires the garden this pid stopped serving ───────────────────
ok(
	"both records survive the switch — a retirement takes the marker, never the record [QK:MHSS-RECORDS-SURVIVE]",
	existsSync(path.join(ROOTS.sessionsDir, `${GHOST_GID}.meta.json`)) &&
		existsSync(path.join(ROOTS.sessionsDir, `${REAL_GID}.meta.json`)),
);
ok(
	"the retired garden's receiver marker is GONE after the switch [QK:MHSS-RETIRE-PREV-GARDEN]",
	!existsSync(metaReceiverMarkerPath(GHOST_GID, ROOTS.receiversDir)),
);
ok(
	"the resumed garden keeps its receiver marker, owned by this pid",
	readMetaReceiverMarker({ gardenId: REAL_GID, receiversDir: ROOTS.receiversDir })?.ownerPid === process.pid,
);
ok(
	"the sender marker names the garden this pid serves NOW",
	readMetaSenderMarker({ backend: "claude-code", ownerPid: process.pid, sendersDir: ROOTS.sendersDir })?.gardenId ===
		REAL_GID,
);
{
	const log = readFileSync(HOOK_LOG, "utf8");
	ok(
		"the hook logs the vendor's own `source` for both events (the receipt this host lacked) [QK:MHSS-SOURCE-LOGGED]",
		/source=startup/.test(log) && /source=resume/.test(log),
	);
	ok(
		"the retirement is named in the log, with the garden it let go",
		new RegExp(`retired receiver marker ${GHOST_GID}`).test(log),
	);
}

// ── A negative. A same-garden re-registration must retire NOTHING ─────────────
// Every UserPromptSubmit rewrites the sender marker with the SAME garden, and a
// SessionStart can re-fire for the session already being served. A retirement rule that
// only asked "did the sender marker exist?" would delete the live citizen's own doorbell
// on the next keystroke — a worse failure than the one being repaired.
// A same-garden re-registration must retire nothing — and must not even CLAIM to. The marker
// alone cannot say so on this path: the arm block later in the same run rewrites it, so an
// unconditional retirement would be invisible in the filesystem and visible only in the log it
// wrote on the way past. The log is therefore the assertion.
{
	const before = readFileSync(HOOK_LOG, "utf8").length;
	driveHook({
		event: "SessionStart",
		nativeSessionId: REAL_NATIVE,
		source: "startup",
		transcriptPath: REAL_TRANSCRIPT,
	});
	const delta = readFileSync(HOOK_LOG, "utf8").slice(before);
	ok(
		"a same-garden re-registration retires nothing, and claims no retirement [QK:MHSS-RETIRE-KEEPS-CURRENT]",
		!/retired receiver marker/.test(delta) &&
			readMetaReceiverMarker({ gardenId: REAL_GID, receiversDir: ROOTS.receiversDir })?.ownerPid === process.pid,
	);
}
// UserPromptSubmit is the cell that MATTERS here, and it is why the guard is a
// garden COMPARISON rather than "did a sender marker exist?". It rewrites the sender
// marker on every keystroke but CANNOT re-arm the watch (watchPaths is not emittable
// from that event), so a retirement that fired here would delete the live doorbell with
// nothing to put it back — the session would go silently undeliverable mid-conversation.
driveHook({
	event: "UserPromptSubmit",
	nativeSessionId: REAL_NATIVE,
	source: "startup",
	transcriptPath: REAL_TRANSCRIPT,
});
ok(
	"a keystroke (UserPromptSubmit, which cannot re-arm) retires NOTHING",
	readMetaReceiverMarker({ gardenId: REAL_GID, receiversDir: ROOTS.receiversDir })?.ownerPid === process.pid,
);
// …and the same holds when the garden DISAGREES (cross-review, 2026-09-04). The cell above
// exercises only the same-garden branch, so the retirement's guard could be the garden
// comparison alone and still look green; this one drives a UPS envelope naming a different
// session and pins the OTHER half — the event class. UPS cannot emit watchPaths, so a
// retirement reached from there could only ever subtract a doorbell.
//
// This is a mechanism cell, not a threat model: a keystroke from a session the process has
// already left is not something this host produces (measured: every UPS named its own pid's
// current session, 8 of 8). The rule it pins is simply that a watch is retired by a run that
// arms one, and this envelope is the cheapest way to reach the wrong branch on purpose.
driveHook({
	event: "UserPromptSubmit",
	nativeSessionId: GHOST_NATIVE,
	source: "startup",
	transcriptPath: path.join(CWD, `${GHOST_NATIVE}.jsonl`),
});
ok(
	"a MISMATCHED keystroke cannot disarm the live citizen either [QK:MHSS-RETIRE-ARM-CAPABLE-ONLY]",
	readMetaReceiverMarker({ gardenId: REAL_GID, receiversDir: ROOTS.receiversDir })?.ownerPid === process.pid,
);
// Put the pointer back where the operator's session left it, so the cells below measure the
// switch and not this deliberate corruption.
driveHook({
	event: "UserPromptSubmit",
	nativeSessionId: REAL_NATIVE,
	source: "startup",
	transcriptPath: REAL_TRANSCRIPT,
});

// ── B. the reader is fail-closed even when the stale marker is still there ────
// Re-plant exactly what the pre-repair hook left behind: a receiver marker for the
// retired garden, owned by a LIVE pid, identical to the record. Every axis the old
// predicate looked at says "active"; only the owner's sender marker says otherwise.
writeMetaReceiverMarker({
	gardenId: GHOST_GID,
	backend: "claude-code",
	nativeSessionId: GHOST_NATIVE,
	ownerPid: process.pid,
	armProvenance: "session-start",
	receiversDir: ROOTS.receiversDir,
});
const ghostIdentity = identityFor(GHOST_GID);
const realIdentity = identityFor(REAL_GID);
{
	const ghostFacts = resolveMailboxReceiverFacts(ghostIdentity, gateReaders);
	ok("the re-planted stale marker still passes the identity match (ownerAlive)", ghostFacts.ownerAlive);
	ok(
		"…but its watch is NOT armed — measured against the owner's sender marker, never copied [QK:MHSS-SENDER-JOIN-MEASURED]",
		ghostFacts.watchArmed === false,
	);
	const realFacts = resolveMailboxReceiverFacts(realIdentity, gateReaders);
	ok(
		"the served garden is alive AND armed (the join is not a blanket refusal)",
		realFacts.ownerAlive && realFacts.watchArmed,
	);
}

// ── B + C through the PRODUCTION seam, which is where the false success shipped ─
function deps() {
	return makeProductionEntwurfV2Deps({
		senderProvider: () => ({
			sessionId: "gate-sender",
			agentId: "meta-session/claude-code",
			cwd: CWD,
			timestamp: new Date().toISOString(),
			origin: "meta-session",
			replyable: true,
		}),
		sessionsDir: ROOTS.sessionsDir,
		mailboxDir: ROOTS.mailboxDir,
		lockDir: ROOTS.locksDir,
		controlSocketDir: ROOTS.socketsDir,
	});
}

const ghostDecision = (await deps().decide({
	target: GHOST_GID,
	intent: "fire-and-forget",
	message: "into the void?",
})) as DispatchDecision;
ok(
	"production dispatch REFUSES the retired garden — the false deliverable, at the seam [QK:MHSS-SEAM-USES-JOIN]",
	ghostDecision.kind === "reject" && ghostDecision.receipt.reason === "mailbox-undeliverable",
);
ok(
	"the reject carries the predicate's reason instead of dropping it at the decider boundary [QK:MHSS-REJECT-CARRIES-REASON]",
	ghostDecision.kind === "reject" &&
		ghostDecision.diagnostic?.kind === "mailbox-undeliverable" &&
		/idle-watch not armed/.test(ghostDecision.diagnostic.reason),
);

const realDecision = (await deps().decide({
	target: REAL_GID,
	intent: "fire-and-forget",
	message: "to the conversation the operator is in",
})) as DispatchDecision;
ok(
	"the served garden is still deliverable — exactly ONE of the two, and it is the live one [QK:MHSS-EXACTLY-ONE-DELIVERABLE]",
	realDecision.kind === "execute" && realDecision.plan.transport === "meta-mailbox" && ghostDecision.kind === "reject",
);

// C — the surface has to SAY it. A caller that reads only "mailbox-undeliverable" goes
// looking for a dead session; this one was alive and had moved.
{
	const rendered = renderEntwurfV2Result(
		await runEntwurfV2({ target: GHOST_GID, intent: "fire-and-forget", message: "into the void?" }, deps()),
	);
	ok(
		"the rendered reject names the failing receiver axis [QK:MHSS-REASON-RENDERED]",
		rendered.isError && /mailbox-undeliverable: .*idle-watch not armed/.test(rendered.text),
	);
}

// A real delivery to the live garden still lands, in the sandbox mailbox.
{
	const result = await runEntwurfV2(
		{ target: REAL_GID, intent: "fire-and-forget", message: "hello, live citizen" },
		deps(),
	);
	ok(
		"a message to the served garden is enqueued into ITS mailbox",
		result.kind === "executed" &&
			result.transport === "meta-mailbox" &&
			existsSync(path.join(ROOTS.mailboxDir, REAL_GID)),
	);
}

// ── the join's THREE edges, each of which a mutant would otherwise walk through ─
// (cross-review, 2026-09-04: the cells above never varied ownerKind, never planted a stale
// sender start-key, and never disagreed on backend, so three real weakenings survived them.)
{
	// EDGE 1 — the join is scoped by ownerKind, and outside that scope its ABSENCE is not a
	// failure. A Copilot watch lives in a forked first-party extension child with its own pid,
	// so `meta-senders/copilot/<that pid>.json` never exists by construction. If the join were
	// applied there, every Copilot citizen would be permanently undeliverable — a regression on
	// a shipped lane dressed as a fix.
	const copilot = upsertMetaSession({
		input: {
			backend: "copilot",
			nativeSessionId: "copilot-extension-owned",
			transcriptPath: REAL_TRANSCRIPT,
			cwd: CWD,
		},
		dir: ROOTS.sessionsDir,
	});
	writeMetaReceiverMarker({
		gardenId: copilot.record.gardenId,
		backend: "copilot",
		nativeSessionId: copilot.record.nativeSessionId,
		ownerPid: process.pid,
		ownerKind: "copilot-extension",
		armProvenance: "extension-join",
		receiversDir: ROOTS.receiversDir,
	});
	const facts = resolveMailboxReceiverFacts(copilot.record, gateReaders);
	ok(
		"a copilot-extension watch is ARMED with no sender marker of its own — the join does not apply there [QK:MHSS-JOIN-SCOPE-OWNERKIND]",
		facts.ownerAlive && facts.watchArmed,
	);
}
{
	// EDGE 2 — the sender marker is trusted only while its owner is the SAME live process. A
	// marker left by a dead session (or a reused pid) must not answer "which garden does this
	// pid serve now?", and the reader's start-key guard is what refuses it. A production reader
	// that asked with `verifyOwner: false` would accept this file, and every fixture pid here is
	// live, so nothing else in this gate could tell the difference.
	const senderFile = path.join(ROOTS.sendersDir, "claude-code", `${process.pid}.json`);
	const good = readFileSync(senderFile, "utf8");
	writeFileSync(senderFile, good.replace(/"ownerStartKey": "[^"]*"/, '"ownerStartKey": "STALE-FROM-A-DEAD-SESSION"'));
	const decision = (await deps().decide({
		target: REAL_GID,
		intent: "fire-and-forget",
		message: "with a stale sender marker",
	})) as DispatchDecision;
	ok(
		"a sender marker whose owner start-key no longer matches is refused, not read [QK:MHSS-SENDER-START-KEY-VERIFIED]",
		decision.kind === "reject" && decision.receipt.reason === "mailbox-undeliverable",
	);
	writeFileSync(senderFile, good);
}
{
	// EDGE 3 — the join compares backend as well as garden id. Two backends can key markers under
	// one pid (a Claude CLI that also hosts another harness's writer), and a marker whose body
	// names a different backend than the receiver it is being joined to is not that receiver's
	// evidence. Every fixture above shares one backend, so the comparison was free to disappear.
	const senderFile = path.join(ROOTS.sendersDir, "claude-code", `${process.pid}.json`);
	const good = readFileSync(senderFile, "utf8");
	writeFileSync(senderFile, good.replace(/"backend": "claude-code"/, '"backend": "copilot"'));
	const decision = (await deps().decide({
		target: REAL_GID,
		intent: "fire-and-forget",
		message: "with a backend-drifted sender marker",
	})) as DispatchDecision;
	ok(
		"a sender marker naming another backend does not vouch for this receiver [QK:MHSS-JOIN-BACKEND-EQUALITY]",
		decision.kind === "reject" && decision.receipt.reason === "mailbox-undeliverable",
	);
	writeFileSync(senderFile, good);
}

// ── D. the listing has to SHOW the difference (#101 갭 D) ────────────────────
// This is the surface a caller actually reads before dispatching. Both citizens are
// `liveness=unsupported` (claude-code has no control socket to probe), same cwd, same
// backend — identical rows, which is how a sibling picked the phantom. The two observed
// axes are what separate them, and they are measured through the REAL observer the
// provider defaults to, against this sandbox.
{
	const listing = await listEntwurfFacts({
		metaEntries: readActiveStoreEntries(ROOTS.sessionsDir),
		readRecord: makeStoreRecordReader(ROOTS.sessionsDir),
		socket: { dir: ROOTS.socketsDir },
	});
	const ghostRow = listing.facts.peers.find((p) => p.gardenId === GHOST_GID);
	const realRow = listing.facts.peers.find((p) => p.gardenId === REAL_GID);
	ok(
		"both citizens are listed, and both read liveness=unsupported (the axis that cannot tell them apart)",
		ghostRow?.liveness === "unsupported" && realRow?.liveness === "unsupported",
	);
	ok(
		"the abandoned row shows a transcript that was never written [QK:MHSS-PEERS-TRANSCRIPT-OBSERVED]",
		ghostRow?.transcript === "absent" && realRow?.transcript === "exists",
	);
	// The stale marker re-planted above is still on disk, so the ghost reads `inactive`
	// (a marker that fails the join) rather than `none` (no marker at all) — the split a
	// reader needs to tell "was armed, no longer valid" from "never armed".
	ok(
		"the abandoned row shows an inactive receiver beside the live one [QK:MHSS-PEERS-RECEIVER-OBSERVED]",
		ghostRow?.receiver === "inactive" && realRow?.receiver === "active",
	);
	const { text } = renderEntwurfPeers(listing);
	ok(
		"the rendered row carries both observed columns [QK:MHSS-PEERS-COLUMNS-RENDERED]",
		new RegExp(`${GHOST_GID}.*receiver=inactive.*transcript=absent`).test(text) &&
			new RegExp(`${REAL_GID}.*receiver=active.*transcript=exists`).test(text),
	);
	ok("the listing still routes no verbs (facts only)", !/sendable|resumable|dispatch|mailboxDeliverable/.test(text));
}

// ── a retirement must never reach a watch ANOTHER live process holds ─────────
// The switch rule is "this pid stopped serving that garden", so the marker it removes
// has to be this pid's own. Re-plant the served garden's marker under a different LIVE
// pid (this gate's parent) and switch again: the hook still wants to retire that garden,
// and must not, because the doorbell now belongs to someone else. Getting this wrong is
// not a stale marker — it is one session silently disarming another's inbox.
{
	writeMetaReceiverMarker({
		gardenId: REAL_GID,
		backend: "claude-code",
		nativeSessionId: REAL_NATIVE,
		ownerPid: process.ppid,
		armProvenance: "session-start",
		receiversDir: ROOTS.receiversDir,
	});
	driveHook({
		event: "SessionStart",
		nativeSessionId: "cafe0000-another-conversation",
		source: "clear",
		transcriptPath: path.join(CWD, "cafe0000.jsonl"),
	});
	ok(
		"a retirement leaves a marker owned by another live pid alone [QK:MHSS-RETIRE-ONLY-OWN-OWNER]",
		readMetaReceiverMarker({ gardenId: REAL_GID, receiversDir: ROOTS.receiversDir, verifyOwner: false })?.ownerPid ===
			process.ppid,
	);
}

console.log(`\ncheck-meta-hook-session-switch: ${passed} assertions passed`);
