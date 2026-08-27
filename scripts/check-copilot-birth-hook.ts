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
	symlinkSync,
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
const MKT = "meta-bridge-copilot-local";
const SHIPPED_VERSION = (
	JSON.parse(
		readFileSync(path.join(REPO, "pi", "meta-bridge-copilot", PLUGIN, ".claude-plugin", "plugin.json"), "utf8"),
	) as {
		version: string;
	}
).version;

interface FakeHost {
	home: string;
	env: NodeJS.ProcessEnv;
	asm: string;
	/** package ownership state file inside the sandboxed XDG root */
	stateFile: string;
	log: string;
	pluginState: string;
	mktState: string;
}
interface FakeOpts {
	installed?: string[];
	/** registered marketplaces as [name, localPath] rows */
	marketplaces?: Array<[string, string]>;
	/** verbatim `plugin list` body override — for malformed/garbled listing cells */
	pluginListRaw?: string;
	uninstallFails?: boolean;
	listFails?: boolean;
	mktListFails?: boolean;
	mktRemoveFails?: boolean;
}
interface FakeRun {
	status: number | null;
	stdout: string;
	stderr: string;
	/** every `copilot …` argv the driven surface issued, in order */
	calls: string[];
	/** the plugin ids the fake still holds when the surface is done */
	installed: string[];
	/** the marketplace rows the fake still holds */
	marketplaces: string[];
}
/** A fake that ANSWERS like the MEASURED CLI (copilot 1.0.80, 2026-08-27): `plugin
 * list` prints qualified ids with a `(vX)` suffix, `plugin marketplace list` prints a
 * registered local marketplace as `<name> (Local: <abs path>)`, `plugin uninstall <id>`
 * removes exactly that id — and `--force` anywhere is refused loudly, because the real
 * `marketplace remove --force` uninstalls that marketplace's plugins as a side effect
 * and no entwurf surface may reach for it. Marketplace subverbs are modeled SEPARATELY
 * (the old generic `exit 0` arm could not kill an inverse that removed a foreign
 * marketplace). */
