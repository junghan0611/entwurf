/**
 * smoke-entwurf-v2-matrix-live — the 5d-5 D4-b LIVE sentinel for the release-gate matrix.
 *
 * The deterministic sibling (check-entwurf-v2-matrix) drives the REAL decider over fakes with
 * ZERO IO — it fixes every (target kind → transport → lock) cell as a table. This LIVE sentinel
 * drives the REAL production `runEntwurfV2` deps against REAL OS objects on the substrate's
 * happy path, to catch what fakes cannot: a real `pi --entwurf-control` control socket + RPC,
 * a real lock acquire→release on disk, and a real mailbox enqueue. Negative/timeout/contention
 * paths stay in the deterministic gate (GPT Q2/Q4) — this is "substrate still works", not a
 * behavior suite.
 *
 * FOUR cells (GPT verdict — model-in-loop is OUT, this is a transport/lock/enqueue gate):
 *   C1 control-socket — a real `pi --entwurf-control` resident BIRTHS its own V3 record
 *      (#50 C2: the record mints the address; `--session-id` injection is gone), the smoke
 *      DISCOVERS that record and dispatches at its gardenId → decider routes
 *      fire-and-forget/live to control-socket → real RPC send → lock acquire→release ×1 →
 *      no lock garbage. This is the live birth→record→socket→dispatch chain in one cell.
 *   C1b record-less socket (#50 C4) — the same real resident, but its record is written to
 *      a HIDDEN store (a second temp dir): from the decider's store view the live socket is
 *      RECORD-LESS → EVERY intent is refused pre-probe as `record-less-socket` (the record
 *      is the sole address authority; a bare socket is a migration/diagnostic state, not an
 *      addressable citizen), the surface hint names the true cause + the M1 command, and no
 *      lock/RPC ever reaches the live socket.
 *   C2 meta-mailbox (deliverable) — a self-fetch citizen (claude-code) with an ARMED receiver
 *      marker → decider routes to meta-mailbox → a real `.msg` + signal is enqueued → lock-free
 *      path (no lock file) → no garbage beyond the one message.
 *   C3 meta-mailbox guard (undeliverable) — the SAME citizen kind but with NO armed receiver
 *      (a terminated self-fetch session) → deliverability guard rejects (mailbox-undeliverable)
 *      → NO `.msg` written (SE-2: no mailbox garbage for a dead receiver).
 *
 * Why programmatic, not model-in-loop (GPT Q2): "does the sender model actually call
 * the dispatch verb (entwurf_v2)" is a SEPARATE behavior concern. Folding it in here
 * would make a flaky model-tool-arg-variance failure indistinguishable from a bridge regression.
 * So C2/C3 drive the production enqueue path directly; only C1 needs a real pi process (to prove
 * the control socket + RPC are real, which fakes cannot).
 *
 * LIVE-only (spawns a real pi, opens a real socket) — kept OUT of `pnpm check`; honest skip when
 * LIVE!=1 (a release-gate that hard-fails without auth/model is unrunnable unattended). Model:
 *   ENTWURF_LIVE_TARGET   = "<provider>/<model>"  (default "openai-codex/gpt-5.4")
 *   (or split: ENTWURF_LIVE_PROVIDER + ENTWURF_LIVE_MODEL)
 *   LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live
 *
 * Automation seams (GPT Q1): the resident child + its socket are always reaped in `finally`; a
 * clean pass tears down the temp world while a failure PRESERVES it for post-mortem; fresh garden
 * ids + temp dirs (no fixed session id → repeatable); staged timeouts (boot/observe); on failure
 * a diagnostic block dumps the target id, socket/lock/mailbox paths, and the pi stderr tail.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SenderEnvelope } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import { lockPathFor } from "../pi-extensions/lib/entwurf-v2-lock.ts";
import { makeProductionEntwurfV2Deps } from "../pi-extensions/lib/entwurf-v2-production.ts";
import type { EntwurfV2RunResult } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { renderEntwurfV2Result } from "../pi-extensions/lib/entwurf-v2-surface.ts";
import {
	metaRecordExistsByGardenId,
	upsertMetaSession,
	writeMetaReceiverMarker,
} from "../pi-extensions/lib/meta-session.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import { waitForPiRecord } from "./lib/pi-record-discovery.ts";

// pi's control socket lives at the canonical dir keyed by session id — pi owns this path, so
// C1 must point the decider's controlSocketDir at the REAL dir (a fresh gid avoids collision).
const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";
// Release-gate topology: repo-under-test, not deployment smoke. Load only this
// checkout's extension so resident behavior is independent of global pi packages.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

// Staged timeouts (automation): short and per-stage so a stall is attributable.
const BOOT_TIMEOUT_MS = 30_000; // pi --entwurf-control socket appears
const POLL_MS = 100;

let passed = 0;
const artifacts: Record<string, string> = {};

function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function resolveTarget(): { provider: string; model: string } {
	const combined = process.env.ENTWURF_LIVE_TARGET?.trim();
	if (combined) {
		const slash = combined.indexOf("/");
		if (slash <= 0 || slash === combined.length - 1) {
			throw new Error(`ENTWURF_LIVE_TARGET must be "<provider>/<model>", got: ${JSON.stringify(combined)}`);
		}
		return { provider: combined.slice(0, slash), model: combined.slice(slash + 1) };
	}
	return {
		provider: process.env.ENTWURF_LIVE_PROVIDER?.trim() || "openai-codex",
		model: process.env.ENTWURF_LIVE_MODEL?.trim() || "gpt-5.4",
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocket(sockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(sockPath)) return true;
		await sleep(POLL_MS);
	}
	return false;
}

function smokeSender(gardenId: string, cwd: string): SenderEnvelope {
	return {
		sessionId: gardenId,
		agentId: "smoke/matrix-live",
		cwd,
		timestamp: new Date(0).toISOString(),
		origin: "pi-session",
		replyable: false,
	};
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log("[smoke-entwurf-v2-matrix-live] skipped — set LIVE=1 to run (spawns a real pi + opens a real socket).");
		return;
	}

	const { provider, model } = resolveTarget();
	console.log(`[smoke-entwurf-v2-matrix-live] target = ${provider}/${model}`);

	// ── temp world (repeatable: fresh dirs, no fixed ids) ────────────────────────
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "v2matrix-"));
	const sessionsDir = path.join(tmp, "sessions");
	const mailboxDir = path.join(tmp, "mailbox");
	const lockDir = path.join(tmp, "locks");
	const receiversDir = path.join(tmp, "receivers");
	for (const d of [sessionsDir, mailboxDir, lockDir, receiversDir]) await fsp.mkdir(d, { recursive: true });
	// The receiver marker is read through defaultMetaReceiversDir() (env-overridable); point it
	// (and the store/mailbox defaults, belt-and-suspenders to the opts dirs) at the temp world.
	process.env.ENTWURF_META_RECEIVERS_DIR = receiversDir;
	process.env.ENTWURF_META_SESSIONS_DIR = sessionsDir;
	process.env.ENTWURF_META_MAILBOX_DIR = mailboxDir;

	let resident: ChildProcess | null = null;
	let residentGid = "";
	let c1bGid = "";
	let stderrTail = "";
	let succeeded = false;

	const prodDeps = (sender: SenderEnvelope) =>
		makeProductionEntwurfV2Deps({
			senderProvider: () => sender,
			sessionsDir,
			mailboxDir,
			lockDir,
			controlSocketDir: REAL_CONTROL_DIR,
		});

	try {
		// ── C1: control-socket — real `pi --entwurf-control` resident ──────────────
		{
			// Post-C2 the resident IS the record writer: session_start births a V3
			// backend:"pi" citizen (into the env-isolated temp store this smoke exported)
			// and keys its socket on the RECORD gardenId. No `--session-id` injection —
			// that argv died with the cut — so the smoke discovers the address from the
			// record, exactly as a peer would.
			//
			// B1: drive the resident in `--mode rpc` with stdin held open (keepalive). A non-TTY
			// interactive `pi` (stdin ignored) can abort or silently exit; rpc mode is the control
			// substrate this cell actually probes (model UI is irrelevant here).
			resident = spawn(
				"pi",
				[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", provider, "--model", model, "--mode", "rpc"],
				{ cwd: tmp, stdio: ["pipe", "ignore", "pipe"], detached: false },
			);
			resident.stderr?.on("data", (b: Buffer) => {
				stderrTail = (stderrTail + b.toString()).slice(-2000);
			});

			const bornGid = await waitForPiRecord(sessionsDir, BOOT_TIMEOUT_MS);
			ok("C1 the resident BIRTHED its own V3 backend:pi record (the address authority)", bornGid !== null);
			residentGid = bornGid as string;
			const sockPath = path.join(REAL_CONTROL_DIR, `${residentGid}${SOCKET_SUFFIX}`);
			artifacts["C1.gid"] = residentGid;
			artifacts["C1.socket"] = sockPath;

			const up = await waitForSocket(sockPath, BOOT_TIMEOUT_MS);
			ok("C1 the control socket is keyed on the record gardenId (not pi's session id)", up);

			const result: EntwurfV2RunResult = await runEntwurfV2(
				{ target: residentGid, intent: "fire-and-forget", message: "matrix-live C1 control-socket probe" },
				prodDeps(smokeSender(residentGid, tmp)),
			);
			// R2: not just "executed/control-socket" — the final outcome must be a real `sent`
			// (an in-band reject or dead-fallback would also surface as control-socket otherwise).
			ok(
				"C1 alive pi citizen → control-socket RPC, outcome=sent",
				result.kind === "executed" &&
					result.transport === "control-socket" &&
					result.outcome.transport === "control-socket" &&
					result.outcome.outcome === "sent",
			);
			// in-domain control-socket send keeps then releases the lock → no lock file remains.
			ok("C1 lock released (no lock file left for the target)", !existsSync(lockPathFor(residentGid, lockDir)));

			if (resident) {
				await terminateChild(resident);
				resident = null;
			}
		}

		// ── C1b: #50 C4 — RECORD-LESS live pi control socket → pre-probe reject ─────
		// A live control socket whose owning record the decider's store CANNOT see. Post-C2
		// every resident births a record, so record-lessness is manufactured honestly: the
		// resident writes its record into a HIDDEN second store (env override on the child
		// only) while the decider keeps reading the main store. resolveTarget finds no record,
		// sees a live non-symlink control socket (presence hint) — and rejects EVERY intent
		// pre-probe as `record-less-socket`: the record is the sole address authority, so the
		// live socket is a migration/diagnostic state, never a delivery target. No lock is
		// taken and no RPC reaches the resident; the rendered hint names the cause + M1.
		{
			const hiddenStore = path.join(tmp, "sessions-c1b-hidden");
			await fsp.mkdir(hiddenStore, { recursive: true });

			resident = spawn(
				"pi",
				[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", provider, "--model", model, "--mode", "rpc"],
				{
					cwd: tmp,
					stdio: ["pipe", "ignore", "pipe"],
					detached: false,
					env: { ...process.env, ENTWURF_META_SESSIONS_DIR: hiddenStore },
				},
			);
			resident.stderr?.on("data", (b: Buffer) => {
				stderrTail = (stderrTail + b.toString()).slice(-2000);
			});

			const bornGid = await waitForPiRecord(hiddenStore, BOOT_TIMEOUT_MS);
			ok("C1b the resident birthed its record into the HIDDEN store", bornGid !== null);
			c1bGid = bornGid as string;
			const sockPath = path.join(REAL_CONTROL_DIR, `${c1bGid}${SOCKET_SUFFIX}`);
			artifacts["C1b.gid"] = c1bGid;
			artifacts["C1b.socket"] = sockPath;
			// The gap-closing precondition: from the DECIDER's store view this gid is record-less.
			ok(
				"C1b target has NO meta-record in the decider's store (record-less, the operator-greeted case)",
				!metaRecordExistsByGardenId(c1bGid, sessionsDir),
			);

			const up = await waitForSocket(sockPath, BOOT_TIMEOUT_MS);
			ok("C1b real record-less `pi --entwurf-control` stood up a control socket", up);

			for (const intent of ["fire-and-forget", "owned-outcome"] as const) {
				const result: EntwurfV2RunResult = await runEntwurfV2(
					{ target: c1bGid, intent, message: `matrix-live C1b record-less probe (${intent})` },
					prodDeps(smokeSender(c1bGid, tmp)),
				);
				ok(
					`C1b record-less LIVE socket + ${intent} → rejected record-less-socket (pre-probe, null liveness)`,
					result.kind === "rejected" &&
						result.receipt.reason === "record-less-socket" &&
						result.receipt.observedLiveness === null,
				);
				// Pre-probe reject ⇒ the per-gid lock was never taken (no lock file, not even a
				// released one's leftovers) — the live resident was never touched.
				ok(`C1b NO lock file for the record-less target (${intent})`, !existsSync(lockPathFor(c1bGid, lockDir)));
				// Observability (#50 F10 discipline): the rendered reject names the true cause
				// AND the M1 fix — never a bare reason code on this migration-shaped state.
				const rendered = renderEntwurfV2Result(result);
				ok(
					`C1b rendered reject names the record authority + M1 (${intent})`,
					rendered.isError &&
						rendered.text.includes("record-less-socket") &&
						rendered.text.includes("NO meta-record claims it") &&
						rendered.text.includes("meta-bridge-migrate-v3 migrate"),
				);
			}

			if (resident) {
				await terminateChild(resident);
				resident = null;
			}
		}

		// ── C2: meta-mailbox — deliverable self-fetch citizen (ARMED receiver) ──────
		{
			const minted = upsertMetaSession({
				input: { backend: "claude-code", nativeSessionId: `smoke-c2-${process.pid}`, cwd: tmp },
				dir: sessionsDir,
			});
			const gid = minted.record.gardenId;
			artifacts["C2.gid"] = gid;
			// armed = a presence marker owned by THIS (live) process → deliverable.
			writeMetaReceiverMarker({
				gardenId: gid,
				backend: "claude-code",
				nativeSessionId: minted.record.nativeSessionId,
				ownerPid: process.pid,
				armProvenance: "session-start",
				receiversDir,
			});

			const result: EntwurfV2RunResult = await runEntwurfV2(
				{ target: gid, intent: "fire-and-forget", message: "matrix-live C2 meta-mailbox probe" },
				prodDeps(smokeSender(gid, tmp)),
			);
			ok(
				"C2 decider routed an armed self-fetch citizen to meta-mailbox (executed)",
				result.kind === "executed" && result.transport === "meta-mailbox",
			);
			const boxDir = path.join(mailboxDir, gid);
			artifacts["C2.mailbox"] = boxDir;
			const msgs = await fsp.readdir(boxDir).catch(() => [] as string[]);
			// B4: enqueue is exactly one .msg AND the doorbell signal is poked.
			ok("C2 exactly one .msg enqueued to the target mailbox", msgs.filter((f) => f.endsWith(".msg")).length === 1);
			ok("C2 the doorbell inbox.signal was poked", existsSync(path.join(boxDir, "inbox.signal")));
			ok("C2 meta-mailbox is lock-free (no lock file)", !existsSync(lockPathFor(gid, lockDir)));
		}

		// ── C3: meta-mailbox guard — undeliverable (NO armed receiver) ──────────────
		{
			const minted = upsertMetaSession({
				input: { backend: "claude-code", nativeSessionId: `smoke-c3-${process.pid}`, cwd: tmp },
				dir: sessionsDir,
			});
			const gid = minted.record.gardenId;
			artifacts["C3.gid"] = gid;
			// NO receiver marker written → terminated self-fetch session → fail-closed.

			const result: EntwurfV2RunResult = await runEntwurfV2(
				{ target: gid, intent: "fire-and-forget", message: "matrix-live C3 should be refused" },
				prodDeps(smokeSender(gid, tmp)),
			);
			// B5: pin the reason — a different reject (bad-target, etc.) must not pass as "guard works".
			ok(
				"C3 deliverability guard rejected with reason=mailbox-undeliverable",
				result.kind === "rejected" && result.receipt.reason === "mailbox-undeliverable",
			);
			// B4: SE-2 reject contract = no enqueue AND no signal poke (mailbox fs untouched).
			const boxDir = path.join(mailboxDir, gid);
			const msgs = await fsp.readdir(boxDir).catch(() => [] as string[]);
			ok("C3 no .msg garbage left for the dead receiver (SE-2)", !msgs.some((f) => f.endsWith(".msg")));
			ok("C3 no inbox.signal poked for the dead receiver (SE-2)", !existsSync(path.join(boxDir, "inbox.signal")));
		}

		succeeded = true;
		console.log(`\nsmoke-entwurf-v2-matrix-live: ${passed} checks passed (real pi control socket + real mailbox)`);
	} catch (err) {
		console.error("\n[smoke-entwurf-v2-matrix-live] FAILED — diagnostic artifacts:");
		for (const [k, v] of Object.entries(artifacts)) console.error(`  ${k} = ${v}`);
		if (stderrTail) console.error(`  pi stderr (tail):\n${stderrTail.replace(/^/gm, "    ")}`);
		throw err;
	} finally {
		if (resident) {
			await terminateChild(resident).catch(() => {});
			resident = null;
		}
		// remove the real control sockets pi may have left under the fresh gids (C1, C1b)
		for (const gid of [residentGid, c1bGid]) {
			if (gid) {
				await fsp.rm(path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`), { force: true }).catch(() => {});
			}
		}
		// B6: keep the temp world on failure so the printed artifact paths are real for post-mortem
		// (CI/cron). Only a clean pass tears it down.
		if (succeeded) {
			await fsp.rm(tmp, { recursive: true, force: true });
		} else {
			console.error(`[smoke-entwurf-v2-matrix-live] temp world preserved for inspection: ${tmp}`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
