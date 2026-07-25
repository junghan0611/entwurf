#!/usr/bin/env node
/**
 * meta-bridge-fresh-cut — the ONE generation verb (the fresh-cut subtraction).
 *
 * Policy (frozen, 4 sentences):
 *   1. The active citizen store is v3-only and provides NO cross-generation
 *      address or resume continuity — the bridge is a call-relay, never memory.
 *   2. If even one entry in the store fails certification, install and citizen
 *      birth/registration REFUSE before writing and demand this explicit verb.
 *   3. fresh-cut REQUIRES quiescence — it verifies it and refuses while any
 *      surface is live or unprovable — then moves the whole previous generation
 *      to a timestamped archive and opens an empty live generation.
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
 * address archived out from under it — that severs the very reply path a running
 * agent is serving. Refusing needs no proof of life; CUTTING needs proof of
 * death. The gate refuses on both cases and names which one it saw:
 *   - LIVE — an ALIVE control socket (a listener accepted the probe), a
 *     sender/receiver marker whose owner pid is still the same process (pid +
 *     start-key match, the pid-reuse guard), or a native-push (agy) conversation
 *     whose own adapter probe answers ALIVE;
 *   - UNCERTAIN — an INDETERMINATE socket (F3: indeterminate is not dead), a
 *     SYMLINKED socket or marker (never followed), a marker that cannot name its
 *     owner (malformed JSON, missing `ownerPid`/`ownerStartKey`), a crashed
 *     writer's `.tmp` half-marker, any entry no marker layout explains, a
 *     native-push conversation that probes indeterminate / cannot be probed, or
 *     a surface DIRECTORY that cannot be inspected at all (absent is ENOENT
 *     alone — a dir behind an unsearchable ancestor is unknown, not empty — and
 *     the name must hold an actual directory: a symlinked surface is never
 *     walked or renamed).
 * Only a marker whose named owner demonstrably no longer holds that pid is dead,
 * and only a dead marker/socket is cleared.
 *
 * THE MARKER WALK IS NOT THE WHOLE WORLD. A native-push (agy) citizen is registered
 * with NO marker of any kind and is dispatched straight off its record, so marker
 * absence is its NORMAL deliverable state — a socket+marker scan would call such a host
 * quiesced while a live conversation was still being served. Those citizens are
 * therefore asked from the records themselves, via the adapter probe that dispatch uses
 * (see {@link inspectNativePushCitizens}, which also states the one case it passes over
 * and why).
 *
 * Idempotent and crash-safe by shape: the WHOLE move plan is preflighted — every
 * archive destination checked, every source parent probed for write permission —
 * before the first rename, so the COMMON deterministic refusals are true no-ops
 * instead of half-cut generations; then each directory moves in a single atomic
 * rename. No preflight can promise the rename: a permission probe does not see a
 * sticky-bit parent holding a foreign-owned entry, an immutable attribute, a
 * read-only mount or an LSM denial, and the world can change under us besides.
 * That is why the loop, not the plan, carries the honesty: a failure BETWEEN
 * renames reports exactly what already moved (`archived so far:`) and a re-run
 * finishes the cut with its own stamp.
 * Running on a clean/empty host just opens a fresh generation and says so.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONTROL_SOCKET_SUFFIX, defaultControlSocketDir } from "../pi-extensions/lib/control-socket-path.js";
import { nativePushSupported } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import {
	classifyMarkerOwner,
	defaultMetaMailboxDir,
	defaultMetaReceiversDir,
	defaultMetaSendersDir,
	defaultMetaSessionsDir,
	type MetaIdentity,
	parseMetaIdentity,
	probePidExistence,
	processStartKey,
} from "../pi-extensions/lib/meta-session.ts";
import { resolveNativePushAdapter } from "../pi-extensions/lib/native-push/adapter.ts";
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
	/**
	 * `live` = we PROVED something is still running. `uncertain` = we could not
	 * prove it is gone. Both refuse the cut; they are reported apart so the
	 * operator knows whether to close a session or to inspect a file.
	 */
	kind: "live" | "uncertain";
}