function makeFakeHost(label: string, opts: FakeOpts): FakeHost {
	const home = path.join(root, `fake-${label}`);
	const bin = path.join(home, "bin");
	mkdirSync(bin, { recursive: true });
	const xdg = path.join(home, "xdg");
	mkdirSync(xdg, { recursive: true });
	const pluginState = path.join(home, "installed.txt");
	const mktState = path.join(home, "marketplaces.txt");
	const rawList = path.join(home, "rawlist.txt");
	const log = path.join(home, "calls.log");
	const installed = opts.installed ?? [];
	const marketplaces = opts.marketplaces ?? [];
	if (opts.pluginListRaw !== undefined) writeFileSync(rawList, `${opts.pluginListRaw}\n`);
	writeFileSync(pluginState, installed.join("\n") + (installed.length ? "\n" : ""));
	writeFileSync(mktState, marketplaces.map(([n, p]) => `${n}\t${p}`).join("\n") + (marketplaces.length ? "\n" : ""));
	writeFileSync(log, "");
	writeFileSync(
		path.join(bin, "copilot"),
		[
			"#!/usr/bin/env bash",
			`STATE=${JSON.stringify(pluginState)}`,
			`MKTS=${JSON.stringify(mktState)}`,
			`LOG=${JSON.stringify(log)}`,
			`VER=${JSON.stringify(SHIPPED_VERSION)}`,
			'echo "$*" >> "$LOG"',
			'for a in "$@"; do [ "$a" = "--force" ] && { echo "fake copilot: --force is forbidden here" >&2; exit 99; }; done',
			'case "$1 $2 $3" in',
			opts.mktListFails
				? '  "plugin marketplace list") echo "not authenticated" >&2; exit 1 ;;'
				: [
						'  "plugin marketplace list")',
						'    echo "Included with GitHub Copilot:"',
						'    while IFS=$\'\\t\' read -r n p; do [ -n "$n" ] && echo "  • $n (Local: $p)"; done < "$MKTS"',
						"    exit 0 ;;",
					].join("\n"),
			'  "plugin marketplace add") printf "%s\\t%s\\n" ' + JSON.stringify(MKT) + ' "$4" >> "$MKTS"; exit 0 ;;',
			opts.mktRemoveFails
				? '  "plugin marketplace remove") echo "mkt boom" >&2; exit 1 ;;'
				: '  "plugin marketplace remove") awk -F"\\t" -v n="$4" \'$1 != n\' "$MKTS" > "$MKTS.tmp"; mv "$MKTS.tmp" "$MKTS"; exit 0 ;;',
			"esac",
			'case "$1 $2" in',
			opts.listFails
				? '  "plugin list") echo "not authenticated" >&2; exit 1 ;;'
				: opts.pluginListRaw !== undefined
					? `  "plugin list") echo "Installed plugins:"; cat ${JSON.stringify(rawList)}; exit 0 ;;`
					: '  "plugin list") echo "Installed plugins:"; sed "s/^/  • /;s/$/ (v$VER)/" "$STATE"; exit 0 ;;',
			'  "plugin uninstall")',
			opts.uninstallFails
				? '    echo "boom" >&2; exit 1 ;;'
				: '    grep -Fvx "$3" "$STATE" > "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; exit 0 ;;',
			'  "plugin install") echo "$3" >> "$STATE"; exit 0 ;;',
			"esac",
			"exit 0",
		].join("\n"),
	);
	chmodSync(path.join(bin, "copilot"), 0o755);
	return {
		home,
		asm: path.join(home, "asm"),
		stateFile: path.join(xdg, "entwurf", "copilot-bridge", "install-state.json"),
		log,
		pluginState,
		mktState,
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			XDG_DATA_HOME: xdg,
			// The doctor reads the record store and hook log from the agent dir; keep the
			// gate hermetic rather than letting it read the operator's real host state.
			PI_CODING_AGENT_DIR: path.join(home, "agent"),
			ENTWURF_COPILOT_ASM: path.join(home, "asm"),
		},
	};
}
function runVerb(host: FakeHost, verb: string): FakeRun {
	const res = spawnSync("bash", [path.join(REPO, "run.sh"), verb], { env: host.env, encoding: "utf8" });
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		calls: readFileSync(host.log, "utf8").split("\n").filter(Boolean),
		installed: readFileSync(host.pluginState, "utf8").split("\n").filter(Boolean),
		marketplaces: readFileSync(host.mktState, "utf8").split("\n").filter(Boolean),
	};
}
function runInstall(opts: FakeOpts & { label: string }): FakeRun & { host: FakeHost } {
	const host = makeFakeHost(`install-${opts.label}`, opts);
	return { ...runVerb(host, "install-copilot-bridge"), host };
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

// ── 12. install ownership state (#86 C3a) ───────────────────────────────────
// The birth unit gets the same discipline the other three Copilot units have: a
// package-owned install-state written after the assembly publish and before any
// vendor mutation, adoption that is explicit and narrow, and vendor-list failures
// that read as UNKNOWN, never as absence.
ok(
	"a fresh install writes the ownership state with the exact schema",
	(() => {
		if (!existsSync(clean.host.stateFile)) return false;
		const s = JSON.parse(readFileSync(clean.host.stateFile, "utf8")) as Record<string, unknown>;
		return (
			s.schemaVersion === 1 &&
			s.qualifiedId === OURS &&
			s.marketplaceName === MKT &&
			s.assemblyPath === clean.host.asm &&
			s.pluginVersion === SHIPPED_VERSION &&
			s.ownedMarketplace === true &&
			s.ownedAssembly === true &&
			typeof s.installedAt === "string"
		);
	})(),
);
ok(
	"the vendor sequence ran loud and in the bounded order (add before install, no blind uninstall)",
	clean.calls.some((c) => c.startsWith("plugin marketplace add ")) &&
		clean.calls.indexOf(`plugin install ${OURS}`) >
			clean.calls.findIndex((c) => c.startsWith("plugin marketplace add ")),
);

const mktListBroken = runInstall({ installed: [], mktListFails: true, label: "mkt-list-error" });
ok(
	"a FAILING marketplace list is not read as an empty host — the install refuses with zero writes",
	mktListBroken.status !== 0 && !mktListBroken.installed.includes(OURS) && !existsSync(mktListBroken.host.stateFile),
);

// Reinstall over an existing state: the old blind `|| true` pair is gone, so a failing
// vendor step is an honest partial failure with the state retained for the rerun. The
// first install on each host is clean by construction (nothing to uninstall/remove), so
// the failure mode only fires on the RE-install, which is the path the blind pair hid.
{
	const host = makeFakeHost("reinstall-uninstall-broken", { uninstallFails: true });
	const first = runVerb(host, "install-copilot-bridge");
	ok("precondition: the first install on the uninstall-broken host is green", first.status === 0);
	const second = runVerb(host, "install-copilot-bridge");
	ok(
		"a reinstall whose exact-id uninstall FAILS stops loud with the state retained for repair",
		second.status !== 0 && existsSync(host.stateFile) && second.installed.includes(OURS),
	);
}
{
	const host = makeFakeHost("reinstall-mkt-remove-broken", { mktRemoveFails: true });
	const first = runVerb(host, "install-copilot-bridge");
	ok("precondition: the first install on the remove-broken host is green", first.status === 0);
	const second = runVerb(host, "install-copilot-bridge");
	ok(
		"a reinstall whose marketplace remove FAILS stops loud (never retried with --force) with the state retained",
		second.status !== 0 && existsSync(host.stateFile) && !second.calls.some((c) => c.includes("--force")),
	);
}
{
	// No state + marketplace pre-registered at our path + no valid assembly → the
	// legacy-marketplace adoption clause refuses before any write.
	const host = makeFakeHost("mkt-no-assembly", {
		marketplaces: [[MKT, path.join(root, "fake-mkt-no-assembly", "asm")]],
	});
	const refuse = runVerb(host, "install-copilot-bridge");
	ok(
		"a no-state marketplace registration over an INVALID assembly refuses with zero writes",
		refuse.status !== 0 && !existsSync(host.stateFile) && !existsSync(host.asm),
	);
}

// Legacy adoption, both shapes, driven through the honest route: install once, then
// strip the state and run again.
{
	const adopt = runInstall({ installed: [], label: "adopt" });
	ok("precondition: the adoption host installed green", adopt.status === 0 && existsSync(adopt.host.stateFile));
	rmSync(adopt.host.stateFile);
	const second = runVerb(adopt.host, "install-copilot-bridge");
	ok(
		"a legacy no-state installation with the exact QUALIFIED, our marketplace path and a valid assembly is ADOPTED and reported",
		second.status === 0 &&
			second.stdout.includes("adopting the legacy no-state installation") &&
			existsSync(adopt.host.stateFile),
	);
	// Now break the assembly and strip the state again: adoption must refuse, and the
	// refusal is zero-write (no state minted, the broken assembly untouched).
	rmSync(adopt.host.stateFile);
	rmSync(path.join(adopt.host.asm, PLUGIN, "hooks", "hooks.json"));
	const invalid = runVerb(adopt.host, "install-copilot-bridge");
	ok(
		"a legacy no-state installation whose assembly FAILS the structural oracle refuses with zero writes",
		invalid.status !== 0 &&
			!existsSync(adopt.host.stateFile) &&
			!existsSync(path.join(adopt.host.asm, PLUGIN, "hooks", "hooks.json")),
	);
}

// ── 13. the package-owned INVERSE (#86 C3a) ─────────────────────────────────
{
	const host = makeFakeHost("inverse-no-state", {
		installed: [OURS],
		marketplaces: [[MKT, path.join(root, "fake-inverse-no-state", "asm")]],
	});
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"[QK:COPILOT-BIRTH-INVERSE-NO-STATE] with NO ownership state the inverse refuses and mutates NOTHING — a blind best-effort remove is exactly the defect",
		res.status !== 0 &&
			res.installed.includes(OURS) &&
			res.marketplaces.length === 1 &&
			!res.calls.some((c) => c.startsWith("plugin uninstall") || c.startsWith("plugin marketplace remove")),
	);
	ok("the no-state refusal names the adoption repair", (res.stderr ?? "").includes("install-copilot-bridge"));
}
{
	const host = makeFakeHost("inverse-corrupt", { installed: [OURS] });
	mkdirSync(path.dirname(host.stateFile), { recursive: true });
	writeFileSync(host.stateFile, "{not json");
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"a CORRUPT state refuses with zero vendor mutation and the state retained for inspection",
		res.status !== 0 && res.installed.includes(OURS) && existsSync(host.stateFile) && res.calls.length === 0,
	);
}
{
	const host = makeFakeHost("inverse-drift", { installed: [OURS] });
	mkdirSync(path.dirname(host.stateFile), { recursive: true });
	writeFileSync(
		host.stateFile,
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: "/somewhere/else/.assembled",
			pluginVersion: SHIPPED_VERSION,
			ownedMarketplace: true,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		}),
	);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"a state whose assemblyPath DRIFTED from this host's effective assembly refuses with zero vendor mutation",
		res.status !== 0 && res.installed.includes(OURS) && res.calls.length === 0,
	);
}
function writeBoundState(host: FakeHost): void {
	mkdirSync(path.dirname(host.stateFile), { recursive: true });
	writeFileSync(
		host.stateFile,
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: host.asm,
			pluginVersion: SHIPPED_VERSION,
			ownedMarketplace: true,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		}),
	);
}
{
	const host = makeFakeHost("inverse-foreign-mkt", {
		installed: [OURS],
		marketplaces: [[MKT, "/somebody/elses/marketplace-root"]],
	});
	writeBoundState(host);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"[QK:COPILOT-BIRTH-INVERSE-FOREIGN] a marketplace with OUR name at ANOTHER path refuses BEFORE the plugin uninstall — zero vendor writes, everything preserved (that qualified id could be THAT marketplace's plugin)",
		res.status !== 0 &&
			res.installed.includes(OURS) &&
			!res.calls.includes(`plugin uninstall ${OURS}`) &&
			res.marketplaces.some((row) => row.includes("/somebody/elses/marketplace-root")) &&
			!res.calls.some((c) => c.startsWith("plugin marketplace remove")) &&
			existsSync(host.stateFile),
	);
}
{
	// ownedMarketplace=false while OUR marketplace IS registered at the recorded path:
	// completing the inverse would delete the backing assembly/state under a
	// registration it must preserve — so the whole operation refuses up front.
	const host = makeFakeHost("inverse-unowned-mkt", { installed: [OURS] });
	mkdirSync(path.dirname(host.stateFile), { recursive: true });
	writeFileSync(host.mktState, `${MKT}\t${host.asm}\n`);
	mkdirSync(path.join(host.asm, PLUGIN), { recursive: true });
	writeFileSync(
		host.stateFile,
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: host.asm,
			pluginVersion: SHIPPED_VERSION,
			ownedMarketplace: false,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		}),
	);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"a REGISTERED marketplace the state does not own refuses the WHOLE inverse before any vendor write — no dangling registration over removed backing",
		res.status !== 0 &&
			res.installed.includes(OURS) &&
			!res.calls.includes(`plugin uninstall ${OURS}`) &&
			res.marketplaces.length === 1 &&
			existsSync(path.join(host.asm, PLUGIN)) &&
			existsSync(host.stateFile),
	);
}
{
	// State schema is fail-closed EXACTLY: representative missing-key, wrong-typed
	// bool, and unknown-key states each refuse with zero vendor mutation.
	const badStates: Array<[string, Record<string, unknown>]> = [
		[
			"missing-key",
			{
				schemaVersion: 1,
				qualifiedId: OURS,
				marketplaceName: MKT,
				assemblyPath: "PLACEHOLDER",
				pluginVersion: SHIPPED_VERSION,
				ownedMarketplace: true,
				ownedAssembly: true,
			},
		],
		[
			"wrong-bool",
			{
				schemaVersion: 1,
				qualifiedId: OURS,
				marketplaceName: MKT,
				assemblyPath: "PLACEHOLDER",
				pluginVersion: SHIPPED_VERSION,
				ownedMarketplace: "true",
				ownedAssembly: true,
				installedAt: "2026-08-27T00:00:00Z",
			},
		],
		[
			"unknown-key",
			{
				schemaVersion: 1,
				qualifiedId: OURS,
				marketplaceName: MKT,
				assemblyPath: "PLACEHOLDER",
				pluginVersion: SHIPPED_VERSION,
				ownedMarketplace: true,
				ownedAssembly: true,
				installedAt: "2026-08-27T00:00:00Z",
				extra: 1,
			},
		],
	];
	for (const [label, state] of badStates) {
		const host = makeFakeHost(`inverse-state-${label}`, { installed: [OURS] });
		mkdirSync(path.dirname(host.stateFile), { recursive: true });
		state.assemblyPath = host.asm;
		writeFileSync(host.stateFile, JSON.stringify(state));
		const res = runVerb(host, "uninstall-copilot-bridge");
		ok(
			`a ${label} ownership state refuses fail-closed with zero vendor mutation (flags are never coerced)`,
			res.status !== 0 && res.installed.includes(OURS) && res.calls.length === 0 && existsSync(host.stateFile),
		);
	}
}
{
	// EXACT-row adversary: a longer qualified id that CONTAINS ours authorizes nothing —
	// not the inverse's uninstall branch, not install adoption, not the doctor's
	// registration read.
	const ADVERSARY = `${OURS}-extra`;
	const invHost = makeFakeHost("adversary-inverse", { installed: [ADVERSARY] });
	writeBoundState(invHost);
	const inv = runVerb(invHost, "uninstall-copilot-bridge");
	ok(
		"inverse: a longer row containing our qualified id is NOT our plugin — named already-absent, adversary survives, no uninstall argv",
		inv.status === 0 &&
			inv.stdout.includes("already absent") &&
			inv.installed.includes(ADVERSARY) &&
			!inv.calls.some((c) => c.startsWith("plugin uninstall")),
	);
	const adoptHost = makeFakeHost("adversary-adopt", { installed: [ADVERSARY] });
	const adopt = runVerb(adoptHost, "install-copilot-bridge");
	ok(
		"install: the adversary row does not trigger the adoption branch — the host reads as fresh and the adversary survives",
		adopt.status === 0 && !adopt.stdout.includes("adopting") && adopt.installed.includes(ADVERSARY),
	);
	const docHost = makeFakeHost("adversary-doctor", { installed: [ADVERSARY] });
	const doc = runVerb(docHost, "doctor-copilot-bridge");
	ok(
		"doctor: the adversary row does not read as our registration",
		doc.status !== 0 && doc.stdout.includes("NOT installed"),
	);
}
{
	// ASM delete-safety representative: a symlinked recorded assembly refuses the whole
	// inverse before any vendor write.
	const host = makeFakeHost("inverse-asm-symlink", { installed: [OURS] });
	const realDir = path.join(host.home, "real-asm");
	mkdirSync(realDir, { recursive: true });
	rmSync(host.asm, { recursive: true, force: true });
	symlinkSync(realDir, host.asm);
	writeBoundState(host);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"a SYMLINKED recorded assembly refuses the whole inverse before any vendor write (read-only lists are the only argv)",
		res.status !== 0 &&
			res.installed.includes(OURS) &&
			res.calls.every((c) => c === "plugin list" || c === "plugin marketplace list") &&
			existsSync(realDir) &&
			existsSync(host.stateFile),
	);
}
{
	// --assemble-only is gate-only and must never rebuild the LIVE assembly: no
	// override (or the default path) refuses before any assembly mutation.
	const host = makeFakeHost("assemble-only-default", {});
	const env = { ...host.env };
	delete env.ENTWURF_COPILOT_ASM;
	const res = spawnSync("bash", [path.join(REPO, "run.sh"), "install-copilot-bridge", "--assemble-only"], {
		env,
		encoding: "utf8",
	});
	const liveAsm = path.join(env.XDG_DATA_HOME as string, "entwurf", "meta-bridge-copilot", ".assembled");
	ok(
		"--assemble-only without an explicit temp ENTWURF_COPILOT_ASM refuses BEFORE any assembly mutation",
		res.status !== 0 && (res.stderr ?? "").includes("ENTWURF_COPILOT_ASM") && !existsSync(liveAsm),
	);
}
{
	const host = makeFakeHost("inverse-happy", { installed: [OURS, FOREIGN] });
	// A real assembly to remove: the honest route again — this is the same host shape a
	// clean install leaves behind, minus the vendor rows the fake seeds directly.
	writeBoundState(host);
	mkdirSync(path.join(host.asm, PLUGIN), { recursive: true });
	writeFileSync(host.mktState, `${MKT}\t${host.asm}\n`);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"the full inverse removes the exact plugin, the exact marketplace, the recorded assembly, then the state LAST",
		res.status === 0 &&
			!res.installed.includes(OURS) &&
			res.marketplaces.length === 0 &&
			!existsSync(host.asm) &&
			!existsSync(host.stateFile),
	);
	ok(
		"the inverse used only EXACT qualified/marketplace argv — never a bare id, never --force",
		res.calls.includes(`plugin uninstall ${OURS}`) &&
			res.calls.includes(`plugin marketplace remove ${MKT}`) &&
			!res.calls.includes(`plugin uninstall ${PLUGIN}`) &&
			!res.calls.some((c) => c.includes("--force")),
	);
	ok("a same-named FOREIGN plugin survives the inverse untouched", res.installed.includes(FOREIGN));
}
{
	const host = makeFakeHost("inverse-retry", { installed: [], marketplaces: [] });
	writeBoundState(host);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"a RETRY over already-absent vendor resources names each absence and still clears the state (rerun-repair)",
		res.status === 0 && res.stdout.includes("already absent") && !existsSync(host.stateFile),
	);
}
{
	const host = makeFakeHost("inverse-list-broken", { installed: [OURS], listFails: true });
	writeBoundState(host);
	const res = runVerb(host, "uninstall-copilot-bridge");
	ok(
		"[QK:COPILOT-BIRTH-NO-FALSE-ABSENCE] a FAILING plugin list is UNKNOWN, not an empty host — the inverse refuses with the state retained and no mutation",
		res.status !== 0 &&
			(res.stderr ?? "").includes("UNKNOWN") &&
			existsSync(host.stateFile) &&
			!res.calls.some((c) => c.startsWith("plugin uninstall") || c.startsWith("plugin marketplace remove")),
	);
}

