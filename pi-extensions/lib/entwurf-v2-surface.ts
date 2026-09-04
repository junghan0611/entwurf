/**
 * entwurf-v2-surface — 5d-3a: the ctx-free SURFACE adapter that joins a surface's raw params
 * to `runEntwurfV2` and renders the outcome-rich result back to a human/tool string. It is the
 * ONE place a surface (pi-native `entwurf_v2` tool now; the MCP `entwurf_v2` verb in 5d-3b)
 * crosses into the v2 fence — so `entwurf-control.ts` (a root-tsc, emit-capable surface that
 * CANNOT statically import the `.ts`-extension fence without TS5097) reaches this via a
 * NON-LITERAL dynamic import, and the MCP bridge (already a `.ts`-import consumer) imports it
 * directly. Either way the ctx binding stays OUT of the fence: the caller builds
 * `senderProvider` from its own envelope source and passes it in `opts`.
 *
 * Three exports:
 *   - `toDispatchInput` — surface params → `DispatchInput` (the `wants_reply`→`wantsReply`
 *     snake→camel bridge; `intent` is REQUIRED and passed through verbatim, never inferred
 *     from mode/action — that would blur the F1 ownership contract).
 *   - `renderEntwurfV2Result` — the result union → `{ text, isError }`, surfacing the carry-overs
 *     the surface must NOT drop: a reject's reason+diagnostic, a control `rejectReason` (N3), a
 *     and the N1 delivered+lock-dirty `execution-failed`.
 *   - `runAndRenderEntwurfV2FromSurface` — assemble production deps + run + render, so the root
 *     surface never needs to name the `EntwurfV2RunResult` union (it only sees `{text,isError}`).
 */

import { basename } from "node:path";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { DispatchInput, EntwurfV2Mode } from "./entwurf-v2-decider.ts";
import { makeProductionEntwurfV2Deps, type ProductionEntwurfV2Opts } from "./entwurf-v2-production.ts";
import { type EntwurfV2RunResult, runEntwurfV2 } from "./entwurf-v2-runner.ts";
import { FRESH_CUT_PRESCRIPTION } from "./meta-session.ts";

/** The raw shape a surface (pi tool / MCP verb) collects. `wants_reply` is snake_case to
 * match the external `entwurf_v2` convention; the runner sees `wantsReply`. */
export interface SurfaceEntwurfV2Params {
	target: string;
	intent: "fire-and-forget";
	mode?: EntwurfV2Mode;
	wants_reply?: boolean;
	message: string;
}

/** ctx-free run options. The caller (entwurf-control.ts / MCP bridge) builds `senderProvider`
 * from its own envelope source — this module never touches `ExtensionContext`. It is one
 * field: the trust-preflight inputs (`agentDir`/`prefixRoots`, and the `ENTWURF_PREFIX_ROOTS`
 * env SSOT behind them) went with the resume verdict they existed to guard. */
export interface EntwurfV2SurfaceRunOptions {
	senderProvider: () => SenderEnvelope | undefined;
}

/** What the surface renders: the human/tool text + whether it is an error (a non-delivery). */
export interface EntwurfV2SurfaceRendered {
	text: string;
	isError: boolean;
}

/** Surface params → the runner's `DispatchInput`. `wants_reply`→`wantsReply`; `intent` and
 * `message` pass through; `mode`/`wantsReply` are left undefined when absent so the decider's
 * own defaults (follow_up / false) apply — no double-default. */
export function toDispatchInput(params: SurfaceEntwurfV2Params): DispatchInput {
	return {
		target: params.target,
		intent: params.intent,
		message: params.message,
		mode: params.mode,
		wantsReply: params.wants_reply,
	};
}

/**
 * Detour B (B-a) — actionable rendering of an honest reject. The decider is UNCHANGED:
 * a reject stays a reject (Hard Rule 3). This only appends a one-line "what to do instead"
 * to the reject TEXT, so an honest reject stops reading as "delivery impossible". Returns
 * undefined for rejects with no useful next step.
 */
