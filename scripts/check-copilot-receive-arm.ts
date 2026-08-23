/**
 * check-copilot-receive-arm — #82 RAIL 5 gate: the Copilot RECEIVER, proven without
 * Copilot.
 *
 * WHAT IT BINDS. The chain from the shipped unit to a citizen a sender may deliver to:
 *
 *   copilot-receive-bridge.sh install    (the REAL installer, into a temp extensions dir)
 *     -> the vendor's required entry name, with the compiled lib beside it
 *       -> the REAL extension.mjs, forked the way Copilot forks it (stdio child, the SDK
 *          specifier resolved by a loader hook — the same mechanism the vendor's own
 *          `extension_sdk_resolver.mjs` uses)
 *         -> an arm that WAITS for birth, then binds to the record
 *           -> a receiver marker owned by the WATCHER pid
 *             -> mailboxConversationalDeliverable(copilot) === true
 *               -> a mailbox poke rings ONE doorbell that carries the id, not the body
 *
 * WHY IT DRIVES THE INSTALLER. Same reason the birth gate does: a gate that staged the
 * unit itself would assert against its own copy of the layout, and the shipped installer
 * could drift underneath it and stay green. The install is also where the ownership
 * refusals live, so they are exercised here rather than described.
 *
 * WHY A STUB SDK IS FAITHFUL ENOUGH — AND WHERE IT STOPS. The stub answers exactly what
 * the vendor contract gives an extension: a `sessionId` from `joinSession()`, an event
 * subscription, and a `send()` that returns a message id. Everything this gate asserts is
 * on OUR side of that boundary — which garden id we bind to, which pid owns the marker,
 * what the doorbell says, and when we refuse. What it CANNOT prove is that a real Copilot
 * turn starts on `session.send({mode:"enqueue"})`; that is a live-harness fact, measured
 * separately (raw transport receipt, 2026-08-23) and owed again by the managed lane's LIVE
 * acceptance. A green run here is mechanism evidence, never admission.
 *
 * Hermetic: temp dirs only, no network, no Copilot, no model turn. Needs the compiled
 * bridge closure (`pnpm run build-bridge`), because the receiver ships compiled JS on
 * purpose — the CLI's own Node runs it.
 */

import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	mailboxConversationalDeliverable,
	receiverMarkerMatchesIdentity,
} from "../pi-extensions/lib/entwurf-deliverability.ts";
import {
	enqueueMetaMessage,
	metaCapabilityFor,
	readMetaIdentityByGardenId,
	readMetaReceiverMarker,
	upsertMetaSession,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = "entwurf-receive";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Poll a predicate up to `ms`. Returns whether it became true — never throws, so the
 * assertion that follows names the missing fact instead of a timeout stack. */
async function waitUntil(fn: () => boolean, ms = 15000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			if (fn()) return true;
		} catch {
			/* the store may be mid-write; keep polling */
		}
		await sleep(40);
	}
	try {
		return fn();
	} catch {
		return false;
	}
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-copilot-receive."));
const home = path.join(root, "home");
const store = path.join(root, "agent");
const extRoot = path.join(root, "extensions");
const xdg = path.join(root, "xdg");
for (const d of [home, store, extRoot, xdg]) mkdirSync(d, { recursive: true });
// Every lib call in THIS process resolves into the sandbox too, so the gate's own
// record/marker writes never touch the operator's store (Hard Rule 12).
process.env.PI_CODING_AGENT_DIR = store;
delete process.env.ENTWURF_META_SESSIONS_DIR;
delete process.env.ENTWURF_META_SENDERS_DIR;
delete process.env.ENTWURF_META_RECEIVERS_DIR;
delete process.env.ENTWURF_META_MAILBOX_DIR;

/**
 * The compiled writer the receiver ships, wherever it can be had.
 *
 * A dev clone and CI both have `mcp/entwurf-bridge/dist` (build-bridge runs from
 * `prepare`). The gate-qualification SNAPSHOT does not: it replicates the git surface,
 * and dist is gitignored — so a gate that simply required dist would be CONTROL-RED in
 * every mutant run, proving nothing about any mutation. Emitting the two-file closure
 * into a temp dir costs a couple of seconds and keeps the gate honest in both worlds.
 * The emit uses the repo's OWN tsc flags (extends the bridge build config's parent, same
 * `rewriteRelativeImportExtensions`), so what is installed here is what ships.
 */