{
	// Version drift (final amendment): the vendor lists our exact id at a version the
	// state did not record — the inverse must refuse fail-closed with everything
	// preserved, and the doctor must name it.
	const invHost = makeFakeHost("inverse-version-drift", { installed: [OURS] });
	mkdirSync(path.dirname(invHost.stateFile), { recursive: true });
	mkdirSync(path.join(invHost.asm, PLUGIN), { recursive: true });
	writeFileSync(invHost.mktState, `${MKT}\t${invHost.asm}\n`);
	writeFileSync(
		invHost.stateFile,
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: invHost.asm,
			pluginVersion: "0.0.9-drift",
			ownedMarketplace: true,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		}),
	);
	const inv = runVerb(invHost, "uninstall-copilot-bridge");
	ok(
		"inverse: an exact row at a version the state did not record is VERSION-DRIFT — fail-closed, no vendor mutation, plugin/marketplace/assembly/state all preserved",
		inv.status !== 0 &&
			(inv.stderr ?? "").includes("version-drift") &&
			inv.installed.includes(OURS) &&
			inv.marketplaces.length === 1 &&
			existsSync(path.join(invHost.asm, PLUGIN)) &&
			existsSync(invHost.stateFile) &&
			!inv.calls.some((c) => c.startsWith("plugin uninstall") || c.startsWith("plugin marketplace remove")),
	);
	const docHost = makeFakeHost("doctor-version-drift", { installed: [OURS] });
	const doctorAsm = path.join(docHost.env.XDG_DATA_HOME as string, "entwurf", "meta-bridge-copilot", ".assembled");
	mkdirSync(path.dirname(docHost.stateFile), { recursive: true });
	writeFileSync(docHost.mktState, `${MKT}\t${doctorAsm}\n`);
	writeFileSync(
		docHost.stateFile,
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: doctorAsm,
			pluginVersion: "0.0.9-drift",
			ownedMarketplace: true,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		}),
	);
	const doc = runVerb(docHost, "doctor-copilot-bridge");
	ok(
		"doctor: the same drift is a named RED (`version drift`)",
		doc.status !== 0 && doc.stdout.includes("version drift"),
	);
}

