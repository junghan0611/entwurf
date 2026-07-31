/**
 * smoke-agy-native-push-live — the 봉인 8 LIVE acceptance gate for the native-push (agy /
 * Antigravity) delivery rail. It drives the PRODUCTION code path — the real antigravity
 * adapter (pgrep/ss/`agentapi get-conversation-metadata`+`send-message`), the register core,
 * and `runEntwurfV2` with production deps — against a REAL, already-running agy conversation,
 * and asserts the rail end to end: probe finds the volatile route, register create/re-attach is
 * idempotent, a fire-and-forget dispatches over native-push (delivered), an owned-outcome is
 * rejected (no resume authority), and a bogus conversation is rejected (probe-indeterminate).
 *
 * This automates what the GPT manual L1~L5 pass proved by hand (register create/attach, v2
 * native-push delivered ×2, owned reject, mailbox/marker/pi-domain non-intrusion) — same
 * production MCP surface, now a repeatable gate.
 *
 * STORE ISOLATION (페블-approved): only the agy CONVERSATION round-trip is real (that is the
 * LIVE essence). The meta-record register + v2 write to a TEMP store via the production
 * dir-resolution env (`ENTWURF_META_SESSIONS_DIR` → `defaultMetaSessionsDir()`) + explicit
 * `sessionsDir`/`mailboxDir`/`lockDir` opts — NO test-only fork in the register/decider code,
 * just the natural env/opt seam. The temp store is removed in `finally`, so no real-store
 * meta-record residue is ever left (this structurally closes NEXT ⑥'s "leftover meta-record"
 * class; the one pre-existing record 20260704T201811-071ba8 is a separate one-shot prune).
 *
 * REQUIRES `AGY_CONVERSATION_ID` — a live agy conversation the operator points at (the proven
 * L1~L5 path). Optional `AGY_BIN`, `AGY_SMOKE_CWD` (a scratch cwd to record; default a temp).
 *   LIVE=1 AGY_CONVERSATION_ID=<convId> ./run.sh smoke-agy-native-push-live
 * Honest SKIP when LIVE!=1 (touches a real agy → out of `pnpm check`).
 *
 * SEQUENCING: the doctor-static preflight runs FIRST — before ③ (agent-config drops the agy
 * mcp_config symlink so install-agy-bridge records the bare `entwurf-bridge`) the agy config
 * still points at a dangling path, so this smoke honestly FAILs at preflight. That is the gate:
 * the canonical run lands only after ③ wires the bridge. (The deterministic non-LIVE checks —
 * SKIP, typecheck, and an isolated preflight-FAIL via AGY_MCP_CONFIG — validate the scaffold now.)
 *
 * CANONICAL-GATED (deferred to the post-③ live run, marked honestly rather than faked here):
 *   - a smoke-OWNED agy launched via tmux + conversationId extraction (so `AGY_CONVERSATION_ID`
 *     could be optional) — v1 requires the operator's conversation instead of killing theirs;
 *   - the `native-push-target-dead` reject (needs the agy process ABSENT — i.e. a smoke-owned
 *     agy we may kill; v1 covers the sibling `native-push-probe-indeterminate` instead, which
 *     needs only a bogus conv while agy is alive);
 *   - full CONTENT receipt (that the delivered text is visible IN the conversation transcript) —
 *     v1 asserts delivery via the production send + a post-send liveness re-probe (D7 partial,
 *     matching DELIVERY.md's honest label); the manual tmux capture-pane observation stands as
 *     the D7 evidence until an `agentapi`-level transcript read is wired.
 */

import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SenderEnvelope } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import { makeProductionEntwurfV2Deps } from "../pi-extensions/lib/entwurf-v2-production.ts";
import type { EntwurfV2RunResult } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { runEntwurfV2 } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";
import { antigravityAdapter } from "../pi-extensions/lib/native-push/adapter.ts";
import { registerNativeConversation } from "../pi-extensions/lib/native-push/register.ts";
import { skipLive } from "./lib/live-skip.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const artifacts: Record<string, string> = {};