function compiledLibDir(): string {
	const dist = path.join(REPO, "mcp", "entwurf-bridge", "dist", "pi-extensions", "lib");
	if (existsSync(path.join(dist, "meta-session.js"))) return dist;
	const outDir = path.join(root, "closure");
	const cfg = path.join(root, "tsconfig.receive-closure.json");
	writeFileSync(
		cfg,
		JSON.stringify({
			extends: path.join(REPO, "tsconfig.json"),
			compilerOptions: {
				allowImportingTsExtensions: true,
				rewriteRelativeImportExtensions: true,
				noEmit: false,
				declaration: false,
				sourceMap: false,
				outDir,
				rootDir: REPO,
				// The config lives in a temp dir, so `types: ["node"]` would resolve against
				// a directory with no node_modules. Point type resolution back at the repo.
				typeRoots: [path.join(REPO, "node_modules", "@types")],
			},
			exclude: [path.join(REPO, "node_modules")],
			include: [path.join(REPO, "pi-extensions", "lib", "meta-session.ts")],
		}),
	);
	const tsc = path.join(REPO, "node_modules", ".bin", "tsc");
	execFileSync(existsSync(tsc) ? tsc : "tsc", ["-p", cfg], { cwd: REPO, stdio: "pipe" });
	return path.join(outDir, "pi-extensions", "lib");
}

const installEnv = {
	...process.env,
	HOME: home,
	XDG_DATA_HOME: xdg,
	COPILOT_EXTENSIONS_DIR: extRoot,
	PI_CODING_AGENT_DIR: store,
	ENTWURF_COPILOT_RECEIVE_LIB_DIR: compiledLibDir(),
};

// ── 1. the real installer ────────────────────────────────────────────────────
// Through `run.sh`, not straight at the script: the verb dispatch is part of the install
// surface (check-pack-install once caught a verb that its own script refused).
//
// `|| true` is not leniency — it is what makes the claim below REACHABLE. An installer
// that produces the wrong entry name also fails while stamping its install-state, so an
// exec that threw would kill this gate before a single assertion ran: the defect would be
// caught, but nothing would say WHICH contract broke (measured as WRONG-REASON in gate
// qualification). Capture the run, then assert the artifact.
const installOut = execFileSync(
	"bash",
	["-c", `bash ${JSON.stringify(path.join(REPO, "run.sh"))} install-copilot-receive 2>&1 || true`],
	{ env: installEnv, encoding: "utf8" },
);
const unitDir = path.join(extRoot, UNIT);
const entry = path.join(unitDir, "extension.mjs");
// THE ARTIFACT CLAIM COMES FIRST, before "did the installer say it worked". An install
// that lands the wrong entry name also dies stamping its install-state, so an
// install-output assertion in front of this one would take the blame for a defect it
// does not name — which is precisely what gate qualification reported as WRONG-REASON.
// The vendor discovers a unit by this exact file name; nothing else about the install is
// worth asserting until that is true.
ok(
	"[QK:COPILOT-RECEIVE-VENDOR-ENTRY-NAME] the installed unit is `<dir>/extension.mjs` — the vendor's required entry name",
	existsSync(entry),
);
ok("the install ran to completion and said where it landed", installOut.includes("installed the receiver unit at"));
ok(
	"the compiled lib and the capability registry travel inside the unit",
	existsSync(path.join(unitDir, "lib", "meta-session.js")) &&
		existsSync(path.join(unitDir, "entwurf-capabilities.json")),
);
const stateFile = path.join(xdg, "entwurf", "copilot-receive", "install-state.json");
ok("install-state records the path it owns", JSON.parse(readFileSync(stateFile, "utf8")).path === unitDir);

// Ownership: a unit this installer did not put there is somebody else's, and the state
// file is the only thing that licenses a replacement.
{
	const foreignRoot = path.join(root, "foreign-extensions");
	mkdirSync(path.join(foreignRoot, UNIT), { recursive: true });
	writeFileSync(path.join(foreignRoot, UNIT, "extension.mjs"), "// somebody else's unit\n");
	const res = execFileSync(
		"bash",
		["-c", `bash ${JSON.stringify(path.join(REPO, "run.sh"))} install-copilot-receive 2>&1 || true`],
		{
			env: { ...installEnv, COPILOT_EXTENSIONS_DIR: foreignRoot, XDG_DATA_HOME: path.join(root, "xdg-empty") },
			encoding: "utf8",
		},
	);
	ok(
		"[QK:COPILOT-RECEIVE-INSTALL-REFUSES-FOREIGN] an unclaimed unit of the same name is REFUSED, not overwritten",
		res.includes("Refusing to overwrite") &&
			readFileSync(path.join(foreignRoot, UNIT, "extension.mjs"), "utf8").includes("somebody else"),
	);
}