// ── 13b. C3a corrective amendment (B review defects, 2026-08-27) ─────────────
{
	// B defect 2: TWO marketplace rows with our exact name. The retired grep|head -1
	// grammar silently took the FIRST — here deliberately the one at OUR assembly, so
	// the old parser would proceed. Every surface must refuse the ambiguity instead.
	const invHost = makeFakeHost("inverse-dup-mkt", { installed: [OURS] });
	writeFileSync(invHost.mktState, `${MKT}\t${invHost.asm}\n${MKT}\t/somebody/elses/dup-root\n`);
	writeBoundState(invHost);
	const inv = runVerb(invHost, "uninstall-copilot-bridge");
	ok(
		"[QK:COPILOT-MKT-DUPLICATE-REFUSED] inverse: duplicate same-named marketplace rows are ambiguity — the whole inverse refuses before any vendor write, never 'the first row'",
		inv.status !== 0 &&
			(inv.stderr ?? "").includes("multiple marketplace rows") &&
			inv.installed.includes(OURS) &&
			inv.marketplaces.length === 2 &&
			!inv.calls.some((c) => c.startsWith("plugin uninstall") || c.startsWith("plugin marketplace remove")) &&
			existsSync(invHost.stateFile),
	);
	const instHost = makeFakeHost("install-dup-mkt", {});
	writeFileSync(instHost.mktState, `${MKT}\t${instHost.asm}\n${MKT}\t/somebody/elses/dup-root\n`);
	const inst = runVerb(instHost, "install-copilot-bridge");
	ok(
		"install: the same duplicate marketplace listing refuses before any write (no state, no assembly)",
		inst.status !== 0 && !existsSync(instHost.stateFile) && !existsSync(instHost.asm),
	);
	const docHost = makeFakeHost("doctor-dup-mkt", { installed: [OURS] });
	writeFileSync(docHost.mktState, `${MKT}\t/first/root\n${MKT}\t/second/root\n`);
	const doc = runVerb(docHost, "doctor-copilot-bridge");
	ok(
		"doctor: duplicate same-named marketplace rows are a RED ownership fact",
		doc.status !== 0 && doc.stdout.includes("duplicated") && doc.stdout.includes("ownership axis: FAIL"),
	);
}
{
	// B defect 3: a TRUNCATED exact row (`(v0.1` — no closing paren) used to slip the
	// startswith/endswith pair and round to ABSENT; absence licenses the inverse to
	// continue as retry-safe. Malformed must be malformed on every surface.
	const raw = `  • ${OURS} (v0.1`;
	const invHost = makeFakeHost("inverse-truncated-row", { pluginListRaw: raw });
	writeBoundState(invHost);
	mkdirSync(path.join(invHost.asm, PLUGIN), { recursive: true });
	writeFileSync(invHost.mktState, `${MKT}\t${invHost.asm}\n`);
	const inv = runVerb(invHost, "uninstall-copilot-bridge");
	ok(
		"[QK:COPILOT-MALFORMED-ROW-NOT-ABSENT] inverse: a truncated exact row is MALFORMED — refuse with zero vendor mutation, never 'already absent'",
		inv.status !== 0 &&
			(inv.stderr ?? "").includes("malformed") &&
			!inv.stdout.includes("already absent") &&
			!inv.calls.some((c) => c.startsWith("plugin uninstall") || c.startsWith("plugin marketplace remove")) &&
			existsSync(path.join(invHost.asm, PLUGIN)) &&
			existsSync(invHost.stateFile),
	);
	const instHost = makeFakeHost("install-truncated-row", { pluginListRaw: raw });
	const inst = runVerb(instHost, "install-copilot-bridge");
	ok(
		"install: the same truncated row refuses before any write (no state minted)",
		inst.status !== 0 && (inst.stderr ?? "").includes("malformed") && !existsSync(instHost.stateFile),
	);
}
{
	// B defect 4: a pluginVersion carrying whitespace would be truncated by the
	// space-separated fact transport (`cut -d' ' -f3`) into a FABRICATED version and a
	// misleading downstream reason. The shared state validator refuses it as corrupt.
	const wsState = (asmPath: string): string =>
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: asmPath,
			pluginVersion: `${SHIPPED_VERSION} extra`,
			ownedMarketplace: true,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		});
	const invHost = makeFakeHost("inverse-ws-version", { installed: [OURS] });
	mkdirSync(path.dirname(invHost.stateFile), { recursive: true });
	writeFileSync(invHost.stateFile, wsState(invHost.asm));
	const inv = runVerb(invHost, "uninstall-copilot-bridge");
	ok(
		"[QK:COPILOT-STATE-VERSION-WHITESPACE] inverse: a whitespace-carrying pluginVersion is a CORRUPT state named for its transport reason — zero vendor mutation, never a fabricated version verdict",
		inv.status !== 0 &&
			(inv.stderr ?? "").includes("whitespace") &&
			!(inv.stderr ?? "").includes("version-drift") &&
			inv.installed.includes(OURS) &&
			inv.calls.length === 0 &&
			existsSync(invHost.stateFile),
	);
	const docHost = makeFakeHost("doctor-ws-version", { installed: [OURS] });
	const doctorAsm = path.join(docHost.env.XDG_DATA_HOME as string, "entwurf", "meta-bridge-copilot", ".assembled");
	mkdirSync(path.dirname(docHost.stateFile), { recursive: true });
	writeFileSync(docHost.mktState, `${MKT}\t${doctorAsm}\n`);
	writeFileSync(docHost.stateFile, wsState(doctorAsm));
	const doc = runVerb(docHost, "doctor-copilot-bridge");
	ok(
		"doctor: the same whitespace version is a corrupt-state RED, not a fabricated 'version drift'",
		doc.status !== 0 && doc.stdout.includes("whitespace") && !doc.stdout.includes("version drift"),
	);
}
{
	// The doctor's structural verdict IS the shared oracle (B defect 1's doctor half):
	// a host the real installer just set up reads green THROUGH the oracle, and one
	// broken oracle fact turns the same host red with the oracle's own reason. The
	// install here runs WITHOUT the ENTWURF_COPILOT_ASM seam so the assembly lands at
	// the XDG-derived path the doctor actually reads.
	const host = makeFakeHost("doctor-oracle", {});
	const envNoSeam = { ...host.env };
	delete envNoSeam.ENTWURF_COPILOT_ASM;
	const inst = spawnSync("bash", [path.join(REPO, "run.sh"), "install-copilot-bridge"], {
		env: envNoSeam,
		encoding: "utf8",
	});
	ok("precondition: a full install at the doctor's own XDG assembly path is green", inst.status === 0);
	const doctorAsm = path.join(host.env.XDG_DATA_HOME as string, "entwurf", "meta-bridge-copilot", ".assembled");
	const green = runVerb(host, "doctor-copilot-bridge");
	ok(
		"doctor: the freshly installed host is GREEN through the shared structural oracle",
		green.status === 0 && green.stdout.includes("shared structural oracle"),
	);
	rmSync(path.join(doctorAsm, PLUGIN, "hooks", "hooks.json"));
	const red = runVerb(host, "doctor-copilot-bridge");
	ok(
		"[QK:COPILOT-DOCTOR-ORACLE-CONSUMED] doctor: one broken oracle fact turns the same host RED with the oracle's reason",
		red.status !== 0 && red.stdout.includes("structural oracle") && red.stdout.includes("hooks.json"),
	);
}

