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
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveFactList } from "../pi-extensions/lib/entwurf-facts.ts";
import { listAllMetaIdentitiesDir } from "../pi-extensions/lib/meta-session.ts";

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
execFileSync("bash", [path.join(REPO, "scripts", "copilot-bridge-install.sh"), "--assemble-only"], {
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
	"every hook entry's `exec` is a STRING (an array is rejected at plugin load)",
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
function fire(envelope: unknown, storeDir: string): Fired {
	const res = spawnSync(launcher, [], {
		input: typeof envelope === "string" ? envelope : JSON.stringify(envelope),
		env: { ...process.env, PI_CODING_AGENT_DIR: storeDir },
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
ok("a no-argv fire with the NATIVE envelope exits 0", first.status === 0);
ok("the hook emits the neutral response and nothing else", first.stdout.trim() === "{}");
let live = records(store);
ok("exactly one record was minted", live.length === 1);
ok("the record's backend is copilot", live[0]?.backend === "copilot");
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

// ── 6. birth writes NOTHING a doorbell-less backend cannot back ─────────────
const storeEntries = readdirSync(store);
ok(
	"no mailbox, sender or receiver marker was created — there is no doorbell to back one",
	!storeEntries.includes("meta-mailbox") &&
		!storeEntries.includes("meta-senders") &&
		!storeEntries.includes("meta-receivers"),
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
refuses("disagreeing sessionId/session_id", { sessionId: "a-1", session_id: "b-2", cwd: CWD }, "disagree");
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

writeFileSync(path.join(root, "gate.ok"), "");
console.log(`[check-copilot-birth-hook] ${passed} assertions ok`);
