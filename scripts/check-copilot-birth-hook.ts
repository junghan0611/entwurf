/**
 * check-copilot-birth-hook — #82 gate: the Copilot BIRTH path, proven without Copilot.
 *
 * WHAT IT BINDS. The chain from the shipped unit to a real garden citizen:
 *
 *   copilot-bridge-install.sh --assemble-only   (the REAL assembler, into a temp dir)
 *     -> hooks.json baked: version 1, camelCase events, `exec` a STRING, no `args`
 *       -> the baked launcher, invoked with NO ARGV, envelope on stdin
 *         -> a v3 record with backend "copilot" in a temp store
 *           -> that record listed as a peer with liveness `unsupported`
 *
 * WHY IT DRIVES THE INSTALLER INSTEAD OF BUILDING THE ASSEMBLY ITSELF. A gate that
 * re-implemented the bake would be asserting against its own copy of the logic; the
 * shipped installer could then drift underneath it and stay green. `--assemble-only`
 * exists for this caller and stops before the Copilot CLI is touched, so the gate runs
 * on a host (and in CI) with no Copilot installed.
 *
 * WHY NO-ARGV IS THE CENTRAL CELL. Copilot's hook schema has no `args` key at all —
 * `exec` is a single string, and an array is rejected at plugin load. So a Copilot hook
 * ALWAYS starts with argc=0. The Claude launcher treats argc=0 as a hard error (it is
 * the only visible symptom of an older Claude dropping `args`), which is exactly why
 * Copilot held 0 of 409 meta-records until this unit existed. This gate fires the
 * launcher the way Copilot does — no argv — and requires a record.
 *
 * WHAT IT DOES NOT PROVE, and must not be read as proving. It proves the MECHANISM,
 * not the ADMISSION. §6 acceptance is a record minted by a real Copilot session, and a
 * Copilot session mints on its first prompt — a billed model turn. A synthetic envelope
 * through the real launcher is gate evidence; it is not a live citizen (cross-review,
 * terra, 2026-08-20).
 *
 * Hermetic: temp dirs only, no network, no Copilot, no model turn.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFactList } from "../pi-extensions/lib/entwurf-facts.ts";
import { nativePushSupported } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import { META_SENDER_BACKENDS, resolveTrustedMetaSenderIdentity } from "../pi-extensions/lib/meta-sender-identity.ts";
import { listAllMetaIdentitiesDir, processStartKey } from "../pi-extensions/lib/meta-session.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "entwurf-meta-receive-copilot";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-copilot-birth."));
const asm = path.join(root, "asm");

// ── 1. the real assembler ────────────────────────────────────────────────────
// Through `run.sh`, not straight at the script: the verb dispatch is part of the
// install surface, and calling the script directly skipped it. check-pack-install
// caught exactly that — run.sh's `$@` still carried the verb name, so a strict argument
// parser refused its own verb (2026-08-21). The gate now covers the path an operator
// actually types.
execFileSync("bash", [path.join(REPO, "run.sh"), "install-copilot-bridge", "--assemble-only"], {
	env: { ...process.env, ENTWURF_COPILOT_ASM: asm },
	stdio: "pipe",
});
const unit = path.join(asm, PLUGIN);
const launcher = path.join(unit, "scripts", "copilot-hook-launch.sh");
ok(
	"assembler produced the unit, the launcher and the capability registry",
	[
		path.join(asm, ".claude-plugin", "marketplace.json"),
		path.join(unit, ".claude-plugin", "plugin.json"),
		path.join(unit, "hooks", "hooks.json"),
		path.join(unit, "entwurf-capabilities.json"),
		launcher,
	].every((p) => existsSync(p)),
);

// ── 2. the manifest is the COPILOT form, not the Claude one ──────────────────
const hooks = JSON.parse(readFileSync(path.join(unit, "hooks", "hooks.json"), "utf8")) as {
	version?: unknown;
	hooks?: Record<string, Array<Record<string, unknown>>>;
};
ok("hooks.json declares the literal version 1 (Copilot rejects the plugin without it)", hooks.version === 1);
ok(
	"hook events are exactly the two camelCase events that fire on a first prompt",
	JSON.stringify(Object.keys(hooks.hooks ?? {}).sort()) === JSON.stringify(["sessionStart", "userPromptSubmitted"]),
);
const leaves = Object.values(hooks.hooks ?? {}).flat();
ok(
	"[QK:COPILOT-BIRTH-EXEC-IS-STRING] every hook entry's `exec` is a STRING (an array is rejected at plugin load)",
	leaves.every((l) => typeof l.exec === "string"),
);
ok(
	"every hook entry points at the assembled launcher",
	leaves.every((l) => l.exec === launcher),
);
// The Claude unit's whole identity contract rides `args`. Copilot has no such key, so
// a stray one here would be a manifest written against the wrong vendor's schema.
ok(
	"no hook entry carries `args` — Copilot's schema has no such key",
	leaves.every((l) => !("args" in l)),
);
ok(
	"no hook entry carries an empty `matcher` — Copilot rejects one",
	leaves.every((l) => l.matcher !== ""),
);

// ── 3. the launcher is baked ─────────────────────────────────────────────────
const launcherText = readFileSync(launcher, "utf8");
// The guard's own comparison literals are split (`"__NODE_""BIN__"`) precisely so this
// assertion can be exact: after a bake, no whole placeholder token survives anywhere.
ok(
	"launcher carries no unsubstituted placeholder",
	!launcherText.includes("__NODE_BIN__") && !launcherText.includes("__HOOK_ENTRY__"),
);
const bakedNode = /^NODE_BIN="(.*)"$/m.exec(launcherText)?.[1] ?? "";
ok("launcher's baked node is an existing executable", bakedNode.length > 0 && existsSync(bakedNode));

// ── 4. FIRE, the way Copilot fires: no argv, envelope on stdin ───────────────
interface Fired {
	status: number | null;
	stdout: string;
	stderr: string;
}
/** The child's env: this gate's own, with the store relocated and every DIRECT store
 * override removed. `PI_CODING_AGENT_DIR` only isolates what derives from it, so an
 * operator shell that pins `ENTWURF_META_SENDERS_DIR` (or the sessions equivalent) would
 * send the very artifacts asserted on below into the real store and read a stale one back. */