// ── 14. the doctor's ownership axis (#86 C3a) ───────────────────────────────
{
	const host = makeFakeHost("doctor-list-broken", { installed: [], listFails: true });
	const res = runVerb(host, "doctor-copilot-bridge");
	ok(
		"the doctor reads a FAILING plugin list as UNKNOWN (red), never as an empty host",
		res.status !== 0 && res.stdout.includes("UNKNOWN"),
	);
}
{
	const host = makeFakeHost("doctor-ownership-drift", {
		installed: [OURS],
		marketplaces: [[MKT, "/somebody/elses/marketplace-root"]],
	});
	// The doctor derives its assembly path from XDG (no ENTWURF_COPILOT_ASM seam), so
	// bind the state to that derived path — the drift under test is the MARKETPLACE's.
	const doctorAsm = path.join(host.env.XDG_DATA_HOME as string, "entwurf", "meta-bridge-copilot", ".assembled");
	mkdirSync(path.dirname(host.stateFile), { recursive: true });
	writeFileSync(
		host.stateFile,
		JSON.stringify({
			schemaVersion: 1,
			qualifiedId: OURS,
			marketplaceName: MKT,
			assemblyPath: doctorAsm,
			pluginVersion: SHIPPED_VERSION,
			ownedMarketplace: true,
			ownedAssembly: true,
			installedAt: "2026-08-27T00:00:00Z",
		}),
	);
	const res = runVerb(host, "doctor-copilot-bridge");
	ok(
		"the doctor FAILs a marketplace registered under our name at another path (ownership drift) and prints the axes separately",
		res.status !== 0 && res.stdout.includes("ownership drift") && res.stdout.includes("ownership axis: FAIL"),
	);
}

writeFileSync(path.join(root, "gate.ok"), "");
console.log(`[check-copilot-birth-hook] ${passed} assertions ok`);