// ── 2. the stub SDK — the vendor boundary, and nothing past it ───────────────
const stubDir = path.join(root, "sdk-stub");
mkdirSync(stubDir, { recursive: true });
writeFileSync(
	path.join(stubDir, "extension.js"),
	`import fs from "node:fs";
const box = process.env.STUB_BOX;
export async function joinSession() {
	const handlers = new Map();
	let last = "";
	// The CLI drives events; here the gate does, through a file. Kept REFERENCED so the
	// child stays alive before it arms — exactly as the real CLI child does.
	setInterval(() => {
		let cur = "";
		try { cur = fs.readFileSync(box + "/emit", "utf8").trim(); } catch {}
		if (cur && cur !== last) {
			last = cur;
			for (const h of handlers.get(cur) ?? []) h({ type: cur, data: {} });
		}
	}, 25);
	return {
		sessionId: process.env.STUB_SESSION_ID,
		on(type, handler) {
			if (!handlers.has(type)) handlers.set(type, []);
			handlers.get(type).push(handler);
			return () => {};
		},
		async send(options) {
			fs.appendFileSync(box + "/sends.jsonl", JSON.stringify(options) + "\\n");
			return "stub-message-id";
		},
	};
}
`,
);
writeFileSync(
	path.join(stubDir, "loader.mjs"),
	`import { pathToFileURL } from "node:url";
export async function resolve(specifier, context, nextResolve) {
	if (specifier === "@github/copilot-sdk/extension") {
		return { url: pathToFileURL(process.env.STUB_SDK).href, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
`,
);
writeFileSync(
	path.join(stubDir, "register.mjs"),
	`import { register } from "node:module";
register("./loader.mjs", import.meta.url);
`,
);

interface Harness {
	child: ChildProcess;
	box: string;
	sends: () => string[];
	emit: (type: string) => void;
	log: () => string;
}