/**
 * May an archive destination name be used? `false` is ENOENT alone (the name is
 * provably free — a dangling symlink still occupies it, via lstat). Any other
 * errno throws: a name we cannot inspect is not a free one.
 */
function archiveDestOccupied(dest: string): boolean {
	try {
		fs.lstatSync(dest);
		return true;
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT") return false;
		throw new Error(
			`cannot inspect archive destination ${dest}: ${err instanceof Error ? err.message : String(err)}. ` +
				"Nothing was moved.",
		);
	}
}

/**
 * Classify a surface DIRECTORY the way {@link inspectRecordEntry} classifies a
 * record path — with a KIND contract on top, because every consumer of this
 * answer either walks the directory or RENAMES it:
 *
 *   - `directory` — an actual directory (lstat, never followed). Its readdir can
 *     still fail, which stays fail-loud.
 *   - `absent` — ENOENT alone.
 *   - `irregular` — the name is held by something that is NOT a directory: a
 *     symlink (even to a directory), a file, a fifo. Never walked and never
 *     renamed: readdir would inspect the TARGET while rename would move the
 *     LINK, so the cut would quiesce-check one thing and archive another.
 *   - `uninspectable` — every other errno: EACCES on an ANCESTOR (stat cannot
 *     even reach the path), ENOTDIR, ELOOP. Must never read as absent:
 *     `existsSync` answered `false` for a socket dir behind an unsearchable
 *     ancestor, which silently passed that whole surface through the quiesce
 *     gate and archived the store under it (2026-07-25 second fresh-eyes round —
 *     the same laundering the first round fixed in certifyActiveStoreDir, one
 *     level up at the directory layer).
 *
 * Callers fold `irregular` and `uninspectable` into the same consequence — an
 * UNCERTAIN refusal naming the surface — because both mean "this surface cannot
 * be proven quiesced from here".
 */
type SurfaceDirState =
	| { state: "directory" }
	| { state: "absent" }
	| { state: "irregular"; detail: string }
	| { state: "uninspectable"; detail: string };