export function actionableRejectHint(reason: string): string | undefined {
	switch (reason) {
		case "dormant-fire-forget-unsupported":
			// The cell that carries the whole cost of the visible-first cut. Naming the real
			// state — the citizen exists and is not running — matters more than ever now that
			// there is no verb behind it: a caller that reads "reject" as "wrong id" goes
			// looking in the wrong place.
			return (
				"this citizen's record is intact but its session is not running, and delivery has no way to wake it. " +
				"The resume that used to answer here launched a hidden background child and was withdrawn under the " +
				"visible-first rule; the visible same-id resume is the separate lifecycle verb entwurf_resume_call. " +
				"Reopen the citizen with entwurf_resume_call {target} (pi targets only; it runs no turn), then dispatch again."
			);
		case "indeterminate-no-spawn":
			// The socket probe did not settle, so liveness is UNKNOWN — an unestablished probe
			// is not a measured death, and dispatching into it could double-deliver. Say
			// "the PROBE was inconclusive", never "the socket answered inconclusively":
			// `indeterminate` also covers a probe that got no answer at all, was refused by
			// permissions, or timed out, and "answered" claims a reply that may never have
			// existed. The wire id is FROZEN and still spells "-no-spawn"; it names the rule
			// (never dispatch into an indeterminate target), not a capability that still
			// exists. So the hint's job is to say plainly what did NOT happen: nothing
			// delivered, nothing started.
			return (
				"the control-socket probe was inconclusive, so the target's liveness is UNKNOWN — this is not a " +
				"measured death. NOTHING was delivered and NO process was started (the reason id keeps its frozen " +
				"'-no-spawn' wire spelling from an era when one could be; entwurf_v2 starts nothing on any rail). " +
				"Re-run entwurf_peers to re-probe; if it stays indeterminate, check for a stale socket file left at " +
				"that garden id by a session that died without cleaning up."
			);
		case "native-push-target-dead":
			// The adapter probe found no live host process for the conversation.
			return "native-push conversation is not live (no host process found). Re-open the conversation, then retry — there is nothing to inject into.";
		case "native-push-probe-indeterminate":
			// Host up, but no LS port served the conversation — inconclusive, not a hard dead.
			return "native-push host is up but no port served this conversation (probe inconclusive). Retry once the conversation is loaded, or verify the conversation id.";
		case "record-less-socket":
			// #50 C4: name the true cause AND the fix — a bare socket is a diagnostic
			// state, not an addressable citizen (the record is the address).
			return (
				"a control socket exists at this garden id but NO meta-record claims it — the record is the " +
				"sole address authority, so a bare socket is not an addressable citizen. If a pre-record-era " +
				"resident owns that socket, restart it under the current runtime (session_start births its " +
				`record); if the store predates the current generation, quiesce and archive it with ` +
				`${FRESH_CUT_PRESCRIPTION}. A stale/forged socket should be removed.`
			);
		default:
			return undefined;
	}
}

/** Render the outcome-rich result to `{ text, isError }`. A reject or a thrown/failed/dirty
 * delivery is `isError:true`; a sent/fallback-sent/enqueued/observed delivery is `isError:false`.
 * A control in-band `rejected` is a non-delivery (isError:true) and carries N3 `rejectReason`
 * when present. */