function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function smokeSender(gardenId: string, cwd: string): SenderEnvelope {
	return {
		sessionId: gardenId,
		agentId: "smoke/agy-native-push-live",
		cwd,
		timestamp: new Date(0).toISOString(),
		origin: "pi-session",
		replyable: false,
	};
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		skipLive(
			"smoke-agy-native-push-live",
			"set LIVE=1 (+ AGY_CONVERSATION_ID) to run (sends into a real agy conversation).",
		);
	}

	// ── doctor-static preflight (runs FIRST; a dangling agy config FAILs here — the ③ gate) ──
	// Uses the SAME env the operator set (AGY_MCP_CONFIG[_ALT] pin the candidates), so an
	// isolated dangling config reproduces the FAIL deterministically without touching real agy.
	const doctor = spawnSync("bash", [path.join(REPO_ROOT, "run.sh"), "doctor-agy-bridge"], {
		encoding: "utf8",
		env: process.env,
	});
	if (doctor.status !== 0) {
		console.error("[smoke-agy-native-push-live] doctor-static preflight FAILED — the agy bridge is not wired.");
		console.error("  This is expected before ③ (agent-config drops the mcp_config symlink so install-agy-bridge");
		console.error("  can record the bare `entwurf-bridge`). Wire it, then re-run. doctor output:");
		console.error((doctor.stdout ?? "").replace(/^/gm, "    "));
		console.error((doctor.stderr ?? "").replace(/^/gm, "    "));
		throw new Error("smoke-agy-native-push-live: doctor-static preflight FAILED (agy bridge not wired — see above).");
	}
	console.log("  ok    doctor-static preflight PASS (agy bridge wired)");
	passed++;

	const conversationId = process.env.AGY_CONVERSATION_ID?.trim();
	if (!conversationId) {
		throw new Error(
			"smoke-agy-native-push-live: AGY_CONVERSATION_ID is required — point it at a LIVE agy conversation " +
				"(open agy, take its conversationId). A smoke-owned agy launch is a canonical follow-up.",
		);
	}
	artifacts["conversationId"] = conversationId;

	// ── temp world: the meta-record store is isolated; only the agy round-trip is real ──
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "agy-np-"));
	const sessionsDir = path.join(tmp, "meta-sessions");
	const mailboxDir = path.join(tmp, "mailbox");
	const lockDir = path.join(tmp, "locks");
	const controlDir = path.join(tmp, "control"); // native-push never touches it; kept off the real dir for hygiene
	for (const d of [sessionsDir, mailboxDir, lockDir, controlDir]) await fsp.mkdir(d, { recursive: true });
	process.env.ENTWURF_META_SESSIONS_DIR = sessionsDir;
	process.env.ENTWURF_META_MAILBOX_DIR = mailboxDir;
	const recordCwd = process.env.AGY_SMOKE_CWD?.trim() || tmp;
	let succeeded = false;

	try {
		// ── 1. probe the REAL conversation directly (route diagnostics; proves the live host) ──
		const probe = await antigravityAdapter.probe(conversationId);
		if (probe.status === "alive") {
			artifacts["route"] = probe.route.lsAddress;
			console.log(`  ..    probe: alive via ${probe.route.lsAddress}`);
		} else {
			artifacts["probe"] = `${probe.status}: ${probe.reason}`;
		}
		ok("probe finds the conversation LIVE (agy host + LS port serve it)", probe.status === "alive");

		// ── 2. register create → gardenId; re-register → attach the SAME gardenId (idempotent) ──
		const reg1 = await registerNativeConversation(
			{ backend: "antigravity", nativeSessionId: conversationId, cwd: recordCwd },
			{ sessionsDir },
		);
		artifacts["gardenId"] = reg1.gardenId;
		ok("register create: new garden citizen minted", reg1.action === "create");
		ok("register create: backend is antigravity", reg1.backend === "antigravity");
		const reg2 = await registerNativeConversation(
			{ backend: "antigravity", nativeSessionId: conversationId, cwd: recordCwd },
			{ sessionsDir },
		);
		ok("re-register: attaches (does not duplicate)", reg2.action === "attach");
		ok("re-register: same gardenId (idempotent identity)", reg2.gardenId === reg1.gardenId);

		// ── production v2 deps: the REAL native-push adapter drives decide-probe AND executor send ──
		const prodDeps = makeProductionEntwurfV2Deps({
			senderProvider: () => smokeSender(reg1.gardenId, recordCwd),
			sessionsDir,
			mailboxDir,
			lockDir,
			controlSocketDir: controlDir,
		});

		// ── 3. fire-and-forget → native-push delivered (production send into the live conv) ──
		const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`;
		artifacts["nonce"] = nonce;
		const fire: EntwurfV2RunResult = await runEntwurfV2(
			{
				target: reg1.gardenId,
				intent: "fire-and-forget",
				message: `[entwurf smoke-agy-native-push-live] delivery probe ${nonce} — no reply needed.`,
			},
			prodDeps,
		);
		ok(
			"fire-and-forget executed over native-push (delivered)",
			fire.kind === "executed" && fire.transport === "native-push",
		);
		if (fire.kind === "executed" && fire.outcome.transport === "native-push") {
			ok(
				"native-push delivery is lock-free/first-try (retried flag present)",
				typeof fire.outcome.retried === "boolean",
			);
		}

		// ── 4. receipt (D7 partial): re-probe shows the target still reachable post-send ──
		// Full CONTENT receipt (the text visible in the transcript) is the canonical follow-up —
		// here we assert the delivery target stayed live through the send, matching DELIVERY.md's
		// honest D7-partial label (the manual capture-pane observation is the standing D7 evidence).
		const post = await antigravityAdapter.probe(conversationId);
		ok("post-send re-probe still alive (delivery target reachable, D7 partial)", post.status === "alive");

		// ── 5. owned-outcome → rejected: a native-push backend has no resume authority ──
		const owned: EntwurfV2RunResult = await runEntwurfV2(
			{ target: reg1.gardenId, intent: "owned-outcome", message: "should be rejected" },
			prodDeps,
		);
		ok(
			"owned-outcome rejected as native-push-no-resume-authority",
			owned.kind === "rejected" && owned.receipt.reason === "native-push-no-resume-authority",
		);
		ok(
			"owned reject stamped observedLiveness (post-probe, non-null)",
			owned.kind === "rejected" && owned.receipt.observedLiveness !== null,
		);

		// ── 6. bogus conversation → rejected native-push-probe-indeterminate ──
		// agy is alive but no LS port serves this fabricated conv id → INDETERMINATE (never coerced
		// to dead). A meta-record is upserted DIRECTLY (register would refuse a non-live probe), so
		// the decider/executor still run the production path over a real (indeterminate) probe.
		const bogusConv = `entwurf-smoke-bogus-${nonce}`;
		const bogus = upsertMetaSession({
			input: { backend: "antigravity", nativeSessionId: bogusConv, cwd: recordCwd, model: null, transcriptPath: null },
			dir: sessionsDir,
		});
		const indeterminate: EntwurfV2RunResult = await runEntwurfV2(
			{ target: bogus.record.gardenId, intent: "fire-and-forget", message: "into the void" },
			prodDeps,
		);
		ok(
			"bogus-conv fire rejected as native-push-probe-indeterminate (agy live, no port serves it)",
			indeterminate.kind === "rejected" && indeterminate.receipt.reason === "native-push-probe-indeterminate",
		);
		ok(
			"indeterminate reject stamped observedLiveness=indeterminate",
			indeterminate.kind === "rejected" && indeterminate.receipt.observedLiveness === "indeterminate",
		);

		succeeded = true;
		console.log(`\nsmoke-agy-native-push-live: ${passed} checks passed (real agy round-trip; isolated meta-store)`);
	} catch (err) {
		console.error("\n[smoke-agy-native-push-live] FAILED — diagnostic artifacts:");
		for (const [k, v] of Object.entries(artifacts)) console.error(`  ${k} = ${v}`);
		throw err;
	} finally {
		// Remove the ENTIRE temp meta-store — no real-store residue (NEXT ⑥ structural close).
		await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
		if (!succeeded) console.error(`[smoke-agy-native-push-live] (temp store ${tmp} removed)`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
