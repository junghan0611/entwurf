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
 *     spawn `lock-retained` diagnostic, and the N1 delivered+lock-dirty `execution-failed`.
 *   - `runAndRenderEntwurfV2FromSurface` — assemble production deps + run + render, so the root
 *     surface never needs to name the `EntwurfV2RunResult` union (it only sees `{text,isError}`).
 */

import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { DispatchInput, EntwurfV2Mode } from "./entwurf-v2-decider.ts";
import { makeProductionEntwurfV2Deps, type ProductionEntwurfV2Opts } from "./entwurf-v2-production.ts";
import { type EntwurfV2RunResult, runEntwurfV2 } from "./entwurf-v2-runner.ts";

/** The raw shape a surface (pi tool / MCP verb) collects. `wants_reply` is snake_case to
 * match the external `entwurf_send` convention; the runner sees `wantsReply`. */
export interface SurfaceEntwurfV2Params {
	target: string;
	intent: "fire-and-forget" | "owned-outcome";
	mode?: EntwurfV2Mode;
	wants_reply?: boolean;
	message: string;
}

/** ctx-free run options. The caller (entwurf-control.ts / MCP bridge) builds `senderProvider`
 * from its own envelope source — this module never touches `ExtensionContext`. `agentDir` /
 * `prefixRoots` stay undefined in 5d-3 (preflight default / no prefix promotion); 5d-4 wires
 * the doctor flag + operator-policy roots through here. */
export interface EntwurfV2SurfaceRunOptions {
	senderProvider: () => SenderEnvelope | undefined;
	agentDir?: string;
	prefixRoots?: readonly string[];
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

/** Render the outcome-rich result to `{ text, isError }`. A reject or a thrown/failed/dirty
 * delivery is `isError:true`; a sent/fallback-sent/enqueued/observed delivery is `isError:false`.
 * A control in-band `rejected` is a non-delivery (isError:true) and carries N3 `rejectReason`
 * when present; a spawn `lock-retained` is fail-closed (isError:true) with its diagnostic. */
export function renderEntwurfV2Result(result: EntwurfV2RunResult): EntwurfV2SurfaceRendered {
	switch (result.kind) {
		case "rejected": {
			const r = result.receipt;
			let text = `entwurf_v2 rejected: ${r.reason} (observed liveness: ${r.observedLiveness ?? "n/a"})`;
			if (result.diagnostic?.kind === "target-locked") {
				const c = result.diagnostic.conflict;
				text +=
					`\n  target-locked: ${c.lockPath}` +
					`\n  ${c.detail}` +
					(c.holder ? `\n  holder: pid ${c.holder.pid} on ${c.holder.hostname} since ${c.holder.createdAt}` : "");
			}
			return { text, isError: true };
		}
		case "executed": {
			const o = result.outcome;
			if (o.transport === "control-socket") {
				const delivered = o.outcome === "sent" || o.outcome === "fallback-sent";
				const reason = o.rejectReason ? ` (reason: ${o.rejectReason})` : "";
				return {
					text: `entwurf_v2 control-socket → ${o.outcome}${reason}`,
					isError: !delivered,
				};
			}
			if (o.transport === "spawn-bg") {
				const res = o.result;
				if (res.kind === "lock-retained") {
					const d = res.diagnostic;
					return {
						text:
							`entwurf_v2 spawn-bg LOCK RETAINED (${res.reason}) — lock NOT released, operator must clear:` +
							`\n  target: ${d.targetGardenId}` +
							`\n  lockPath: ${d.lockPath}` +
							`\n  expectedSocketPath: ${d.expectedSocketPath}` +
							`\n  observeTimeoutMs: ${d.observeTimeoutMs}, killGraceMs: ${d.killGraceMs}` +
							(res.error ? `\n  error: ${res.error}` : ""),
						isError: true,
					};
				}
				if (res.kind === "spawn-start-failed") {
					return { text: `entwurf_v2 spawn-bg failed to start: ${res.error}`, isError: true };
				}
				const pid = "pid" in res && res.pid !== undefined ? ` (pid ${res.pid})` : "";
				const exit = res.kind === "child-exited" ? ` exitCode=${res.exitCode}` : "";
				return { text: `entwurf_v2 spawn-bg → ${res.kind}${pid}${exit}, lock released`, isError: false };
			}
			// meta-mailbox
			return { text: "entwurf_v2 meta-mailbox → enqueued", isError: false };
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
	const prodOpts: ProductionEntwurfV2Opts = {
		senderProvider: opts.senderProvider,
		agentDir: opts.agentDir,
		prefixRoots: opts.prefixRoots,
	};
	const result = await runEntwurfV2(toDispatchInput(params), makeProductionEntwurfV2Deps(prodOpts));
	return renderEntwurfV2Result(result);
}