function classifySurfaceDir(dir: string): SurfaceDirState {
	try {
		const st = fs.lstatSync(dir);
		if (st.isDirectory()) return { state: "directory" };
		return {
			state: "irregular",
			detail: st.isSymbolicLink()
				? "the name is held by a SYMLINK — walking would inspect its target while renaming would move the link, so it is never followed"
				: "the name is held by a non-directory (file/fifo/special)",
		};
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT") return { state: "absent" };
		return { state: "uninspectable", detail: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Walk a marker directory and classify every entry as LIVE, DEAD or UNCERTAIN.
 *
 * The walk accepts the UNION of both marker layouts — a `.json` at the root and a
 * `.json` one backend-subdir down — rather than policing which kind belongs where:
 * sender markers live one level down (`<senders>/<backend>/<pid>.json`,
 * metaSenderMarkerPath) and receiver markers at the root
 * (`<receivers>/<gardenId>.json`), and liveness is proven from each marker's own
 * owner facts, not from its position. What matters is that BOTH depths are visited:
 * a scan that only saw the root would call a host quiesced while a live agy/Claude
 * sender marker sat in its backend subdir. Anything deeper than one level is not
 * part of any layout and is inspected by hand instead of swept.
 *
 * DEAD IS A PROOF, NOT A DEFAULT — and the proof is not ours to compute here: the
 * verdict comes from `classifyMarkerOwner`, because `processStartKey` returns ""
 * for a pid that is gone AND for one we merely cannot read, so comparing keys
 * inline turns "unknown" into "left" (fail-open). Everything unprovable is
 * UNCERTAIN and REFUSES the cut: malformed JSON, a missing/non-positive owner
 * field, a symlinked or non-regular marker, a `.tmp` half-write, an unexpected
 * layout entry, and an owner whose start-key cannot be read while its pid may
 * still exist. This is the rule the socket probe already holds (`indeterminate`
 * refuses, never "probably dead") — a destructive generation cut must be
 * fail-closed, because the cost of guessing wrong is archiving a running citizen's
 * address out from under it. An unreadable marker at REST is disposable residue; an
 * unreadable marker as EVIDENCE OF QUIESCENCE is no evidence at all.
 */
function inspectMarkers(dir: string, label: string): { violations: QuiesceViolation[]; deadFiles: string[] } {
	const violations: QuiesceViolation[] = [];
	const deadFiles: string[] = [];
	const markerFiles: { file: string; shown: string }[] = [];
	const uncertain = (shown: string, why: string): void => {
		violations.push({ surface: label, detail: `${shown} — ${why}`, kind: "uncertain" });
	};
	const dirState = classifySurfaceDir(dir);
	if (dirState.state === "absent") return { violations, deadFiles };
	if (dirState.state !== "directory") {
		uncertain(dir, `surface could not be inspected (${dirState.detail}): an unreadable surface is not a quiesced one`);
		return { violations, deadFiles };
	}
	// depth 0 = the marker root, depth 1 = a backend subdir. Nothing deeper is part
	// of any marker layout, so it is inspected by hand rather than swept.
	const walk = (root: string, prefix: string, depth: number): void => {
		for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const shown = `${prefix}${entry.name}`;
			if (entry.isSymbolicLink()) {
				uncertain(shown, "SYMLINK entry: its target is outside this directory's ownership and is never followed");
			} else if (entry.isDirectory()) {
				if (depth > 0) {
					uncertain(shown, "unexpected nested directory (marker layouts are at most one level deep)");
				} else {
					walk(path.join(root, entry.name), `${shown}/`, depth + 1);
				}
			} else if (!entry.isFile()) {
				uncertain(shown, "unexpected non-regular entry (fifo/socket/device)");
			} else if (entry.name.endsWith(".json")) {
				markerFiles.push({ file: path.join(root, entry.name), shown });
			} else {
				// Includes a crashed writer's `<name>.<hex>.tmp` half-marker: it may be
				// the partial write of a LIVE owner, so it is inspected, never assumed.
				uncertain(shown, "not a `.json` marker: cannot say whose process it belongs to");
			}
		}
	};
	walk(dir, "", 0);

	for (const { file, shown } of markerFiles) {
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch (err) {
			uncertain(shown, `unreadable marker (${err instanceof Error ? err.message : String(err)}): owner unprovable`);
			continue;
		}
		const ownerPid =
			typeof raw.ownerPid === "number" && Number.isInteger(raw.ownerPid) && raw.ownerPid > 0 ? raw.ownerPid : null;
		const ownerStartKey = typeof raw.ownerStartKey === "string" ? raw.ownerStartKey : "";
		if (ownerPid === null) {
			uncertain(shown, "no positive-integer `ownerPid`: owner unprovable");
			continue;
		}
		if (ownerStartKey === "") {
			uncertain(shown, "no `ownerStartKey`: a bare pid cannot distinguish the owner from a reused pid");
			continue;
		}
		// The verdict is NEVER derived here. `processStartKey` returns "" both for a pid
		// that is GONE and for one merely UNREADABLE (hidepid /proc, no ps), so a
		// destructive caller comparing keys itself reads "unknown" as "left" — fail-open,
		// the exact bug review 2026-07-25 found in this function. classifyMarkerOwner is
		// the one place a `dead` verdict is allowed to come from.
		const verdict = classifyMarkerOwner(ownerStartKey, {
			currentStartKey: processStartKey(ownerPid),
			pidExists: probePidExistence(ownerPid),
		});
		if (verdict === "live") {
			violations.push({ surface: label, detail: `${shown} (owner pid ${ownerPid} is still running)`, kind: "live" });
		} else if (verdict === "uncertain") {
			uncertain(
				shown,
				`owner pid ${ownerPid} could not be proven gone (its start-key is unreadable and the pid may still exist)`,
			);
		} else {
			deadFiles.push(file);
		}
	}
	return { violations, deadFiles };
}

/**
 * The native-push surface — the ONE live citizen kind that leaves no marker behind.
 *
 * The socket+marker walk above proves nothing about an agy conversation.
 * `entwurf_register_native` proves the conversation is ALIVE with an adapter probe and
 * then writes ONLY the record — "NO receiver marker is written here" (register.ts,
 * 보정①) — and the v2 decider reaches it the same way, `nativePushProbe(identity)` off
 * the record alone with no marker anywhere in the path (only the mailbox rail requires
 * an active-receiver marker). So for this backend a marker's ABSENCE is the normal
 * state of a fully deliverable citizen, and archiving its record severs the exact
 * reply path a running agent is serving.
 *
 * The verdict is the adapter's own 3-value probe, and its coordinates are what make
 * this enforceable without trapping the operator: no host process at all is `dead`
 * (quiescing agy — the very thing a refusal asks for — is what makes the cut legal), a
 * host serving this conversation is `alive`, and a live host that does not serve it is
 * `indeterminate` — fail-closed, the same rule the socket probe holds.
 *
 * WHY AN UNREADABLE RECORD IS PASSED OVER — and what that claim is NOT. It is the only
 * record this walk skips, and the claim is deliberately narrow: NOT "that native session
 * has exited", only "these bytes are not an address authority in the live runtime, so
 * they front no current-generation garden surface". Every path that ADDRESSES a citizen
 * goes through the live schema — `readMetaIdentityByGardenId`, the v2 `resolveTarget`,
 * the sender-marker trust — and each THROWS on a record this parser refuses, so nothing
 * can dispatch to it. (`entwurf_peers` still LISTS it as a diagnostic; a facts surface
 * reporting what it could not read is not an address.) A record we CAN read is the
 * opposite case: it is precisely what a dispatch would use.
 *
 * The alternatives are both worse, which is why this is the shape. Refusing every
 * unreadable record would deadlock the cut on exactly the previous-generation store it
 * exists to clear. Salvaging `backend`/`nativeSessionId` out of a shape the live schema
 * rejects, in order to probe it, would BE the legacy reader this repo deleted —
 * synthesizing authority from bytes we just declared unreadable.
 *
 * A native conversation that outlives the cut is not stranded: its next hook or
 * `register_native` mints it a record in the NEW generation. That is re-birth under a
 * NEW garden id, never continuity of the old one — the policy's first sentence, working
 * as designed. The archived record is never read again.
 */
async function inspectNativePushCitizens(storeDir: string): Promise<QuiesceViolation[]> {
	const violations: QuiesceViolation[] = [];
	const label = "native-push conversation";
	const dirState = classifySurfaceDir(storeDir);
	if (dirState.state === "absent") return violations;
	if (dirState.state !== "directory") {
		violations.push({
			surface: label,
			detail: `store ${storeDir} could not be inspected (${dirState.detail}): its citizens cannot be probed, so their liveness is unprovable`,
			kind: "uncertain",
		});
		return violations;
	}
	for (const entry of fs.readdirSync(storeDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.name.endsWith(".meta.json")) continue;
		if (!entry.isFile()) {
			// A symlink/dir/special wearing a record's name: its bytes live where this store
			// has no ownership, so it is never followed — and never assumed harmless either.
			violations.push({
				surface: label,
				detail: `${entry.name} is not a regular file — its bytes are outside this store and are never followed; inspect it by hand`,
				kind: "uncertain",
			});
			continue;
		}
		let identity: MetaIdentity;
		try {
			identity = parseMetaIdentity(fs.readFileSync(path.join(storeDir, entry.name), "utf8"));
		} catch {
			continue; // unreachable by every read path — see the contract above
		}
		if (!nativePushSupported(identity.backend)) continue;
		let status: string;
		let reason: string;
		try {
			const probe = await resolveNativePushAdapter(identity.backend).probe(identity.nativeSessionId);
			status = probe.status;
			reason = probe.status === "alive" ? `route ${probe.route.lsAddress}` : probe.reason;
		} catch (err) {
			// A probe that cannot run is not a dead conversation.
			violations.push({
				surface: label,
				detail: `${entry.name} (${identity.backend} ${identity.nativeSessionId}) could not be probed (${
					err instanceof Error ? err.message : String(err)
				}): liveness unprovable`,
				kind: "uncertain",
			});
			continue;
		}
		if (status === "alive") {
			violations.push({
				surface: label,
				detail: `${entry.name} — ${identity.backend} conversation ${identity.nativeSessionId} is LIVE (${reason})`,
				kind: "live",
			});
		} else if (status !== "dead") {
			violations.push({
				surface: label,
				detail: `${entry.name} — ${identity.backend} conversation ${identity.nativeSessionId} probes ${status} (${reason})`,
				kind: "uncertain",
			});
		}
	}
	return violations;
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
	const socketDirState = classifySurfaceDir(socketDir);
	if (socketDirState.state === "irregular" || socketDirState.state === "uninspectable") {
		violations.push({
			surface: "control socket",
			detail: `socket dir ${socketDir} could not be inspected (${socketDirState.detail}): a listener may be live behind it`,
			kind: "uncertain",
		});
	}
	if (socketDirState.state === "directory") {
		for (const filename of fs.readdirSync(socketDir).sort()) {
			if (!filename.endsWith(CONTROL_SOCKET_SUFFIX)) continue;
			const file = path.join(socketDir, filename);
			let entryStat: fs.Stats;
			try {
				entryStat = fs.lstatSync(file);
			} catch (err) {
				// The SAME rule the surface dirs hold, one level down at the ENTRY: absent is
				// ENOENT alone. `readdir` needs only READ on the directory while `lstat` needs
				// SEARCH — different bits — so a readable-but-unsearchable socket dir lists
				// every socket and then fails EACCES on each one. Folding that into "raced
				// away" skipped the whole surface SILENTLY and cut under live listeners
				// (2026-07-25 closure round: the directory-layer fix had not reached here).
				if ((err as { code?: unknown }).code === "ENOENT") continue; // raced away — nothing to cut
				violations.push({
					surface: "control socket",
					detail: `${filename} could not be inspected (${err instanceof Error ? err.message : String(err)}): a listener may be live behind it`,
					kind: "uncertain",
				});
				continue;
			}
			if (entryStat.isSymbolicLink()) {
				// A symlinked socket can redirect a probe to another session's listener
				// — never probed, never auto-removed. Operator inspects it by hand.
				violations.push({
					surface: "control socket",
					detail: `${filename} is a SYMLINK — inspect and remove manually`,
					kind: "uncertain",
				});
				continue;
			}
			const liveness = await probeSocketLiveness(file);
			if (liveness === "dead") {
				deadSockets.push(file);
			} else {
				// alive AND indeterminate both refuse: when we don't know, we don't cut.
				violations.push({
					surface: "control socket",
					detail: `${filename} probes ${liveness}`,
					kind: liveness === "alive" ? "live" : "uncertain",
				});
			}
		}
	}
	const senders = inspectMarkers(sendersDir, "sender marker");
	const receivers = inspectMarkers(receiversDir, "receiver marker");
	violations.push(...senders.violations, ...receivers.violations);
	// The marker-less surface, asked from the records themselves (see the contract above).
	violations.push(...(await inspectNativePushCitizens(storeDir)));

	if (violations.length > 0) {
		for (const v of violations) console.error(`${v.kind === "live" ? "LIVE" : "UNCERTAIN"} ${v.surface}: ${v.detail}`);
		const live = violations.filter((v) => v.kind === "live").length;
		const unknown = violations.length - live;
		console.error(
			`REFUSE: ${live} live and ${unknown} unprovable surface(s) above — a running citizen must not have its ` +
				"address archived out from under it, and an unprovable owner is not a dead one. " +
				"Quiesce those sessions (close them / let them exit), inspect anything listed UNCERTAIN, " +
				"then re-run the same command. Nothing was moved.",
		);
		return 1;
	}

	// ── the cut: plan the moves, preflight the whole plan, then rename ───────
	const ts = stamp();
	const plan: { src: string; dest: string }[] = [];
	for (const dir of [storeDir, mailboxDir]) {
		// An absent or EMPTY dir holds no generation — nothing to archive. Absent is
		// ENOENT alone: the gate above already refused an uninspectable STORE, but the
		// mailbox has no quiesce surface of its own, so this is where an unreadable
		// mailbox path must fail — planning past it would rename the store and then
		// die at the mailbox mkdir, a half-cut nobody asked for.
		const dirState = classifySurfaceDir(dir);
		if (dirState.state === "absent") continue;
		if (dirState.state !== "directory") {
			throw new Error(
				`cannot archive ${dir} (${dirState.detail}) — refusing to plan a cut over a surface that cannot be read. Nothing was moved.`,
			);
		}
		if (fs.readdirSync(dir).length === 0) continue;
		// The rename is `<dir>` → `<dir>.archive-<ts>`, a sibling, so ONE parent must
		// be writable per entry. Store and mailbox can live under DIFFERENT parents
		// (env overrides), and a parent that is readable but not writable fails only
		// at its own rename — after an earlier entry already moved: a half-cut. This
		// probe answers the COMMON permission case before anything moves; it is not a
		// promise the rename will succeed (see the loop below).
		try {
			fs.accessSync(path.dirname(dir), fs.constants.W_OK);
		} catch (err) {
			throw new Error(
				`cannot archive ${dir}: its parent directory ${path.dirname(dir)} is not writable ` +
					`(${err instanceof Error ? err.message : String(err)}) — the rename would fail there after other ` +
					"surfaces had already moved. Nothing was moved.",
			);
		}
		plan.push({ src: dir, dest: `${dir}.archive-${ts}` });
	}
	// Preflight EVERY destination before the first rename. Checking each one just
	// before its own move made a refusal destructive: with both dirs to archive, a
	// collision on the mailbox landed after the store had already been renamed —
	// a half-cut generation nobody asked for, reported as "nothing happened".
	const collisions = plan.filter(({ dest }) => archiveDestOccupied(dest));
	if (collisions.length > 0) {
		for (const { dest } of collisions) console.error(`ARCHIVE EXISTS: ${dest}`);
		console.error(
			`REFUSE: ${collisions.length} archive destination(s) above already exist — this generation's stamp is ` +
				"taken (a cut in the same second, or leftovers from an interrupted one). Nothing was moved: " +
				"wait a second and re-run, or move those directories aside first.",
		);
		return 1;
	}
	const archived: string[] = [];
	for (const { src, dest } of plan) {
		try {
			fs.renameSync(src, dest);
		} catch (err) {
			// The preflights above close the COMMON deterministic causes (collision,
			// unreadable surface, non-writable parent) — they do not close all of them: a
			// sticky-bit parent holding a foreign-owned entry, an immutable attribute, a
			// read-only mount or an LSM denial each pass a W_OK probe and fail here, and
			// the world can change under us besides. So this path is load-bearing, not a
			// formality. What must NOT happen is the report hiding what already moved: a
			// generic FAIL over a partial move reads as "nothing happened".
			console.error(
				`FAIL mid-cut: renaming ${src} → ${dest} failed (${err instanceof Error ? err.message : String(err)}).`,
			);
			if (archived.length === 0) {
				console.error("Nothing had been moved yet — this failure is a no-op; fix the cause and re-run.");
			} else {
				for (const done of archived) console.error(`archived so far: ${done}`);
				console.error(
					"This generation is HALF-CUT: the directories above are already archived while the failed one is " +
						"not. Fix the cause and re-run the same command — the re-run archives the remainder under its " +
						"own stamp — or inspect by hand.",
				);
			}
			return 1;
		}
		archived.push(dest);
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
