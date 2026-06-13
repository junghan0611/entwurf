/**
 * check-entwurf-v2-surface — deterministic gate for the 5d-3a surface adapter
 * (`entwurf-v2-surface.ts`) + the `entwurf-control.ts` wiring contract. It proves the PURE
 * parts (the rest — production assembly — is check-entwurf-v2-production + the 5d-5 matrix):
 *
 *   1. toDispatchInput — `wants_reply`→`wantsReply` (snake→camel), `intent`/`message`/`target`
 *      pass through, absent `mode`/`wants_reply` stay undefined (decider defaults, no double).
 *   2. renderEntwurfV2Result — each result kind → the right `{ text, isError }`, surfacing the
 *      carry-overs: reject reason + target-locked diagnostic / control N3 rejectReason /
 *      spawn lock-retained diagnostic / N1 delivered-but-lock-dirty.
 *   3. surface source guard — `entwurf-v2-surface.ts` is ctx-free (no ExtensionContext/API).
 *   4. control wiring guard — `entwurf-control.ts` registers `entwurf_v2`, reaches the fence
 *      ONLY via a NON-LITERAL dynamic import (a string-const specifier), NEVER a static import
 *      of the fence v2 modules (which would break the emit-capable root tsc with TS5097), and
 *      decorates the sender as `origin:"pi-session"` + `replyable:true`.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EntwurfV2RunResult } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import {
	renderEntwurfV2Result,
	type SurfaceEntwurfV2Params,
	toDispatchInput,
} from "../pi-extensions/lib/entwurf-v2-surface.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const SURFACE_SRC = path.join(REPO, "pi-extensions/lib/entwurf-v2-surface.ts");
const CONTROL_SRC = path.join(REPO, "pi-extensions/entwurf-control.ts");

const GID = "20260613T100000-aaaaaa";
const SUCCESS_RECEIPT = {
	ok: true as const,
	action: "send" as const,
	transport: "control-socket" as const,
	ownership: "ack-only" as const,
	observedLiveness: "alive" as const,
};

async function main(): Promise<void> {
	// ── 1: toDispatchInput mapping ────────────────────────────────────────────
	{
		const full: SurfaceEntwurfV2Params = {
			target: GID,
			intent: "owned-outcome",
			message: "hi",
			mode: "steer",
			wants_reply: true,
		};
		const di = toDispatchInput(full);
		ok(
			"1: target/intent/message pass through",
			di.target === GID && di.intent === "owned-outcome" && di.message === "hi",
		);
		ok("1: wants_reply → wantsReply (snake→camel)", di.wantsReply === true);
		ok("1: mode passes through", di.mode === "steer");

		const minimal: SurfaceEntwurfV2Params = { target: GID, intent: "fire-and-forget", message: "m" };
		const dm = toDispatchInput(minimal);
		ok("1: absent mode stays undefined (decider default)", dm.mode === undefined);
		ok("1: absent wants_reply stays undefined (no double default)", dm.wantsReply === undefined);
	}

	// ── 2: renderEntwurfV2Result per kind ─────────────────────────────────────
	{
		// reject + target-locked diagnostic
		const rejected: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "target-locked", observedLiveness: null },
			diagnostic: {
				kind: "target-locked",
				conflict: {
					reason: "target-locked",
					lockPath: "/locks/x.lock",
					holder: {
						gardenId: GID,
						pid: 999,
						hostname: "h",
						createdAt: "2026-06-13T01:00:00.000Z",
						nonce: "n",
						owner: "entwurf_v2",
						lockPath: "/locks/x.lock",
					},
					detail: "held by pid 999",
				},
			},
		};
		const rr = renderEntwurfV2Result(rejected);
		ok(
			"2: reject → isError + reason + diagnostic surfaced",
			rr.isError && rr.text.includes("target-locked") && rr.text.includes("pid 999"),
		);

		// control sent → delivered
		const sent: EntwurfV2RunResult = {
			kind: "executed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			outcome: { transport: "control-socket", outcome: "sent" },
		};
		ok(
			"2: control sent → not error",
			!renderEntwurfV2Result(sent).isError && renderEntwurfV2Result(sent).text.includes("sent"),
		);

		// control in-band rejected with N3 rejectReason → non-delivery
		const ctlReject: EntwurfV2RunResult = {
			kind: "executed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			outcome: { transport: "control-socket", outcome: "rejected", rejectReason: "dormant-fire-forget-unsupported" },
		};
		const cr = renderEntwurfV2Result(ctlReject);
		ok(
			"2: control rejected → isError + N3 rejectReason surfaced",
			cr.isError && cr.text.includes("dormant-fire-forget-unsupported"),
		);

		// spawn lock-retained → fail-closed diagnostic
		const retained: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "spawn-bg" },
			transport: "spawn-bg",
			outcome: {
				transport: "spawn-bg",
				result: {
					kind: "lock-retained",
					released: false,
					reason: "observe-failed",
					diagnostic: {
						targetGardenId: GID,
						lockPath: "/locks/x.lock",
						expectedSocketPath: "/ctl/x.sock",
						observeTimeoutMs: 30000,
						killGraceMs: 5000,
					},
				},
			},
		};
		const ret = renderEntwurfV2Result(retained);
		ok(
			"2: spawn lock-retained → isError + diagnostic surfaced",
			ret.isError && ret.text.includes("LOCK RETAINED") && ret.text.includes("/locks/x.lock"),
		);

		// spawn socket-alive → delivered
		const alive: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "spawn-bg" },
			transport: "spawn-bg",
			outcome: { transport: "spawn-bg", result: { kind: "socket-alive", released: true, pid: 7 } },
		};
		ok("2: spawn socket-alive → not error", !renderEntwurfV2Result(alive).isError);

		// meta-mailbox → enqueued
		const mailbox: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "meta-mailbox" },
			transport: "meta-mailbox",
			outcome: { transport: "meta-mailbox", success: true },
		};
		ok(
			"2: meta-mailbox → not error + enqueued",
			!renderEntwurfV2Result(mailbox).isError && renderEntwurfV2Result(mailbox).text.includes("enqueued"),
		);

		// N1: execution-failed with finalizedOutcome + releaseFailed → delivered-but-dirty
		const n1: EntwurfV2RunResult = {
			kind: "execution-failed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			error: "release boom",
			finalizedOutcome: "sent",
			releaseFailed: true,
			retrySafe: false,
		};
		const n1r = renderEntwurfV2Result(n1);
		ok(
			"2: N1 → isError + 'do NOT retry' + DIRTY surfaced",
			n1r.isError && n1r.text.includes("DIRTY") && n1r.text.includes("do NOT retry"),
		);

		// plain execution-failed → error
		const failed: EntwurfV2RunResult = {
			kind: "execution-failed",
			receipt: SUCCESS_RECEIPT,
			transport: "control-socket",
			error: "boom",
			retrySafe: false,
		};
		ok("2: plain execution-failed → isError", renderEntwurfV2Result(failed).isError);
	}

	// ── 3: surface source guard — ctx-free ────────────────────────────────────
	{
		const src = await fs.readFile(SURFACE_SRC, "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok("3: surface is ctx-free — no ExtensionContext", !code.includes("ExtensionContext"));
		ok("3: surface is ctx-free — no ExtensionAPI", !code.includes("ExtensionAPI"));
	}

	// ── 4: control wiring guard ───────────────────────────────────────────────
	{
		const src = await fs.readFile(CONTROL_SRC, "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok("4: entwurf-control registers entwurf_v2", /name:\s*"entwurf_v2"/.test(src));
		ok(
			"4: reaches the fence via a NON-LITERAL dynamic import (string-const specifier)",
			/const ENTWURF_V2_SURFACE_MODULE\s*=/.test(code) && /await import\(ENTWURF_V2_SURFACE_MODULE\)/.test(code),
		);
		// The whole point of the dynamic import: NO static import of the fence v2 chain into the
		// emit-capable root program (those literal `.ts` imports would be TS5097).
		ok(
			"4: NO static import of the v2 fence (runner/production/surface) — TS5097 stays closed",
			!/import[^;]*from\s*"\.\/lib\/entwurf-v2-(runner|production|surface)\.(js|ts)"/.test(code),
		);
		ok(
			"4: senderProvider decorates origin:'pi-session' + replyable:true",
			/origin:\s*"pi-session"/.test(code) && /replyable:\s*true/.test(code),
		);
	}

	console.log(`\ncheck-entwurf-v2-surface: ${passed} checks passed`);
}

await main();
