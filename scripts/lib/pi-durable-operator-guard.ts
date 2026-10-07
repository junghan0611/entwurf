/**
 * The pi-durable checkout gates' coarse operator registration guard (#129; re-scoped by the #130 P1b
 * review). Shared by check-pi-durable-contact, -send and -receive.
 *
 * Subject: a gate run leaves the operator's pi-durable REGISTRATIONS exactly as it found them. Existing
 * registrations — earlier sessions' records, receivers, sender markers — are ordinary operator state
 * and never a red by their presence; only a change across the run is. The snapshot holds, under the
 * operator agent dir:
 *   - every pi-durable meta record (`meta-sessions/*.meta.json` whose backend is pi-durable) by name
 *     and sha256 of its bytes, so an edit under the same filename is seen;
 *   - every pi-durable receiver marker (`meta-receivers/*.json`, same backend filter), likewise;
 *   - every pi-durable sender marker (`meta-senders/pi-durable/*`), likewise;
 *   - the entry NAMES two levels into `experimental/durable-sessions` (cwd-hash dirs and their session
 *     dirs) — never a file inside them.
 * Scope, stated: a coarse registration guard. It reads no auth, settings, transcript or SQLite/session
 * content, makes no operator-byte claim beyond the files above, and NEVER deletes or repairs anything.
 * A concurrent operator session that registers during a run turns it red; that is the coarse guard's
 * honest answer, not a gate defect to suppress.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function backendOf(file: string): unknown {
	try {
		return (JSON.parse(fs.readFileSync(file, "utf8")) as { backend?: unknown }).backend;
	} catch {
		// Bounded environment probe: an unreadable or non-JSON file is not a pi-durable registration.
		return undefined;
	}
}

/** `{name: sha256}` for the regular files in `dir` that pass `keep`, in name order; `{}` when absent. */
function digests(dir: string, keep: (name: string) => boolean): Record<string, string> {
	if (!fs.existsSync(dir)) return {};
	const out: Record<string, string> = {};
	for (const name of fs.readdirSync(dir).sort()) {
		const file = path.join(dir, name);
		if (fs.lstatSync(file).isFile() && keep(name)) out[name] = sha256(file);
	}
	return out;
}

/** Entry names one and two levels under `dir` (`a`, `a/b`), sorted; nothing inside is opened. */
function names(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	for (const first of fs.readdirSync(dir).sort()) {
		out.push(first);
		const at = path.join(dir, first);
		if (fs.lstatSync(at).isDirectory()) for (const second of fs.readdirSync(at).sort()) out.push(`${first}/${second}`);
	}
	return out;
}

export interface OperatorPiDurableSnapshot {
	readonly records: Record<string, string>;
	readonly receivers: Record<string, string>;
	readonly senders: Record<string, string>;
	readonly durableSessions: string[];
}

/** The snapshot of `agentDir` (the operator's `~/.pi/agent`), read-only. */
export function operatorPiDurableSnapshot(agentDir: string): OperatorPiDurableSnapshot {
	const sessions = path.join(agentDir, "meta-sessions");
	const receivers = path.join(agentDir, "meta-receivers");
	return {
		records: digests(sessions, (n) => n.endsWith(".meta.json") && backendOf(path.join(sessions, n)) === "pi-durable"),
		receivers: digests(receivers, (n) => n.endsWith(".json") && backendOf(path.join(receivers, n)) === "pi-durable"),
		senders: digests(path.join(agentDir, "meta-senders", "pi-durable"), () => true),
		durableSessions: names(path.join(agentDir, "experimental", "durable-sessions")),
	};
}

/** The guard's label body: counts only, so a receipt names the subject without copying operator paths. */
export function describeOperatorSnapshot(snapshot: OperatorPiDurableSnapshot): string {
	return `${Object.keys(snapshot.records).length} pi-durable records, ${Object.keys(snapshot.receivers).length} receivers, ${Object.keys(snapshot.senders).length} sender markers, ${snapshot.durableSessions.length} durable session entries`;
}

/** Unchanged across the run: same names, same bytes, same session entries. */
export function operatorSnapshotUnchanged(
	before: OperatorPiDurableSnapshot,
	after: OperatorPiDurableSnapshot,
): boolean {
	return JSON.stringify(before) === JSON.stringify(after);
}