function isolatedEnv(storeDir: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: storeDir };
	delete env.ENTWURF_META_SENDERS_DIR;
	delete env.ENTWURF_META_SESSIONS_DIR;
	return env;
}
function fire(envelope: unknown, storeDir: string): Fired {
	const res = spawnSync(launcher, [], {
		input: typeof envelope === "string" ? envelope : JSON.stringify(envelope),
		env: isolatedEnv(storeDir),
		encoding: "utf8",
	});
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
function records(storeDir: string): ReturnType<typeof listAllMetaIdentitiesDir>["identities"] {
	const dir = path.join(storeDir, "meta-sessions");
	if (!existsSync(dir)) return [];
	return listAllMetaIdentitiesDir(dir).identities;
}
function hookLog(storeDir: string): string {
	const file = path.join(storeDir, "meta-bridge-hook.log");
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const store = path.join(root, "store");
mkdirSync(store, { recursive: true });
const NATIVE_ID = "cop-birth-0001";
const CWD = "/home/junghan/repos/gh/entwurf";

const first = fire({ sessionId: NATIVE_ID, cwd: CWD, source: "new", timestamp: 1755690000000 }, store);
ok("[QK:COPILOT-BIRTH-NO-ARGV-LAUNCH] a no-argv fire with the NATIVE envelope exits 0", first.status === 0);
ok("the hook emits the neutral response and nothing else", first.stdout.trim() === "{}");
let live = records(store);
ok("exactly one record was minted", live.length === 1);
ok("[QK:COPILOT-BIRTH-MINTS-COPILOT] the record's backend is copilot", live[0]?.backend === "copilot");
ok("the record joins on the native sessionId", live[0]?.nativeSessionId === NATIVE_ID);
ok("the record carries the envelope's cwd", live[0]?.cwd === CWD);
// Omitted, never guessed: Copilot's envelope carries neither, and both are nullable.
ok("model and transcriptPath are null, not invented", live[0]?.model === null && live[0]?.transcriptPath === null);
const bornGardenId = live[0]?.gardenId ?? "";

// ── 5. the second event of the same first prompt ATTACHES ───────────────────
// Measured firing order is userPromptSubmitted -> sessionStart, so the citizen is
// minted by one and re-seen by the other. Two records for one session would be two
// citizens for one Copilot window.
const second = fire({ hook_event_name: "SessionStart", session_id: NATIVE_ID, cwd: CWD, source: "new" }, store);
ok("a second fire with the CLAUDE-COMPAT envelope also exits 0", second.status === 0);
live = records(store);
ok("the store still holds exactly one record", live.length === 1);
ok("the second fire attached to the SAME garden id", live[0]?.gardenId === bornGardenId);

// ── 6. WHO-SENT is armed; RECEIVER state is not ─────────────────────────────
// The two halves used to be one assertion ("no marker of any kind"), and that
// conflation is the defect #82 RAIL 5b closed: the doorbell's absence is a fact about
// the RECEIVER rail only. A sender marker needs a shared parent, not a doorbell, so
// this backend can say who sent a message while still being unable to receive one.
//
// The join this gate performs is the SAME one production performs, which is why the
// oracle is independent of the writer: `fire()` spawns the launcher as this process's
// child and the launcher `exec`s the payload, so the payload's parent IS this gate.
// The gate therefore knows the answer (`process.pid`) before reading the file.
const sendersDir = path.join(store, "meta-senders");
const markerFile = path.join(sendersDir, "copilot", `${process.pid}.json`);
ok(
	"[QK:COPILOT-BIRTH-WRITES-SENDER-MARKER] a sender marker was written under THIS process's pid — the parent the bridge child would look itself up by",
	existsSync(markerFile),
);
const marker = JSON.parse(readFileSync(markerFile, "utf8")) as {
	backend?: string;
	gardenId?: string;
	nativeSessionId?: string;
	cwd?: string;
	ownerPid?: number;
	ownerStartKey?: string;
};
ok("the marker names the citizen that was just minted, not a second one", marker.gardenId === bornGardenId);
ok(
	"the marker agrees with the record on backend and native id — a drift on either makes it a stale hint",
	marker.backend === "copilot" && marker.nativeSessionId === NATIVE_ID,
);
ok("the marker's ownerPid IS the gate's own pid", marker.ownerPid === process.pid);
// The pid-reuse guard: a marker keyed to a pid alone would be inherited by whatever
// process the OS hands that number to next.
ok(
	"the marker carries the owner's start-key, so a reused pid cannot inherit this citizen",
	typeof marker.ownerStartKey === "string" && marker.ownerStartKey === processStartKey(process.pid),
);

// The READ half. A marker nobody looks for is invisible, and that asymmetry — writer
// open, reader closed — is exactly how #46 made an agy citizen send as an anonymous
// external host. So the resolver is run for real, not inspected.
ok(
	"[QK:COPILOT-SENDER-READER-OPEN] copilot is one of the backends the resolver scans — a marker nobody looks for is invisible",
	META_SENDER_BACKENDS.includes("copilot"),
);
// The resolver reads the RECORD store through this process's own env (the marker is only
// a hint; the record is the authority), while the marker root is a parameter. So the
// record half is pointed at the temp store for the duration of the call and put back —
// same isolation the agy sender gate uses, and `isolatedEnv` keeps it out of every child.
function withSessionsDir<T>(dir: string, fn: () => T): T {
	const prev = process.env.ENTWURF_META_SESSIONS_DIR;
	process.env.ENTWURF_META_SESSIONS_DIR = dir;
	try {
		return fn();
	} finally {
		if (prev === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
		else process.env.ENTWURF_META_SESSIONS_DIR = prev;
	}
}
const trusted = withSessionsDir(path.join(store, "meta-sessions"), () =>
	resolveTrustedMetaSenderIdentity({ ownerPids: [process.pid], sendersDir }),
);
ok(
	"the bridge resolver joins that marker to exactly ONE identity — the citizen born above",
	trusted?.identity.gardenId === bornGardenId && trusted?.identity.backend === "copilot",
);

// The record store is the authority; the marker is only a hint it must agree with.
// Run in its OWN store so the live one above keeps its record for §7.
{
	const orphanStore = path.join(root, "orphan-marker");
	mkdirSync(orphanStore, { recursive: true });
	fire({ sessionId: "cop-orphan-0001", cwd: CWD, source: "new" }, orphanStore);
	const orphanSenders = path.join(orphanStore, "meta-senders");
	ok(
		"precondition: that store has its own marker too",
		existsSync(path.join(orphanSenders, "copilot", `${process.pid}.json`)),
	);
	for (const f of readdirSync(path.join(orphanStore, "meta-sessions"))) {
		rmSync(path.join(orphanStore, "meta-sessions", f));
	}
	ok(
		"a marker whose record is gone resolves to NOBODY — a hint is not an identity",
		withSessionsDir(path.join(orphanStore, "meta-sessions"), () =>
			resolveTrustedMetaSenderIdentity({ ownerPids: [process.pid], sendersDir: orphanSenders }),
		) === null,
	);
}

// FAIL-CLOSED on provenance. Reaching the payload WITHOUT the launcher means we do not
// know what our parent is — an already-open session holding an older cached command is
// the real case. Birth still happens (a record needs no parent); only who-sent is
// withheld, and the log says which of the two refusals it was.
{
	const noTokenStore = path.join(root, "no-provenance");
	mkdirSync(noTokenStore, { recursive: true });
	const entryRel = /^HOOK_ENTRY="\$PLUGIN_ROOT\/(.*)"$/m.exec(launcherText)?.[1] ?? "";
	ok("the launcher's baked hook entry is readable from its text", entryRel.length > 0);
	const bare = isolatedEnv(noTokenStore);
	delete bare.ENTWURF_META_HOOK_LAUNCH;
	const res = spawnSync(bakedNode, [path.join(path.dirname(launcher), "..", entryRel)], {
		input: JSON.stringify({ sessionId: "cop-noprov-0001", cwd: CWD, source: "new" }),
		env: bare,
		encoding: "utf8",
	});
	ok("an unstamped launch still exits 0 — best-effort, never breaks the turn", res.status === 0);
	ok("an unstamped launch still MINTS the citizen", records(noTokenStore).length === 1);
	ok(
		"an unstamped launch writes NO sender marker — an unknown parent is not an owner",
		!readdirSync(noTokenStore).includes("meta-senders"),
	);
	ok(
		"and it says so in the log the doctor reads",
		hookLog(noTokenStore).includes("sender-marker-refused") && hookLog(noTokenStore).includes("provenance missing"),
	);
}

// BIRTH DOES NOT ARM, and that is still true now that Copilot HAS a doorbell (#82 RAIL
// 5). What changed is the reason, not the assertion. It used to hold because no wake
// surface existed anywhere in the bundle; it holds today because the surface that exists
// belongs to a DIFFERENT PROCESS — the forked extension, which owns the watch and can
// therefore honestly claim to hold one. A marker written from this hook would name the
// Copilot host pid as the owner of a watch that pid does not hold, and the citizen would
// read as deliverable for as long as the TUI stayed open, wired to nothing.
const storeEntries = readdirSync(store);
ok(
	"[QK:COPILOT-BIRTH-DOES-NOT-ARM-RECEIVER] the birth hook creates no mailbox and no receiver marker — arming belongs to the process that holds the watch",
	!storeEntries.includes("meta-mailbox") && !storeEntries.includes("meta-receivers"),
);
// Identity is not replyability. This citizen can say who it is the moment it is born;
// whether a reply LANDS is answered one rail over, by the receiver marker the extension
// writes when it joins. The reply rail itself is picked from nativePushSupported at the
// bridge, and copilot lands in self-fetch either way.
ok(
	"copilot is NOT native-push — a sender marker buys who-sent, and replyability comes from the receiver marker instead",
	nativePushSupported("copilot") === false,
);

// ── 7. the citizen is a PEER, and an honest one ─────────────────────────────
const facts = resolveFactList(live, []);
const peer = facts.peers.find((p) => p.gardenId === bornGardenId);
ok("the minted citizen appears in the peer fact list", peer !== undefined);
ok("its liveness is `unsupported` — no control-socket probe exists for this backend", peer?.liveness === "unsupported");

// ── 8. negatives: every refusal is a REFUSAL, not a guessed record ──────────
function refuses(label: string, envelope: unknown, expectInLog: string): void {
	const negStore = path.join(root, `neg-${label.replace(/[^a-z0-9]+/gi, "-")}`);
	mkdirSync(negStore, { recursive: true });
	const res = fire(envelope, negStore);
	ok(`${label}: exits 0 (best-effort, never breaks the operator's turn)`, res.status === 0);
	ok(`${label}: writes NO record`, records(negStore).length === 0);
	ok(`${label}: logs an ERROR the doctor can read (${expectInLog})`, hookLog(negStore).includes(expectInLog));
}
// The one a naive `sessionId ?? session_id` would swallow: two identities for one
// session means the envelope is not trustworthy, so neither id may be minted.
refuses(
	"[QK:COPILOT-BIRTH-ID-DISAGREEMENT] disagreeing sessionId/session_id",
	{ sessionId: "a-1", session_id: "b-2", cwd: CWD },
	"disagree",
);
refuses("missing cwd", { sessionId: NATIVE_ID }, "cwd missing");
refuses("no session id under either key", { cwd: CWD, source: "new" }, "no sessionId/session_id");
refuses("malformed envelope", "{not json", "envelope parse failed");
// Agreement is NOT a refusal — the compat translator emitting both keys is normal.
const agreeStore = path.join(root, "agree");
mkdirSync(agreeStore, { recursive: true });
const agreeing = fire({ sessionId: NATIVE_ID, session_id: NATIVE_ID, cwd: CWD }, agreeStore);
ok(
	"both keys AGREEING is accepted (that is the compat translator, not a defect)",
	agreeing.status === 0 && records(agreeStore).length === 1,
);

// ── 9. an UNBAKED launcher refuses loudly instead of exec'ing a placeholder ──
const rawUnit = path.join(root, "raw");
mkdirSync(path.join(rawUnit, "scripts"), { recursive: true });
const rawLauncher = path.join(rawUnit, "scripts", "copilot-hook-launch.sh");
copyFileSync(path.join(REPO, "pi", "meta-bridge-copilot", PLUGIN, "scripts", "copilot-hook-launch.sh"), rawLauncher);
chmodSync(rawLauncher, 0o755);
const rawStore = path.join(root, "raw-store");
mkdirSync(rawStore, { recursive: true });
const raw = spawnSync(rawLauncher, [], {
	input: JSON.stringify({ sessionId: NATIVE_ID, cwd: CWD }),
	env: { ...process.env, PI_CODING_AGENT_DIR: rawStore },
	encoding: "utf8",
});
ok("the committed (unbaked) launcher exits non-zero", raw.status !== 0);
ok("it names the install verb rather than failing silently", (raw.stderr ?? "").includes("install-copilot-bridge"));
ok("it wrote no record", records(rawStore).length === 0);

// ── 10. the shipped skeleton keeps its placeholders ─────────────────────────
// If the committed unit were already baked to some host's node path, every other
// host's install would ship a launcher pointing at a binary it does not have.
const shippedHooks = readFileSync(path.join(REPO, "pi", "meta-bridge-copilot", PLUGIN, "hooks", "hooks.json"), "utf8");
ok("the committed hooks.json still carries __COPILOT_LAUNCHER__", shippedHooks.includes("__COPILOT_LAUNCHER__"));
const shippedLauncher = readFileSync(
	path.join(REPO, "pi", "meta-bridge-copilot", PLUGIN, "scripts", "copilot-hook-launch.sh"),
	"utf8",
);
ok(
	"the committed launcher still carries both placeholders",
	shippedLauncher.includes('NODE_BIN="__NODE_BIN__"') && shippedLauncher.includes("__HOOK_ENTRY__"),
);

// ── 11. the install path, driven against a FAKE copilot ─────────────────────
// The one part of this lane that cannot be exercised for real without touching the
// operator's Copilot — and the place cross-review named the strongest unguarded
// defect: an unqualified stale-unit removal that treats a CLI failure as an absence,
// or that reaches a same-named plugin from somebody else's marketplace.
const OURS = "entwurf-meta-receive-copilot@meta-bridge-copilot-local";
const STALE = "entwurf-meta-receive@meta-bridge-local";
const FOREIGN = "entwurf-meta-receive@someone-elses-marketplace";

interface FakeRun {
	status: number | null;
	stdout: string;
	stderr: string;
	/** every `copilot …` argv the installer issued, in order */
	calls: string[];
	/** the plugin ids the fake still holds when the installer is done */
	installed: string[];
}
function runInstall(opts: {
	installed: string[];
	uninstallFails?: boolean;
	listFails?: boolean;
	label: string;
}): FakeRun {
	const home = path.join(root, `install-${opts.label}`);
	const bin = path.join(home, "bin");
	mkdirSync(bin, { recursive: true });
	const state = path.join(home, "installed.txt");
	const log = path.join(home, "calls.log");
	writeFileSync(state, opts.installed.join("\n") + (opts.installed.length ? "\n" : ""));
	writeFileSync(log, "");
	// A fake that ANSWERS like the measured CLI: `plugin list` prints qualified ids,
	// `plugin uninstall <id>` removes exactly that id.
	writeFileSync(
		path.join(bin, "copilot"),
		[
			"#!/usr/bin/env bash",
			`STATE=${JSON.stringify(state)}`,
			`LOG=${JSON.stringify(log)}`,
			'echo "$*" >> "$LOG"',
			'case "$1 $2" in',
			opts.listFails
				? '  "plugin list") echo "not authenticated" >&2; exit 1 ;;'
				: '  "plugin list") echo "Installed plugins:"; sed "s/^/  • /" "$STATE"; exit 0 ;;',
			'  "plugin uninstall")',
			opts.uninstallFails
				? '    echo "boom" >&2; exit 1 ;;'
				: '    grep -Fvx "$3" "$STATE" > "$STATE.tmp" || true; mv "$STATE.tmp" "$STATE"; exit 0 ;;',
			'  "plugin install") echo "$3" >> "$STATE"; exit 0 ;;',
			'  "plugin marketplace") exit 0 ;;',
			"esac",
			"exit 0",
		].join("\n"),
	);
	chmodSync(path.join(bin, "copilot"), 0o755);
	const res = spawnSync("bash", [path.join(REPO, "run.sh"), "install-copilot-bridge"], {
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ENTWURF_COPILOT_ASM: path.join(home, "asm") },
		encoding: "utf8",
	});
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
		installed: readFileSync(state, "utf8").split("\n").filter(Boolean),
	};
}

const withStale = runInstall({ installed: [STALE], label: "stale" });
ok(
	"[QK:COPILOT-INSTALL-QUALIFIED-STALE] install removes the stale Claude unit by its QUALIFIED id",
	withStale.calls.includes(`plugin uninstall ${STALE}`),
);
ok("install then registers our unit", withStale.installed.includes(OURS) && withStale.status === 0);
ok("the stale unit is gone afterwards", !withStale.installed.includes(STALE));

const withForeign = runInstall({ installed: [FOREIGN], label: "foreign" });
ok(
	"[QK:COPILOT-INSTALL-FOREIGN-UNTOUCHED] a same-named plugin from ANOTHER marketplace is left alone",
	withForeign.installed.includes(FOREIGN) &&
		!withForeign.calls.some((c) => c.startsWith(`plugin uninstall ${FOREIGN}`)),
);

const uninstallBroken = runInstall({ installed: [STALE], uninstallFails: true, label: "cli-error" });
ok(
	"[QK:COPILOT-INSTALL-UNINSTALL-FAILURE-IS-FATAL] a FAILING uninstall is not read as an absence — the install refuses",
	uninstallBroken.status !== 0 && !uninstallBroken.installed.includes(OURS),
);

const listBroken = runInstall({ installed: [STALE], listFails: true, label: "list-error" });
ok(
	"[QK:COPILOT-INSTALL-LIST-FAILURE-IS-FATAL] a FAILING plugin list is not read as an empty host — the install refuses",
	listBroken.status !== 0 && !listBroken.installed.includes(OURS),
);

const clean = runInstall({ installed: [], label: "clean" });
ok(
	"a host with no stale unit installs cleanly and says so",
	clean.status === 0 && clean.stdout.includes("nothing to remove"),
);

writeFileSync(path.join(root, "gate.ok"), "");
console.log(`[check-copilot-birth-hook] ${passed} assertions ok`);
