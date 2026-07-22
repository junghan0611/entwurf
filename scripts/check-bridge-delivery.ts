/**
 * check-bridge-delivery — demo/demo.sh scene 3, recovered as a deterministic gate.
 *
 * WHY THIS EXISTS
 * demo.sh drove two REAL pi panes and made one agent call entwurf_send at the other,
 * so it proved DELIVERY through whatever binary was actually installed. It cost real
 * model turns, and it is not wired into any gate. What replaced it split in half and
 * each half kept the other's blind spot:
 *
 *   smoke-entwurf-v2-matrix-live C2  delivers for real — but calls runEntwurfV2
 *                                    IN-PROCESS from the repo source.
 *   check-entwurf-bridge-boot        runs the MCP server — but `src/index.ts` with
 *                                    "no build step", and tools/list only, never call.
 *   check-pack-install               boots the INSTALLED bridge — tools/list only
 *                                    (this gate is now planted there too; see below).
 *   check-install-container          installs the real tgz — tools/list only.
 *
 * So every gate either delivered from source, or ran the artifact without delivering.
 * `entwurf_v2` through the shipped bundle was never once executed, and it shipped
 * dead through 0.12.8-repair.0: the bundle carried no capability registry, so every
 * real send died `ENOENT ... entwurf-capabilities.json` while entwurf_self /
 * entwurf_peers (which never read it) stayed green and hid the corpse.
 *
 * WHAT THIS DOES
 * Seeds an armed self-fetch citizen (the C2 recipe: upsertMetaSession +
 * writeMetaReceiverMarker owned by this live pid) into a fully env-isolated temp
 * world, then drives the CONSUMER ARTIFACT — spawned as its own process and spoken to
 * over MCP stdio — through a real `tools/call entwurf_v2`, and asserts the message
 * physically landed.
 *
 * The seeder is the repo source; the SUBJECT is the artifact. Separate processes, so
 * the seeder's (correct) source-depth resolution cannot mask the artifact's.
 *
 *   D1  the subject boots and registers entwurf_v2                   (artifact is alive)
 *   D2  tools/call entwurf_v2 returns success, not isError           (delivery executed)
 *   D3  exactly one .msg landed in the target mailbox                (the body moved)
 *   D4  the doorbell inbox.signal was poked                          (the citizen is wakeable)
 *   D5  no capability-registry error anywhere in the response/stderr (the 0.12.8 corpse)
 *
 * Deterministic: no model, no network, no API cost, no backend. Temp dirs only.
 *
 * TWO CELLS, ONE SCENE. The default subject is the checkout's built dist entry,
 * invoked directly with node — NOT start.sh, which picks its mode by LOCATION (under
 * node_modules → dist, else → src via strip-types) and would therefore run the SOURCE
 * from a checkout, silently turning this back into a source-depth test.
 * `ENTWURF_DELIVERY_SUBJECT` re-points this same scene at another consumer artifact:
 * check-pack-install hands it the npm-INSTALLED `.bin/entwurf-bridge`, where start.sh's
 * node_modules→dist branch IS the correct launcher — and where, until now, nothing had
 * ever delivered through it. Seeder, assertions and isolation are identical across the
 * two cells; only the artifact under test moves, and the subject is printed so a green
 * can never be read as being about an artifact it was not about.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { upsertMetaSession, writeMetaReceiverMarker } from "../pi-extensions/lib/meta-session.ts";

const REPO = path.join(import.meta.dirname, "..");
const DIST_ENTRY = path.join(REPO, "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js");
const SUBJECT_OVERRIDE = (process.env.ENTWURF_DELIVERY_SUBJECT ?? "").trim();

let passed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

function newestSourceMtime(dir: string, newest = 0): number {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) newest = newestSourceMtime(full, newest);
		else if (entry.name.endsWith(".ts")) newest = Math.max(newest, fs.statSync(full).mtimeMs);
	}
	return newest;
}

// ---------------------------------------------------------------------------
// The subject, named out loud before anything runs.
//
// Default cell — the checkout's built dist entry. It must exist AND be newer than
// the source it claims to be built from: a stale dist would let this gate go green
// on bytes nobody ships, the same family of lie the gate exists to end.
//
// Override cell — a launcher handed in by check-pack-install, whose bytes came from
// a tarball that gate packed in the same run. Freshness there is that gate's
// question (it packs from the working tree and asserts the dist is in the tarball),
// so re-asking it here against a repo path would be answering about the wrong tree.
// ---------------------------------------------------------------------------
let subjectCmd: string;
let subjectArgs: string[];
if (SUBJECT_OVERRIDE) {
	if (!path.isAbsolute(SUBJECT_OVERRIDE)) {
		console.error(
			`check-bridge-delivery: ENTWURF_DELIVERY_SUBJECT must be an absolute path — got '${SUBJECT_OVERRIDE}'`,
		);
		process.exit(1);
	}
	try {
		fs.accessSync(SUBJECT_OVERRIDE, fs.constants.X_OK);
	} catch {
		console.error(`check-bridge-delivery: ENTWURF_DELIVERY_SUBJECT is not an executable file — ${SUBJECT_OVERRIDE}`);
		process.exit(1);
	}
	subjectCmd = SUBJECT_OVERRIDE;
	subjectArgs = [];
	console.log(`  subject  handed-in launcher — ${SUBJECT_OVERRIDE}`);
} else {
	if (!fs.existsSync(DIST_ENTRY)) {
		console.error(`check-bridge-delivery: bridge bundle not built — ${DIST_ENTRY}\n  run: pnpm run build-bridge`);
		process.exit(1);
	}
	subjectCmd = process.execPath;
	subjectArgs = [DIST_ENTRY];
	console.log(`  subject  built dist entry — ${DIST_ENTRY}`);
	const srcNewest = Math.max(
		newestSourceMtime(path.join(REPO, "pi-extensions")),
		newestSourceMtime(path.join(REPO, "mcp/entwurf-bridge/src")),
	);
	ok(
		"artifact is not stale (dist entry is newer than the newest .ts source)",
		fs.statSync(DIST_ENTRY).mtimeMs >= srcNewest,
		`--- dist ---\n${DIST_ENTRY}\nrebuild with: pnpm run build-bridge`,
	);
}

// ---------------------------------------------------------------------------
// Temp world — fully env-isolated. Every meta dir the send path touches is
// redirected, so a real citizen on the operator's machine can never be a target
// and no artifact of this gate lands in the real store.
// ---------------------------------------------------------------------------
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bridge-delivery-"));
const sessionsDir = path.join(tmp, "sessions");
const mailboxDir = path.join(tmp, "mailbox");
const receiversDir = path.join(tmp, "receivers");
for (const d of [sessionsDir, mailboxDir, receiversDir]) await fsp.mkdir(d, { recursive: true });

// The C2 recipe: a self-fetch (claude-code) citizen whose receiver marker is owned
// by a LIVE pid — this process — which is what makes it deliverable rather than a
// terminated session the guard must fail-closed on.
const minted = upsertMetaSession({
	input: { backend: "claude-code", nativeSessionId: `bridge-delivery-${process.pid}`, cwd: tmp },
	dir: sessionsDir,
});
const gid = minted.record.gardenId;
writeMetaReceiverMarker({
	gardenId: gid,
	backend: "claude-code",
	nativeSessionId: minted.record.nativeSessionId,
	ownerPid: process.pid,
	armProvenance: "session-start",
	receiversDir,
});

// ---------------------------------------------------------------------------
// Drive the artifact over MCP stdio.
// ---------------------------------------------------------------------------
const env: NodeJS.ProcessEnv = {
	...process.env,
	ENTWURF_META_SESSIONS_DIR: sessionsDir,
	ENTWURF_META_MAILBOX_DIR: mailboxDir,
	ENTWURF_META_RECEIVERS_DIR: receiversDir,
	// The ENTWURF_META_* trio does NOT cover the socket surface: the bridge reads
	// ENTWURF_DIR (index.ts:71, default ~/.pi/entwurf-control) for its socket-conflict
	// inspection, so without this the gate would consult the operator's REAL live
	// sockets. Read-only against a fresh gid, so it was harmless — but a gate that
	// half-isolates is a gate whose result depends on the host it ran on.
	ENTWURF_DIR: path.join(tmp, "sockets"),
};
// Same adversarial hygiene as the check-pack-install boot probe: a leaked NODE_PATH
// could resolve modules from a tree the artifact does not actually ship with.
delete env.NODE_PATH;

let child: ChildProcess | null = null;
let stderr = "";
try {
	child = spawn(subjectCmd, subjectArgs, { stdio: ["pipe", "pipe", "pipe"], env });
	child.stderr?.on("data", (d) => {
		stderr += d.toString();
	});

	const replies = new Map<number, any>();
	let buf = "";
	child.stdout?.on("data", (d) => {
		buf += d.toString();
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const t = line.trim();
			if (!t) continue;
			try {
				const msg = JSON.parse(t);
				if (typeof msg?.id === "number") replies.set(msg.id, msg);
			} catch {}
		}
	});

	const send = (o: unknown) => child?.stdin?.write(`${JSON.stringify(o)}\n`);
	const await_ = (id: number, what: string, ms = 15_000): Promise<any> =>
		new Promise((resolve, reject) => {
			const t0 = Date.now();
			const iv = setInterval(() => {
				const got = replies.get(id);
				if (got) {
					clearInterval(iv);
					resolve(got);
				} else if (Date.now() - t0 > ms) {
					clearInterval(iv);
					reject(new Error(`timeout waiting for ${what}${stderr.trim() ? `\n--- stderr ---\n${stderr}` : ""}`));
				}
			}, 50);
		});

	// D1 — the artifact boots and carries the verb under test.
	send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
	const listed = await await_(1, "tools/list");
	const names: string[] = (listed?.result?.tools ?? []).map((t: { name?: string }) => t?.name);
	ok(
		"D1: the subject artifact boots and registers entwurf_v2",
		names.includes("entwurf_v2"),
		`--- tools ---\n${names.join(",") || "(none)"}`,
	);

	// D2 — the real call. This is the line no gate has ever executed against the artifact.
	send({
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: {
			name: "entwurf_v2",
			arguments: {
				target: gid,
				intent: "fire-and-forget",
				mode: "follow_up",
				message: "check-bridge-delivery: demo scene 3, recovered as a gate.",
			},
		},
	});
	const called = await await_(2, "tools/call entwurf_v2");
	const body: string = called?.result?.content?.[0]?.text ?? JSON.stringify(called);
	ok("D2: tools/call entwurf_v2 executed (not isError)", called?.result?.isError !== true, `--- response ---\n${body}`);

	// D3/D4 — the body physically moved and the citizen is wakeable.
	const boxDir = path.join(mailboxDir, gid);
	const files = await fsp.readdir(boxDir).catch(() => [] as string[]);
	ok(
		"D3: exactly one .msg landed in the target mailbox",
		files.filter((f) => f.endsWith(".msg")).length === 1,
		`--- mailbox ${boxDir} ---\n${files.join("\n") || "(empty)"}\n--- response ---\n${body}`,
	);
	ok(
		"D4: the doorbell inbox.signal was poked",
		fs.existsSync(path.join(boxDir, "inbox.signal")),
		`--- mailbox ${boxDir} ---\n${files.join("\n") || "(empty)"}`,
	);

	// D5 — the specific corpse. Named explicitly so a regression reads as itself in
	// the log instead of as a generic delivery failure.
	const capabilityCorpse = /entwurf-capabilities\.json|ENOENT/;
	ok(
		"D5: no capability-registry ENOENT in the response or the artifact's stderr",
		!capabilityCorpse.test(body) && !capabilityCorpse.test(stderr),
		`--- response ---\n${body}\n--- stderr ---\n${stderr.slice(0, 1500)}`,
	);
} finally {
	try {
		child?.kill("SIGTERM");
	} catch {}
	await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\ncheck-bridge-delivery: PASS (${passed} assertions)`);
process.exit(0);
