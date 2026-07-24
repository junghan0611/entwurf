/**
 * check-agy-sender-identity — deterministic gate for the #46 sender-identity lane: the agy
 * hook WRITES the marker, and the bridge's resolver READS it into exactly one identity or
 * refuses.
 *
 * The bug this closes: a birthed agy conversation called entwurf_v2 for real (MCP tool call,
 * not shell-out) and its message still landed as `external-mcp/unknown-host`, non-replyable.
 * The bridge held the owner pid but had no marker to look up: the hook wrote only the
 * meta-record, and the resolver searched the `claude-code` marker directory alone.
 *
 * BEHAVIORAL, not source-regex: the resolver runs against isolated marker/record stores, and
 * the hook runs as a real child process (so the marker's ownerPid is THIS gate's pid — the
 * same parent-pid join the bridge performs in production).
 *
 * Rows:
 *   WRITER (real subprocess)
 *     - hook writes an antigravity marker keyed by its PARENT pid, matching the record it minted
 *     - upsert failure writes NO marker (record authority first — never a garden-id with no record)
 *   RESOLVER (real store)
 *     - 0 markers → null (anonymous; the caller decides whether that is fatal)
 *     - 1 trusted → that identity, on EITHER backend (the claude-code-only lookup was the bug)
 *     - marker with no backing record → null (a hint is not an identity)
 *     - marker whose nativeSessionId drifted from its record → null
 *     - marker with an EXISTING but unreadable (pre-cut v2) record → THROW quoting the M1
 *       command (F10 — the null collapse reported "no marker found", the wrong cause)
 *     - 2 distinct live identities on one owner pid → THROW (never guess, never downgrade)
 *     - 2 markers naming the SAME identity → NOT a conflict (an older release wrote parent AND
 *       grandparent markers; both may still sit on disk)
 *   DOMAIN (the rail the bridge picks the replyable fact from)
 *     - antigravity is native-push, claude-code is not — so an agy sender's replyable comes from
 *       the adapter probe, never from a mailbox watch it can never arm (보정①)
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { nativePushSupported } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import {
	EntwurfSenderIdentityAmbiguityError,
	EntwurfSenderRecordUnreadableError,
	META_SENDER_BACKENDS,
	probeNativeSenderAlive,
	resolveTrustedMetaSenderIdentity,
} from "../pi-extensions/lib/meta-sender-identity.ts";
import {
	M1_MIGRATE_COMMAND,
	type MetaIdentity,
	upsertMetaSession,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";
import type { NativePushAdapter } from "../pi-extensions/lib/native-push/adapter.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO_DIR, "scripts", "agy-imprint.ts");

// Isolated stores — this gate never touches the operator's real garden. XDG_STATE_HOME is
// isolated too: the hook's own log lives under it, and a gate that appends fabricated
// "upsert-failed" lines to the operator's real agy-imprint.log would be planting false
// evidence in the exact file a live agy debugging session reads.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-sender-identity-"));
const SESSIONS_DIR = path.join(ROOT, "meta-sessions");
const SENDERS_DIR = path.join(ROOT, "meta-senders");
const STATE_DIR = path.join(ROOT, "state");
process.env.ENTWURF_META_SESSIONS_DIR = SESSIONS_DIR;
process.env.ENTWURF_META_SENDERS_DIR = SENDERS_DIR;
process.env.XDG_STATE_HOME = STATE_DIR;

// The owner pid the markers are keyed to. process.pid is alive by construction, so
// writeMetaSenderMarker's start-key is a real one and the read-side pid-reuse guard passes —
// exactly as an agy host pid does in production.
const OWNER = process.pid;
const resolve = () => resolveTrustedMetaSenderIdentity({ ownerPids: [OWNER], sendersDir: SENDERS_DIR });

function clearMarkers(): void {
	fs.rmSync(SENDERS_DIR, { recursive: true, force: true });
}

try {
	// ── WRITER: the real hook, as a real child process ───────────────────────
	{
		// A synthetic id on purpose: a REAL conversation id here would write plausible-looking
		// imprint lines that a later reader could mistake for live evidence.
		const conversationId = "00000000-gate-0000-0000-agyimprint01";
		const payload = JSON.stringify({
			conversationId,
			workspacePaths: [REPO_DIR],
			modelName: "gemini-3.1-pro-low",
		});
		const stdout = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--disable-warning=ExperimentalWarning", HOOK],
			{ input: payload, encoding: "utf8", env: process.env },
		);
		ok(
			"hook still prints the PreInvocation neutral response (the agy loop must never break)",
			stdout.trim() === '{"injectSteps":[]}',
		);

		// The hook's parent IS this gate — the same shape as production, where the hook's parent
		// is the agy host that also parents the bridge. So the marker must land under OUR pid.
		const markerPath = path.join(SENDERS_DIR, "antigravity", `${OWNER}.json`);
		ok("hook writes an antigravity sender marker keyed by its PARENT pid", fs.existsSync(markerPath));

		const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
		ok("marker carries backend=antigravity", marker.backend === "antigravity");
		ok("marker's nativeSessionId is the agy conversationId", marker.nativeSessionId === conversationId);
		ok(
			"marker is start-key guarded (pid alone is reused; pid+start is boot-unique)",
			typeof marker.ownerStartKey === "string" && marker.ownerStartKey.length > 0,
		);

		// End-to-end: the bridge's resolver, over what the hook actually wrote.
		const trusted = resolve();
		ok("resolver turns the hook's marker into ONE trusted identity", trusted !== null);
		ok("resolved identity is the agy citizen the hook minted", trusted?.identity.gardenId === marker.gardenId);
		ok(
			"resolved identity carries backend=antigravity (this is what stops external-mcp/unknown-host)",
			trusted?.identity.backend === "antigravity",
		);
	}

	// ── TRACE CONTRACT: the owner-topology trace is OPT-IN, and stays that way ────
	// PreInvocation runs before EVERY model turn. A trace left on by default would walk /proc six
	// times per turn and append to the imprint log forever — an unbounded diagnostic in the file
	// whose job is to hold birth evidence. It earned its place while proving the pid join and must
	// now cost nothing until someone asks for it, so the DEFAULT is what this gate owns.
	{
		const logFile = path.join(STATE_DIR, "entwurf", "agy-imprint.log");
		const runHook = (trace: boolean) =>
			execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", HOOK], {
				input: JSON.stringify({ conversationId: "00000000-gate-0000-0000-tracecontract", workspacePaths: [REPO_DIR] }),
				encoding: "utf8",
				env: trace ? { ...process.env, ENTWURF_AGY_TRACE_OWNER: "1" } : process.env,
			});

		fs.rmSync(logFile, { force: true });
		runHook(false);
		ok(
			"trace: default env writes NO ancestry line (no per-turn /proc walk, no unbounded log)",
			!fs.readFileSync(logFile, "utf8").includes("pids conversationId="),
		);
		ok(
			"trace: the useful evidence still lands (the marker write is what a healthy host needs)",
			fs.readFileSync(logFile, "utf8").includes("sender marker "),
		);

		fs.rmSync(logFile, { force: true });
		runHook(true);
		ok(
			"trace: ENTWURF_AGY_TRACE_OWNER=1 writes the ancestry line (the only way to say WHY a sender resolves anonymous)",
			/pids conversationId=.* ppid=\d+ chain=/.test(fs.readFileSync(logFile, "utf8")),
		);
	}

	// ── WRITER negative: no record → no marker ───────────────────────────────
	{
		clearMarkers();
		// A file where the record dir must be: upsertMetaSession cannot write, so it throws.
		const brokenRoot = path.join(ROOT, "broken-sessions");
		fs.writeFileSync(brokenRoot, "not a directory\n");
		execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", HOOK], {
			input: JSON.stringify({ conversationId: "dead-beef-0000", workspacePaths: [REPO_DIR] }),
			encoding: "utf8",
			env: { ...process.env, ENTWURF_META_SESSIONS_DIR: brokenRoot },
		});
		ok(
			"upsert failure writes NO sender marker (record authority first — no garden-id without a record)",
			!fs.existsSync(path.join(SENDERS_DIR, "antigravity")),
		);

		// The gate must be invisible to the operator's garden: the hook's log follows
		// XDG_STATE_HOME, so it has to land in the isolated root, never in ~/.local/state.
		ok(
			"hook's imprint log stays inside the isolated XDG_STATE_HOME (no writes to the operator's real log)",
			fs.existsSync(path.join(STATE_DIR, "entwurf", "agy-imprint.log")),
		);
	}
	clearMarkers();
	ok("no marker → null (anonymous; the caller decides whether that is fatal)", resolve() === null);

	// A trusted identity on EITHER backend. The claude-code-only lookup is the bug — an agy
	// citizen was invisible to the very bridge its own conversation spawned.
	for (const backend of META_SENDER_BACKENDS) {
		clearMarkers();
		const nativeSessionId = `native-${backend}`;
		const record = upsertMetaSession({ input: { backend, nativeSessionId, cwd: REPO_DIR } });
		writeMetaSenderMarker({
			backend,
			gardenId: record.record.gardenId,
			nativeSessionId,
			cwd: REPO_DIR,
			ownerPid: OWNER,
			sendersDir: SENDERS_DIR,
		});
		const trusted = resolve();
		ok(
			`backend ${backend}: live record-backed marker → trusted identity`,
			trusted?.identity.gardenId === record.record.gardenId,
		);
	}
	clearMarkers();
	writeMetaSenderMarker({
		backend: "antigravity",
		gardenId: "20260713T161524-0db936",
		nativeSessionId: "no-such-conversation",
		cwd: REPO_DIR,
		ownerPid: OWNER,
		sendersDir: SENDERS_DIR,
	});
	ok("marker with NO backing record → null (a stale marker names nobody)", resolve() === null);

	{
		clearMarkers();
		const record = upsertMetaSession({
			input: { backend: "antigravity", nativeSessionId: "conversation-A", cwd: REPO_DIR },
		});
		writeMetaSenderMarker({
			backend: "antigravity",
			gardenId: record.record.gardenId,
			nativeSessionId: "conversation-B", // drifted from the record
			cwd: REPO_DIR,
			ownerPid: OWNER,
			sendersDir: SENDERS_DIR,
		});
		ok("marker whose nativeSessionId drifted from its record → null", resolve() === null);
	}

	// THE F10 CASE. A live marker whose record EXISTS but is a pre-cut v2 file must
	// THROW naming the marker's citizen AND the M1 command — never resolve to null.
	// The null collapse is exactly what made the live surface claim "no live
	// meta-sender marker was found" (three false claims) and prescribe re-opening
	// the session (a fix that re-mints the same failure).
	{
		clearMarkers();
		const record = upsertMetaSession({
			input: { backend: "claude-code", nativeSessionId: "sess-precut", cwd: REPO_DIR },
		});
		const gid = record.record.gardenId;
		writeMetaSenderMarker({
			backend: "claude-code",
			gardenId: gid,
			nativeSessionId: "sess-precut",
			cwd: REPO_DIR,
			ownerPid: OWNER,
			sendersDir: SENDERS_DIR,
		});
		// Rewrite the record as a raw pre-cut v2 body (production has no v2 writer).
		fs.writeFileSync(
			path.join(SESSIONS_DIR, `${gid}.meta.json`),
			`${JSON.stringify({
				schemaVersion: 2,
				gardenId: gid,
				backend: "claude-code",
				nativeSessionId: "sess-precut",
				cwd: REPO_DIR,
				model: null,
				transcriptPath: null,
				parentGardenId: null,
				isEntwurf: false,
				createdAt: "2026-03-01T12:00:00.000Z",
				recordUpdatedAt: "2026-03-01T12:30:00.000Z",
			})}\n`,
		);
		let threw: unknown = null;
		try {
			resolve();
		} catch (err) {
			threw = err;
		}
		ok(
			"marker with an EXISTING but pre-cut (v2) record → THROW, never null (the F10 collapse)",
			threw instanceof EntwurfSenderRecordUnreadableError,
		);
		ok(
			"the refusal names the marker's citizen (so 'no marker found' can never be claimed)",
			threw instanceof EntwurfSenderRecordUnreadableError && threw.gardenId === gid && threw.message.includes(gid),
		);
		ok(
			"the refusal quotes the record reader's cause, which names the M1 migrate command",
			threw instanceof Error && threw.message.includes(M1_MIGRATE_COMMAND),
		);
		fs.rmSync(path.join(SESSIONS_DIR, `${gid}.meta.json`), { force: true });
	}

	// THE REFUSAL. One native host driving two live sessions breaks the pid→conversation
	// binding the marker rests on. We can see both identities and cannot name the caller, so
	// we send under neither: a wrong attribution is worse than no send, and a silent fallback
	// to anonymous would hide an identity we already hold.
	{
		clearMarkers();
		const a = upsertMetaSession({ input: { backend: "antigravity", nativeSessionId: "conv-A", cwd: REPO_DIR } });
		const b = upsertMetaSession({ input: { backend: "claude-code", nativeSessionId: "sess-B", cwd: REPO_DIR } });
		writeMetaSenderMarker({
			backend: "antigravity",
			gardenId: a.record.gardenId,
			nativeSessionId: "conv-A",
			cwd: REPO_DIR,
			ownerPid: OWNER,
			sendersDir: SENDERS_DIR,
		});
		writeMetaSenderMarker({
			backend: "claude-code",
			gardenId: b.record.gardenId,
			nativeSessionId: "sess-B",
			cwd: REPO_DIR,
			ownerPid: OWNER,
			sendersDir: SENDERS_DIR,
		});
		let threw: unknown = null;
		try {
			resolve();
		} catch (err) {
			threw = err;
		}
		ok(
			"two distinct live identities on one owner pid → THROW (never guess, never downgrade to anonymous)",
			threw instanceof EntwurfSenderIdentityAmbiguityError,
		);
		ok(
			"the refusal names both citizens so the wiring bug is debuggable",
			threw instanceof EntwurfSenderIdentityAmbiguityError && threw.gardenIds.length === 2,
		);
	}

	// Same identity reached twice is NOT ambiguity: an older release wrote a marker for the
	// parent AND the grandparent. Throwing there would refuse a send that has one honest answer.
	{
		clearMarkers();
		const record = upsertMetaSession({
			input: { backend: "antigravity", nativeSessionId: "conv-solo", cwd: REPO_DIR },
		});
		for (const pid of [OWNER, process.ppid]) {
			writeMetaSenderMarker({
				backend: "antigravity",
				gardenId: record.record.gardenId,
				nativeSessionId: "conv-solo",
				cwd: REPO_DIR,
				ownerPid: pid,
				sendersDir: SENDERS_DIR,
			});
		}
		const trusted = resolveTrustedMetaSenderIdentity({
			ownerPids: [OWNER, process.ppid],
			sendersDir: SENDERS_DIR,
		});
		ok(
			"two markers naming the SAME identity → not a conflict, one identity",
			trusted?.identity.gardenId === record.record.gardenId,
		);
	}
	ok(
		"antigravity is a native-push backend → its replyable comes from the adapter probe",
		nativePushSupported("antigravity"),
	);
	ok(
		"claude-code is NOT native-push → its replyable stays on the mailbox receiver axis (보정①: the rails never borrow each other's facts)",
		!nativePushSupported("claude-code"),
	);

	// ── PROBE ERROR POLICY: an adapter outcome is a FACT, a throw is a DEFECT ────
	// The adapter reports "not reachable" as a value (dead / indeterminate). So a throw out of the
	// probe can only be a broken registry or a probe that could not run at all. Folding that into
	// replyable:false would tell the receiver a lie about this sender AND bury the defect — the
	// exact Crash-Don't-Warn shape this lane exists to remove. It must propagate.
	{
		const identity: Pick<MetaIdentity, "backend" | "nativeSessionId"> = {
			backend: "antigravity",
			nativeSessionId: "conv-x",
		};
		const adapterWith = (probe: NativePushAdapter["probe"]) => ({ resolveAdapter: () => ({ probe }) });

		ok(
			"probe alive → replyable true",
			(await probeNativeSenderAlive(
				identity,
				adapterWith(async () => ({ status: "alive", route: { lsAddress: "127.0.0.1:1" } })),
			)) === true,
		);

		for (const status of ["dead", "indeterminate"] as const) {
			ok(
				`probe ${status} → replyable false (an adapter's OWN outcome is the fact)`,
				(await probeNativeSenderAlive(
					identity,
					adapterWith(async () => ({ status, reason: "gate" })),
				)) === false,
			);
		}

		let registryThrew = false;
		try {
			await probeNativeSenderAlive(identity, {
				resolveAdapter: () => {
					throw new Error("no native-push adapter owns backend id");
				},
			});
		} catch {
			registryThrew = true;
		}
		ok("unresolvable adapter → THROWS (a registry bug is not a fact about the citizen)", registryThrew);

		let probeThrew = false;
		try {
			await probeNativeSenderAlive(
				identity,
				adapterWith(async () => {
					throw new Error("pgrep: command not found");
				}),
			);
		} catch {
			probeThrew = true;
		}
		ok("probe runner blows up → THROWS, never a silent replyable:false (Crash-Don't-Warn)", probeThrew);
	}

	console.log(`\ncheck-agy-sender-identity: ${passed} checks passed`);
} finally {
	fs.rmSync(ROOT, { recursive: true, force: true });
}