function launch(label: string, sessionId: string, extra: NodeJS.ProcessEnv = {}): Harness {
	const box = path.join(root, `box-${label}`);
	mkdirSync(box, { recursive: true });
	const child = spawn(process.execPath, ["--import", path.join(stubDir, "register.mjs"), entry], {
		env: {
			...process.env,
			HOME: home,
			PI_CODING_AGENT_DIR: store,
			STUB_BOX: box,
			STUB_SDK: path.join(stubDir, "extension.js"),
			STUB_SESSION_ID: sessionId,
			SESSION_ID: sessionId,
			// The vendor's carrier. This gate process IS the fork parent, which is also
			// what makes the sender-marker join real rather than mocked: the marker below
			// is written under the very pid the child will look itself up by.
			COPILOT_EXTENSION_PARENT_PID: String(process.pid),
			...extra,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.resume();
	child.stderr?.resume();
	return {
		child,
		box,
		sends: () => {
			const f = path.join(box, "sends.jsonl");
			return existsSync(f)
				? readFileSync(f, "utf8")
						.split("\n")
						.filter((l) => l.trim().length > 0)
				: [];
		},
		emit: (type: string) => writeFileSync(path.join(box, "emit"), `${type}\n`),
		log: () => {
			const f = path.join(store, "meta-bridge-receive-copilot.log");
			return existsSync(f) ? readFileSync(f, "utf8") : "";
		},
	};
}
const running: ChildProcess[] = [];
function stop(h: Harness): void {
	h.child.kill("SIGTERM");
}

// ── 3. no citizen yet → no arm, and no noise about it ────────────────────────
// A Copilot session is born on its FIRST PROMPT, so an extension that armed at CLI
// startup legitimately finds no sender marker. That is the ORDINARY state, not a fault:
// refusing loudly here would train an operator to ignore the log, and arming anyway
// would claim a receiver for a citizen that does not exist.
const NATIVE = "cop-recv-0001";
const main = launch("main", NATIVE);
running.push(main.child);
const receiversDir = path.join(store, "meta-receivers");
await sleep(600);
ok(
	"before birth: no receiver marker is written (a session with no record is not a citizen)",
	!existsSync(receiversDir) || readdirSync(receiversDir).length === 0,
);
ok(
	"before birth: the log records the join, not an error",
	main.log().includes("joined session=") && !main.log().includes("ERROR"),
);

// ── 4. birth, then the arm ───────────────────────────────────────────────────
// Exactly what the birth hook does on the first prompt, in the same order: record first
// (identity authority), then the sender marker that names its garden id — keyed to THIS
// process, the pid the child sees as its parent.
const born = upsertMetaSession({ input: { backend: "copilot", nativeSessionId: NATIVE, cwd: REPO } });
const GID = born.record.gardenId;
writeMetaSenderMarker({
	backend: "copilot",
	gardenId: GID,
	nativeSessionId: NATIVE,
	cwd: REPO,
	ownerPid: process.pid,
});
main.emit("user.message");
const markerFile = path.join(receiversDir, `${GID}.json`);
ok(
	"[QK:COPILOT-RECEIVE-ARMS-AFTER-BIRTH] the extension arms once the record and the sender marker exist",
	await waitUntil(() => existsSync(markerFile)),
);

const marker = readMetaReceiverMarker({ gardenId: GID });
ok("the armed marker reads back as LIVE (its owner is a running process)", marker !== null);
ok(
	"[QK:COPILOT-RECEIVE-OWNER-IS-WATCHER] the marker's owner is the EXTENSION child — the process that actually holds the watch",
	marker?.ownerPid === main.child.pid && marker?.ownerKind === "copilot-extension",
);
ok("the arm provenance names the vendor surface it came from", marker?.armProvenance === "extension-join");
ok(
	"the marker binds the record's identity (garden id, backend, native session id)",
	receiverMarkerMatchesIdentity(marker, readMetaIdentityByGardenId(GID)),
);

// ── 5. the capability this arm makes true ────────────────────────────────────
const capability = metaCapabilityFor("copilot");
ok(
	"[QK:COPILOT-RECEIVE-WAKE-MODE-SELF-FETCH] copilot's registered wake mode is self-fetch — the mailbox rail's entry condition",
	capability.wakeMode === "self-fetch",
);
// The SAME composition entwurf-v2-production.ts:217 performs, so a green cell here is the
// dispatch answer, not a lookalike of it.
function deliverability(): { deliverable: boolean; reason: string } {
	const m = readMetaReceiverMarker({ gardenId: GID });
	const matched = receiverMarkerMatchesIdentity(m, readMetaIdentityByGardenId(GID));
	return mailboxConversationalDeliverable({
		wakeMode: metaCapabilityFor("copilot").wakeMode,
		recordBacked: true,
		ownerAlive: matched,
		watchArmed: matched,
	});
}
ok("an armed Copilot citizen is mailbox-DELIVERABLE (the v2 seam's own composition)", deliverability().deliverable);

// ── 6. the doorbell: one ring, the id, never the body ────────────────────────
const SECRET = "body-that-must-not-be-injected-8f2a";
const mailbox = path.join(store, "meta-mailbox", GID);
enqueueMetaMessage({ gardenId: GID, body: `hello from the gate :: ${SECRET}` });
// Wait for the doorbell's OWN first act — the `.msg` -> `.msg.delivered` stamp — not just
// for "a send happened". A receiver that rang for something else satisfies a bare send
// count, and then every assertion below reads the wrong notice; that is how the
// stale-rering mutant came back WRONG-REASON instead of killed.
ok(
	"the poke rings the doorbell",
	await waitUntil(() => readdirSync(mailbox).some((f) => f.endsWith(".msg.delivered")) && main.sends().length >= 1),
);
const sent = main.sends();
const notice = JSON.parse(sent[sent.length - 1] ?? "{}") as { prompt?: string; mode?: string };
ok(
	"[QK:COPILOT-RECEIVE-DOORBELL-NOT-BODY] the notice announces the inbox and does NOT carry the message body",
	typeof notice.prompt === "string" &&
		notice.prompt.includes(GID) &&
		notice.prompt.includes("entwurf_inbox_read") &&
		!notice.prompt.includes(SECRET),
);
ok("it is enqueued, not forced into a running turn", notice.mode === "enqueue");
ok(
	"the body stays in the mailbox, stamped as DELIVERED (a wake attempt) and not as read",
	!readdirSync(mailbox).some((f) => f.endsWith(".read")),
);

// A bare poke with no fresh body must not re-ring: the backlog belongs to the model's own
// read, and re-announcing it would wake a session for nothing. The COUNT carries this
// claim twice over — a receiver that rings on every poke has usually already rung once at
// arm time, on an empty mailbox, long before this poke happens.
writeFileSync(path.join(mailbox, "inbox.signal"), `${new Date().toISOString()}\n`);
await sleep(700);
ok(
	"[QK:COPILOT-RECEIVE-NO-STALE-RERING] one message, one ring: an empty mailbox and a bare poke both ring nothing",
	main.sends().length === 1,
);

// ── 7. the refusals — each one names its own cause ───────────────────────────
// A drifted id is the dangerous one: a marker written against it would tell a sender
// that a reply lands in a session that will never see it.
{
	const h = launch("drift", "cop-recv-SOMEONE-ELSE");
	running.push(h.child);
	await waitUntil(() => h.log().includes("id-drift"), 8000);
	ok(
		"[QK:COPILOT-RECEIVE-REFUSES-ID-DRIFT] a session whose SDK id disagrees with the record's native id does NOT arm",
		h.log().includes("arm-refused") && h.log().includes("id-drift") && readdirSync(receiversDir).length === 1,
	);
	stop(h);
}
// An untrusted parent: the vendor's carrier and our real parent disagree, so the sender
// marker we would read belongs to somebody else's session.
//
// THE ORACLE IS PER-PROCESS, and it has to be. This log is host-shared and the refusing
// child would arm the SAME garden id as the healthy one — so "the log says arm-refused"
// (a line the id-drift child already wrote) and "one marker file exists" (the count is
// unchanged by an overwrite) are both satisfied with the guard REMOVED. Gate
// qualification proved exactly that: the mutant SURVIVED. What discriminates is this
// child's own refusal line, and the fact that the armed marker still belongs to the
// process that legitimately holds the watch.
{
	const h = launch("foreign-parent", NATIVE, { COPILOT_EXTENSION_PARENT_PID: String(process.pid + 1) });
	running.push(h.child);
	const ownRefusal = `pid=${h.child.pid} arm-refused: COPILOT_EXTENSION_PARENT_PID=`;
	await waitUntil(() => h.log().includes(ownRefusal), 8000);
	ok(
		"[QK:COPILOT-RECEIVE-REFUSES-FOREIGN-PARENT] a parent-pid carrier that disagrees with the real parent does NOT arm — it refuses under its OWN pid, and the marker keeps belonging to the process that holds the watch",
		h.log().includes(ownRefusal) && readMetaReceiverMarker({ gardenId: GID })?.ownerPid === main.child.pid,
	);
	stop(h);
}

// ── 8. the arm is given back when the watcher goes ───────────────────────────
// Two separate facts, and the second is the load-bearing one: teardown REMOVES the
// marker, and even if it could not, a marker whose owner is gone reads as inactive.
stop(main);
ok("a terminated extension removes its own marker", await waitUntil(() => !existsSync(markerFile), 8000));
writeFileSync(
	markerFile,
	JSON.stringify({
		gardenId: GID,
		backend: "copilot",
		nativeSessionId: NATIVE,
		ownerPid: main.child.pid,
		ownerStartKey: "ghost-start-key",
		ownerKind: "copilot-extension",
		armProvenance: "extension-join",
		updatedAt: new Date().toISOString(),
	}),
	{ mode: 0o600 },
);
ok(
	"[QK:COPILOT-RECEIVE-DEAD-EXTENSION-REFUSED] a marker whose watcher is gone is NOT deliverable — the reply is refused, not enqueued into a void",
	!deliverability().deliverable,
);
rmSync(markerFile, { force: true });

// ── 9. the doctor: it must SEE the two silent failures ───────────────────────
// A doctor that only certifies files is a doctor for problems that were never the
// problem. These two cells are the ones that cost a real session: a deployed writer the
// checkout has moved past, and a CLI launched without the scan flag.
function doctor(env: NodeJS.ProcessEnv = {}): string {
	return execFileSync(
		"bash",
		["-c", `bash ${JSON.stringify(path.join(REPO, "run.sh"))} doctor-copilot-receive 2>&1 || true`],
		// The live-process axis is host-global, so the gate SUPPLIES the process set
		// (empty unless a cell is testing that branch) — otherwise a copilot the operator
		// happens to be running would decide this gate's colour.
		{ env: { ...installEnv, ENTWURF_COPILOT_RECEIVE_PIDS: "", ...env }, encoding: "utf8" },
	);
}
ok(
	"a clean install passes the doctor, and it says WHICH writer is deployed",
	doctor().includes("the deployed writer matches this checkout's compiled writer"),
);
{
	// Exactly the failure this lane hit while it was being built: the unit kept a copy of
	// a writer that predated the `extension-join` provenance, every arm threw inside the
	// extension, and the only symptom was a citizen that never became deliverable.
	const deployed = path.join(unitDir, "lib", "meta-session.js");
	const good = readFileSync(deployed, "utf8");
	writeFileSync(
		deployed,
		`${good}
// a writer this checkout has moved past
`,
	);
	const out = doctor();
	ok(
		"[QK:COPILOT-RECEIVE-DOCTOR-CATCHES-STALE-WRITER] a deployed writer that differs from this checkout's is called STALE, not merely present",
		out.includes("the deployed writer is STALE") && out.includes("FAIL"),
	);
	writeFileSync(deployed, good);
}
{
	// The flag branch, on REAL processes: one launched with the scan flag and one without,
	// judged from their own /proc environment.
	const withFlag = spawn("sleep", ["30"], { env: { ...process.env, COPILOT_CLI_ENABLED_FEATURE_FLAGS: "EXTENSIONS" } });
	const withoutFlag = spawn("sleep", ["30"], { env: { ...process.env, COPILOT_CLI_ENABLED_FEATURE_FLAGS: "" } });
	running.push(withFlag, withoutFlag);
	await sleep(200);
	const armedOut = doctor({ ENTWURF_COPILOT_RECEIVE_PIDS: String(withFlag.pid) });
	ok("a CLI carrying the scan flag is reported as such", armedOut.includes("carry COPILOT_CLI_ENABLED_FEATURE_FLAGS"));
	const barefootOut = doctor({ ENTWURF_COPILOT_RECEIVE_PIDS: String(withoutFlag.pid) });
	ok(
		"[QK:COPILOT-RECEIVE-DOCTOR-SEES-MISSING-FLAG] a CLI launched WITHOUT the scan flag is red — that session can never arm, and Copilot says nothing about it",
		barefootOut.includes("lack COPILOT_CLI_ENABLED_FEATURE_FLAGS") && barefootOut.includes("FAIL"),
	);
	withFlag.kill("SIGKILL");
	withoutFlag.kill("SIGKILL");
}
{
	// THE ORIGINAL DEFECT OF THIS LANE, made a permanent cell: a HEALTHY INFO-only log
	// once killed the doctor mid-section — `set -euo pipefail` turned a no-match grep
	// (exit 1) into the assignment's status and -e ended the script before any verdict.
	// The failure shape is "no final line and a non-zero exit", which a substring
	// assertion cannot see: only the doctor's own PASS verdict as the LAST line plus
	// exit 0 can. Refused WARN lines are present here on purpose (the drift/foreign-parent
	// cells above wrote them) — they must stay notes, not red.
	const clean = spawnSync("bash", [path.join(REPO, "run.sh"), "doctor-copilot-receive"], {
		env: { ...installEnv, ENTWURF_COPILOT_RECEIVE_PIDS: "" },
		encoding: "utf8",
	});
	ok(
		"[QK:COPILOT-RECEIVE-DOCTOR-PASSES-CLEAN-LOG] a healthy log ends in the doctor's own PASS verdict and exit 0 — no silent mid-script death",
		clean.status === 0 && clean.stdout.trimEnd().endsWith("[copilot-receive-doctor] PASS"),
	);
}

// ── 10. the installer's honest inverse ───────────────────────────────────────
execFileSync("bash", [path.join(REPO, "run.sh"), "uninstall-copilot-receive"], { env: installEnv, stdio: "pipe" });
ok("uninstall removes the unit it installed and clears its state", !existsSync(unitDir) && !existsSync(stateFile));

for (const c of running) c.kill("SIGKILL");
rmSync(root, { recursive: true, force: true });
console.log(`\n[check-copilot-receive-arm] PASS (${passed} assertions)`);