export function renderEntwurfV2Result(result: EntwurfV2RunResult): EntwurfV2SurfaceRendered {
	switch (result.kind) {
		case "rejected": {
			const r = result.receipt;
			let text = `entwurf_v2 rejected: ${r.reason} (observed liveness: ${r.observedLiveness ?? "n/a"})`;
			const hint = actionableRejectHint(r.reason);
			if (hint) text += `\n  → ${hint}`;
			if (result.diagnostic?.kind === "target-locked") {
				const c = result.diagnostic.conflict;
				text +=
					`\n  target-locked: ${c.lockPath}` +
					`\n  ${c.detail}` +
					(c.holder ? `\n  holder: pid ${c.holder.pid} on ${c.holder.hostname} since ${c.holder.createdAt}` : "");
			}
			// #101 갭 C: name WHICH receiver axis failed. "mailbox-undeliverable" alone sent a
			// caller looking for a dead session when the session was alive and had simply
			// switched to another garden — the predicate knew that and the surface threw it away.
			if (result.diagnostic?.kind === "mailbox-undeliverable") {
				text += `\n  mailbox-undeliverable: ${result.diagnostic.reason}`;
			}
			return { text, isError: true };
		}
		case "executed": {
			const o = result.outcome;
			if (o.transport === "control-socket") {
				const delivered = o.outcome === "sent" || o.outcome === "fallback-sent";
				const reason = o.rejectReason ? ` (reason: ${o.rejectReason})` : "";
				// #98 R, fallback leg: a dead socket that re-resolved to the mailbox wrote a
				// `.msg` — name it, exactly as the primary mailbox rail does. Absent on a
				// socket-to-socket retry (no file) and on every non-mailbox outcome, so the
				// line degrades to the bare outcome rather than printing "undefined".
				const enqueued = o.messagePath ? ` (enqueued ${basename(o.messagePath)})` : "";
				return {
					text: `entwurf_v2 control-socket → ${o.outcome}${reason}${enqueued}`,
					isError: !delivered,
				};
			}
			if (o.transport === "native-push") {
				// direct-inject succeeded; note if the 1-shot re-probe retry fired.
				return {
					text: `entwurf_v2 native-push → delivered${o.retried ? " (after a 1-shot re-probe retry)" : ""}`,
					isError: false,
				};
			}
			// meta-mailbox. #98 R: name the FILE that was enqueued, so the sender's transcript
			// carries a per-message identifier instead of a bare literal. Only the basename —
			// the directory is `<meta-mailbox>/<target garden id>/`, which the caller already
			// typed. Deliberately NOT a read stamp: at enqueue time `lastReadAt` belongs to the
			// PREVIOUS message, so printing it would claim a read that has not happened.
			// A dep that omits the receipt falls back to the old literal rather than printing
			// "undefined" — the delivery still happened.
			return {
				text: `entwurf_v2 meta-mailbox → enqueued${o.messagePath ? ` (${basename(o.messagePath)})` : ""}`,
				isError: false,
			};
		}
		case "execution-failed": {
			if (result.releaseFailed && result.finalizedOutcome) {
				// N1: the delivery/refusal reached a terminal outcome but releaseLock then threw.
				return {
					text:
						`entwurf_v2 ${result.transport} DELIVERED (${result.finalizedOutcome}) but the lock is DIRTY ` +
						`(release failed) — do NOT retry, a re-send would double-deliver. Clear the lock by hand.` +
						`\n  error: ${result.error}`,
					isError: true,
				};
			}
			return {
				text: `entwurf_v2 ${result.transport} execution failed: ${result.error} (retry-safe: ${result.retrySafe})`,
				isError: true,
			};
		}
	}
}

/**
 * Assemble production deps, run the v2 dispatch, and render the result. The root surface only
 * ever sees `{ text, isError }` — it never names the `EntwurfV2RunResult` union — so the v2
 * fence types stay behind this one entry point.
 */
export async function runAndRenderEntwurfV2FromSurface(
	params: SurfaceEntwurfV2Params,
	opts: EntwurfV2SurfaceRunOptions,
): Promise<EntwurfV2SurfaceRendered> {
	const prodOpts: ProductionEntwurfV2Opts = { senderProvider: opts.senderProvider };
	const result = await runEntwurfV2(toDispatchInput(params), makeProductionEntwurfV2Deps(prodOpts));
	return renderEntwurfV2Result(result);
}
