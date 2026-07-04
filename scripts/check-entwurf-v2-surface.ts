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
 *      decorates the sender as `origin:"pi-session"` with HONEST replyability (SE-1 2e-a:
 *      computeSelfAddressability + socket existsSync, not a hardcoded `replyable:true`).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EntwurfV2RunResult } from "../pi-extensions/lib/entwurf-v2-runner.ts";
import {
	actionableRejectHint,
	ENTWURF_PREFIX_ROOTS_ENV,
	parseEntwurfPrefixRootsEnv,
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
const MCP_SRC = path.join(REPO, "mcp/entwurf-bridge/src/index.ts");

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

		// native-push → delivered (no retry)
		const np: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "native-push" },
			transport: "native-push",
			outcome: { transport: "native-push", success: true, retried: false },
		};
		ok(
			"2: native-push → not error + delivered",
			!renderEntwurfV2Result(np).isError && renderEntwurfV2Result(np).text.includes("delivered"),
		);

		// native-push delivered after a 1-shot re-probe retry → retry note surfaced
		const npRetried: EntwurfV2RunResult = {
			kind: "executed",
			receipt: { ...SUCCESS_RECEIPT, transport: "native-push" },
			transport: "native-push",
			outcome: { transport: "native-push", success: true, retried: true },
		};
		ok(
			"2: native-push retried → not error + retry note surfaced",
			!renderEntwurfV2Result(npRetried).isError && renderEntwurfV2Result(npRetried).text.includes("retry"),
		);

		// native-push owned reject → hint to switch to fire-and-forget
		const npReject: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "native-push-no-resume-authority", observedLiveness: "alive" },
		};
		const npRej = renderEntwurfV2Result(npReject);
		ok(
			"2: native-push-no-resume-authority → isError + fire-and-forget hint",
			npRej.isError && npRej.text.includes("fire-and-forget"),
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

		// Detour B (B-a): backend-liveness-unsupported reject → still a reject (isError),
		// but the text carries the actionable "use fire-and-forget → mailbox" hint. The
		// reject stays honest (reason unchanged, no auto-convert) — only the render guides.
		const metaReject: EntwurfV2RunResult = {
			kind: "rejected",
			receipt: { ok: false, reason: "backend-liveness-unsupported", observedLiveness: "unsupported" },
		};
		const mr = renderEntwurfV2Result(metaReject);
		ok(
			"2: backend-liveness-unsupported reject → isError + actionable fire-and-forget/mailbox hint",
			mr.isError &&
				mr.text.includes("backend-liveness-unsupported") &&
				mr.text.includes("fire-and-forget") &&
				mr.text.includes("mailbox"),
		);
		ok(
			"2B: actionableRejectHint guides meta-session owned → fire-and-forget mailbox",
			(actionableRejectHint("backend-liveness-unsupported") ?? "").includes("fire-and-forget"),
		);
		ok(
			"2B: actionableRejectHint guides owned-live → fire-and-forget",
			(actionableRejectHint("owned-live-no-autosend") ?? "").includes("fire-and-forget"),
		);
		ok(
			"2B: actionableRejectHint returns undefined for a reject with no next step",
			actionableRejectHint("bad-target") === undefined,
		);
	}

	// ── 6: parseEntwurfPrefixRootsEnv (5d-4b operator-policy SSOT) ─────────────
	{
		const D = path.delimiter;
		ok("6: env name is ENTWURF_PREFIX_ROOTS", ENTWURF_PREFIX_ROOTS_ENV === "ENTWURF_PREFIX_ROOTS");
		ok("6: undefined → [] (no prefix promotion)", parseEntwurfPrefixRootsEnv(undefined).length === 0);
		ok("6: empty string → []", parseEntwurfPrefixRootsEnv("").length === 0);
		ok("6: delimiters-only → []", parseEntwurfPrefixRootsEnv(`${D}${D}`).length === 0);
		const two = parseEntwurfPrefixRootsEnv(`/repos/gh${D}/repos/work`);
		ok("6: delimiter-separated → entries", two.length === 2 && two[0] === "/repos/gh" && two[1] === "/repos/work");
		const trimmed = parseEntwurfPrefixRootsEnv(`  /a ${D} ${D} /b  `);
		ok("6: trims + drops empty segments", trimmed.length === 2 && trimmed[0] === "/a" && trimmed[1] === "/b");
		// A nonexistent/typo path is KEPT verbatim (no throw, no validation) — preflight's
		// normalize handles it, and a typo must never broaden approve nor fail the dispatch.
		const typo = parseEntwurfPrefixRootsEnv("/this/does/not/exist");
		ok("6: nonexistent path kept verbatim (no throw)", typo.length === 1 && typo[0] === "/this/does/not/exist");
	}

	// ── 3: surface source guard — ctx-free ────────────────────────────────────
	{
		const src = await fs.readFile(SURFACE_SRC, "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok("3: surface is ctx-free — no ExtensionContext", !code.includes("ExtensionContext"));
		ok("3: surface is ctx-free — no ExtensionAPI", !code.includes("ExtensionAPI"));
	}

	// ── 4: pi-native control wiring guard ─────────────────────────────────────
	{
		const src = await fs.readFile(CONTROL_SRC, "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		ok("4: pi-native — entwurf-control registers entwurf_v2", /name:\s*"entwurf_v2"/.test(src));
		ok(
			"4: pi-native — reaches the fence via a NON-LITERAL dynamic import (string-const specifier)",
			/const ENTWURF_V2_SURFACE_MODULE\s*=/.test(code) && /await import\(ENTWURF_V2_SURFACE_MODULE\)/.test(code),
		);
		// The whole point of the dynamic import: NO static import of the fence v2 chain into the
		// emit-capable root program (those literal `.ts` imports would be TS5097).
		ok(
			"4: pi-native — NO static import of the v2 fence (runner/production/surface) — TS5097 stays closed",
			!/import[^;]*from\s*"\.\/lib\/entwurf-v2-(runner|production|surface)\.(js|ts)"/.test(code),
		);
		// SE-1 2e-a: senderProvider decorates origin:'pi-session' but `replyable` is now an
		// HONEST fact (canonical socket existsSync via computeSelfAddressability), NOT a
		// hardcoded true. The self-address fence lib is reached through the same non-literal
		// dynamic import pattern as the v2 surface.
		ok(
			"4: pi-native — senderProvider decorates origin:'pi-session' (no hardcoded replyable:true)",
			/origin:\s*"pi-session"/.test(code) && !/replyable:\s*true/.test(code),
		);
		ok(
			"4: pi-native — replyability via computeSelfAddressability + existsSync, dynamic-imported",
			/const ENTWURF_SELF_ADDRESS_MODULE\s*=/.test(code) &&
				/await import\(ENTWURF_SELF_ADDRESS_MODULE\)/.test(code) &&
				/computeSelfAddressability/.test(code) &&
				/existsSync\(/.test(code),
		);
		ok(
			"4: pi-native — NO static import of the self-address fence (TS5097 stays closed)",
			!/import[^;]*from\s*"\.\/lib\/entwurf-self-address\.(js|ts)"/.test(code),
		);
		// Caller-intent steer (live-peer owned-outcome bug): the description must tell the model
		// to use fire-and-forget for a LIVE/alive peer and that owned-outcome is dormant-only and
		// NEVER auto-converted — the preventive fix (the decider must not auto-convert).
		ok(
			"4: pi-native — description steers live/alive peer → fire-and-forget",
			/liveness=alive/.test(src) && /fire-and-forget/.test(src),
		);
		ok(
			"4: pi-native — description says owned-outcome is dormant-only + never auto-converted",
			/owned-outcome is ONLY for waking a DORMANT pi/.test(src) && /NEVER auto-converted/.test(src),
		);
	}

	// ── 5: MCP bridge wiring guard ────────────────────────────────────────────
	// The MCP bridge is a `.ts`-import fence consumer (mcp/tsconfig allowImportingTsExtensions),
	// so it STATICALLY imports the surface adapter (no dynamic import). The v2 handler runs the
	// production runner IN-PROCESS via runAndRenderEntwurfV2FromSurface — it does NOT route the
	// v2 dispatch through legacy rpcCall/enqueueMetaMessage (those stay as the v2 runner's transport primitives).
	{
		const src = await fs.readFile(MCP_SRC, "utf8");
		ok("5: MCP — registers entwurf_v2 server.tool", /server\.tool\(\s*"entwurf_v2"/.test(src));
		ok(
			"5: MCP — static imports runAndRenderEntwurfV2FromSurface from the surface fence module",
			/import\s*\{[^}]*runAndRenderEntwurfV2FromSurface[^}]*\}\s*from\s*"[^"]*entwurf-v2-surface\.ts"/.test(src),
		);
		// Isolate the entwurf_v2 server.tool(...) block: from its name literal to the NEXT
		// server.tool( registration. The v2 handler must build the sender + call the surface
		// adapter, and must NOT itself reach for a legacy transport (the decider routes).
		const v2Start = src.indexOf('"entwurf_v2"');
		const after = src.indexOf("server.tool(", v2Start + 1);
		const v2Block = src.slice(v2Start, after === -1 ? undefined : after);
		ok("5: MCP — v2 handler builds buildSendSenderEnvelope()", /buildSendSenderEnvelope\(\)/.test(v2Block));
		ok("5: MCP — v2 handler passes senderProvider: () => sender", /senderProvider:\s*\(\)\s*=>\s*sender/.test(v2Block));
		ok(
			"5: MCP — v2 handler calls runAndRenderEntwurfV2FromSurface",
			/runAndRenderEntwurfV2FromSurface\(/.test(v2Block),
		);
		ok(
			"5: MCP — v2 handler routes through the runner, NOT legacy rpcCall/enqueueMetaMessage",
			!/\brpcCall\(/.test(v2Block) && !/\benqueueMetaMessage\(/.test(v2Block),
		);
		// Caller-intent steer — same preventive guidance on the MCP surface (a sibling reaching
		// in over MCP reads this description, not the pi-native one).
		ok(
			"5: MCP — description steers live/alive peer → fire-and-forget",
			/liveness=alive/.test(src) && /fire-and-forget/.test(src),
		);
		ok(
			"5: MCP — description says owned-outcome is dormant-only + never auto-converted",
			/owned-outcome is ONLY for waking a DORMANT pi/.test(src) && /NEVER auto-converted/.test(src),
		);
	}

	console.log(`\ncheck-entwurf-v2-surface: ${passed} checks passed`);
}

await main();
