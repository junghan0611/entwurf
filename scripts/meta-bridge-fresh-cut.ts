#!/usr/bin/env node
/**
 * meta-bridge-fresh-cut — the ONE generation verb (the fresh-cut subtraction).
 *
 * Policy (frozen, 4 sentences):
 *   1. The active citizen store is v3-only and provides NO cross-generation
 *      address or resume continuity — the bridge is a call-relay, never memory.
 *   2. If even one record in the store is unreadable to the live schema,
 *      ordinary install/runtime REFUSES to write and demands this explicit verb.
 *   3. fresh-cut quiesces first, then moves the whole previous generation to a
 *      timestamped archive and opens an empty live generation.
 *   4. The archive is forensic bytes only: no runtime reads it and no restore
 *      verb exists. Native transcripts and the andenken memory axes are never
 *      touched — sessions flow; memory lives there, not here.
 *
 * There is deliberately NO migrator behind this verb. Reading a previous
 * generation's schema in order to carry records forward was ~2,900 lines of
 * machinery serving a requirement that does not exist (old sessions are never
 * resumed across a generation). The whole upgrade story is one sentence:
 * quiesce → fresh-cut → go.
 *
 * What moves / clears / stays (the generation boundary):
 *   - meta-sessions/  (identity records)  → ARCHIVED  (`<dir>.archive-<ts>`)
 *   - meta-mailbox/   (messages+receipts) → ARCHIVED  (`<dir>.archive-<ts>`)
 *   - meta-senders/, meta-receivers/ markers → CLEARED (disposable process
 *     state; the quiesce gate has already proven every owner pid is gone)
 *   - control sockets (*.sock)            → CLEARED if probed dead (the GC
 *     rule: only a demonstrably dead socket may be unlinked)
 *   - native transcripts, andenken/embedding axes, install ownership state
 *                                          → UNTOUCHED
 *
 * QUIESCE GATE (refuse before any move): a LIVE citizen must never have its
 * address archived out from under it — that severs the very reply path a
 * running agent is serving. The gate refuses on:
 *   - an ALIVE control socket (a listener accepted the probe),
 *   - an INDETERMINATE control socket (no proof either way — never cut under
 *     uncertainty; F3: indeterminate is not dead),
 *   - a SYMLINKED socket entry (never probed — inspect and remove manually),
 *   - a sender/receiver marker whose owner pid is still the same live process
 *     (pid + start-key match, the pid-reuse guard).
 *
 * Idempotent and crash-safe by shape: each directory moves in a single atomic
 * rename; a crash between the two renames leaves a half-cut generation that a
 * simple re-run finishes (with its own stamp). Running on a clean/empty host
 * just opens a fresh generation and says so.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONTROL_SOCKET_SUFFIX, defaultControlSocketDir } from "../pi-extensions/lib/control-socket-path.js";
import {
	defaultMetaMailboxDir,
	defaultMetaReceiversDir,
	defaultMetaSendersDir,
	defaultMetaSessionsDir,
	processStartKey,
} from "../pi-extensions/lib/meta-session.ts";
import { probeSocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

function usage(code: number): never {
	console.error(
		[
			"usage: node --experimental-strip-types scripts/meta-bridge-fresh-cut.ts",
			"       (dev clone: `./run.sh meta-bridge-fresh-cut` · installed package: `entwurf meta-bridge-fresh-cut`)",
			"",
			"  Open a fresh meta-bridge generation: quiesce-check every live surface, then",
			"  archive meta-sessions/ + meta-mailbox/ to `<dir>.archive-<timestamp>` siblings,",
			"  clear dead sender/receiver markers and dead control sockets, and open empty",
			"  live dirs. No migration, no restore: the archive is forensic bytes only.",
			"",
			"store   = ENTWURF_META_SESSIONS_DIR || <PI_CODING_AGENT_DIR|~/.pi/agent>/meta-sessions",
			"mailbox = ENTWURF_META_MAILBOX_DIR  || <PI_CODING_AGENT_DIR|~/.pi/agent>/meta-mailbox",
			"sockets = ENTWURF_DIR               || ~/.pi/entwurf-control",
		].join("\n"),
	);
	process.exit(code);
}

/** Denote-style local timestamp for archive dir names. */
function stamp(now: Date = new Date()): string {
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

interface QuiesceViolation {
	surface: string;
	detail: string;
}

/**
 * Marker files whose owner pid is still the same live process (pid+startKey).
 * Layouts differ per marker kind and BOTH must be walked: sender markers live
 * one level down (`<senders>/<backend>/<pid>.json` — metaSenderMarkerPath),
 * receiver markers at the top (`<receivers>/<gardenId>.json`). A scan that only
 * saw the top level would call a host quiesced while a live agy/Claude sender
 * marker sat in its backend subdir.
 */
function liveMarkerOwners(dir: string, label: string): { live: QuiesceViolation[]; deadFiles: string[] } {
	const live: QuiesceViolation[] = [];
	const deadFiles: string[] = [];
	if (!fs.existsSync(dir)) return { live, deadFiles };
	const markerFiles: { file: string; shown: string }[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.isFile() && entry.name.endsWith(".json")) {
			markerFiles.push({ file: path.join(dir, entry.name), shown: entry.name });
		} else if (entry.isDirectory()) {
			const sub = path.join(dir, entry.name);
			for (const name of fs.readdirSync(sub).sort()) {
				if (name.endsWith(".json")) markerFiles.push({ file: path.join(sub, name), shown: `${entry.name}/${name}` });
			}
		}
	}
	for (const { file, shown } of markerFiles) {
		let ownerPid: number | null = null;
		let ownerStartKey = "";
		try {
			const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
			if (typeof raw.ownerPid === "number" && Number.isInteger(raw.ownerPid)) ownerPid = raw.ownerPid;
			if (typeof raw.ownerStartKey === "string") ownerStartKey = raw.ownerStartKey;
		} catch {
			// unreadable marker = disposable residue (a marker we cannot trust is
			// "no authoritative owner" — same rule the sender-marker reader applies)
		}
		if (ownerPid !== null && ownerStartKey !== "" && processStartKey(ownerPid) === ownerStartKey) {
			live.push({ surface: label, detail: `${shown} (owner pid ${ownerPid} is still running)` });
		} else {
			deadFiles.push(file);
		}
	}
	return { live, deadFiles };
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	if (args.includes("-h") || args.includes("--help")) usage(0);
	if (args.length > 0) usage(2);

	const storeDir = defaultMetaSessionsDir();
	const mailboxDir = defaultMetaMailboxDir();
	const sendersDir = defaultMetaSendersDir();
	const receiversDir = defaultMetaReceiversDir();
	const socketDir = process.env.ENTWURF_DIR ?? defaultControlSocketDir(os.homedir());

	console.log(`meta-bridge fresh-cut: store ${storeDir}`);

	// ── quiesce gate: refuse before any move ─────────────────────────────────
	const violations: QuiesceViolation[] = [];
	const deadSockets: string[] = [];
	if (fs.existsSync(socketDir)) {
		for (const filename of fs.readdirSync(socketDir).sort()) {
			if (!filename.endsWith(CONTROL_SOCKET_SUFFIX)) continue;
			const file = path.join(socketDir, filename);
			let entryStat: fs.Stats;
			try {
				entryStat = fs.lstatSync(file);
			} catch {
				continue; // raced away — nothing to cut
			}
			if (entryStat.isSymbolicLink()) {
				// A symlinked socket can redirect a probe to another session's listener
				// — never probed, never auto-removed. Operator inspects it by hand.
				violations.push({
					surface: "control socket",
					detail: `${filename} is a SYMLINK — inspect and remove manually`,
				});
				continue;
			}
			const liveness = await probeSocketLiveness(file);
			if (liveness === "dead") {
				deadSockets.push(file);
			} else {
				// alive AND indeterminate both refuse: when we don't know, we don't cut.
				violations.push({ surface: "control socket", detail: `${filename} probes ${liveness}` });
			}
		}
	}
	const senders = liveMarkerOwners(sendersDir, "sender marker");
	const receivers = liveMarkerOwners(receiversDir, "receiver marker");
	violations.push(...senders.live, ...receivers.live);

	if (violations.length > 0) {
		for (const v of violations) console.error(`LIVE ${v.surface}: ${v.detail}`);
		console.error(
			`REFUSE: ${violations.length} live/uncertain surface(s) above — a running citizen must not have its ` +
				"address archived out from under it. Quiesce those sessions (close them / let them exit), " +
				"then re-run the same command. Nothing was moved.",
		);
		return 1;
	}

	// ── the cut: archive the generation, clear dead transport residue ────────
	const ts = stamp();
	const archived: string[] = [];
	for (const dir of [storeDir, mailboxDir]) {
		// An absent or EMPTY dir holds no generation — nothing to archive.
		if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) continue;
		const archiveDir = `${dir}.archive-${ts}`;
		if (fs.existsSync(archiveDir)) {
			console.error(`REFUSE: archive dir already exists: ${archiveDir} — wait a second and re-run.`);
			return 1;
		}
		fs.renameSync(dir, archiveDir);
		archived.push(archiveDir);
	}
	let cleared = 0;
	for (const file of [...senders.deadFiles, ...receivers.deadFiles, ...deadSockets]) {
		try {
			fs.unlinkSync(file);
			cleared += 1;
		} catch {
			// raced away — already gone is the goal state
		}
	}
	fs.mkdirSync(storeDir, { recursive: true });
	fs.mkdirSync(mailboxDir, { recursive: true });

	if (archived.length === 0) {
		console.log("nothing to archive (no previous generation on this host).");
	} else {
		for (const dir of archived) console.log(`archived: ${dir}`);
	}
	if (cleared > 0) console.log(`cleared: ${cleared} dead marker/socket file(s) (disposable process state)`);
	console.log(`fresh generation open: ${storeDir} (empty, v3-only)`);
	console.log(
		"untouched: native transcripts, andenken/embedding memory axes, install state. " +
			"The archive is forensic only — no runtime reads it and there is no restore verb.",
	);
	return 0;
}

main().then(
	(code) => process.exit(code),
	(err) => {
		console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
		console.error("FAIL: fresh-cut did not complete — the message above names the cause; re-run after fixing it.");
		process.exit(1);
	},
);
