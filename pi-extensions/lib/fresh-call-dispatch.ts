/**
 * fresh-call-dispatch — the ONE place that decides which rail opens a sibling, and the only module
 * allowed to know that there are two.
 *
 * WHY A COMPOSITION ROOT AND NOT A BRANCH IN EACH SURFACE. Two surfaces register
 * `entwurf_fresh_call`: pi's own extension and the MCP bridge. Before this file each of them
 * carried the Codex preflight ordering and the render call itself, and adding a rail choice to
 * both would have made four places where the wrong one could be picked. A defect planted in one
 * copy survives on the other, which is precisely the shape a mutant proves nothing about. So the
 * surfaces now supply identity and an env, and this module supplies everything else.
 *
 * THE RAIL IS A CAPABILITY FACT, NOT A PARAMETER. `HERDR_ENV=1` — exactly that value, herdr's own
 * variable — means this process is inside herdr and the herdr rail is the honest placement. Every
 * other value, including a missing one, stays on the tmux rail. A caller cannot ask for a rail:
 * a parameter would let someone request tmux placement from inside herdr, where no tmux server
 * exists, and the failure would arrive after a mutation rather than before one.
 *
 * NO FALLBACK, EITHER DIRECTION. If herdr was selected and its context is incomplete, the call is
 * refused with the HERDR reason. Silently opening a tmux window instead would put a sibling
 * somewhere the operator cannot see from where they are standing, and the receipt would look fine.
 *
 * WHAT THIS MODULE DOES NOT DO: it never reads the record store, never resolves a garden id, and
 * never turns the direct herdr witness into a second public address. The nonce callback remains
 * the one address path, on both rails.
 */

import { spawn as spawnChildProcess } from "node:child_process";
import { codexFreshPreflight } from "./codex-fresh-preflight.ts";
import { mintNonce } from "./fresh-call-composition.ts";
import {
	createHerdrRunner,
	type HerdrFreshCallResult,
	type HerdrRun,
	herdrFreshCall,
	renderHerdrFreshCall,
	resolveHerdrContext,
	type SpawnFn,
} from "./herdr-fresh-call.ts";
import { type FreshCallResult, freshCall, renderFreshCall } from "./mux-fresh-call.ts";

export type FreshCallRail = "herdr" | "tmux";

/** herdr's own marker, read for its EXACT value. `[측정 2026-09-14]` herdr exports `HERDR_ENV=1`
 * to every process it starts; anything else is not a claim herdr made. */
export function selectFreshCallRail(env: NodeJS.ProcessEnv): FreshCallRail {
	return env.HERDR_ENV === "1" ? "herdr" : "tmux";
}

export interface FreshCallRequest {
	readonly backend: string;
	readonly model: string;
	readonly task: string;
	readonly cwd?: string;
	readonly placement?: { readonly tmuxSession?: string };
	/** Supplied by the SURFACE from its own record-backed context — never a tool parameter. */
	readonly callerGardenId: string | null;
}

export type DispatchedFreshCall =
	| { readonly rail: "tmux"; readonly result: FreshCallResult }
	| { readonly rail: "herdr"; readonly result: HerdrFreshCallResult };

/**
 * Open a sibling on whichever rail this process is actually standing in.
 *
 * ORDER MATTERS TWICE. On tmux, the Codex capability preflight runs BEFORE the composition, which
 * is the pre-existing contract. On herdr, the backend refusal comes first: codex is not a pilot
 * backend there, so running a Codex preflight would ask an irrelevant question and could fail for
 * a reason that has nothing to do with why the call is impossible.
 */
export async function dispatchFreshCall(
	request: FreshCallRequest,
	env: NodeJS.ProcessEnv = process.env,
	spawn?: SpawnFn,
	nonce: string = mintNonce(),
): Promise<DispatchedFreshCall> {
	if (selectFreshCallRail(env) === "herdr") {
		const context = resolveHerdrContext(env);
		if (!context.ok) {
			// Selected herdr, incomplete herdr: the refusal names the herdr fact. Falling back to
			// tmux here would open a window the operator cannot see from inside herdr.
			return { rail: "herdr", result: { ok: false, reason: context.reason } };
		}
		const run: HerdrRun = createHerdrRunner(context.context.bin, env, spawn ?? (spawnChildProcess as SpawnFn));
		return { rail: "herdr", result: await herdrFreshCall(request, run, env, nonce) };
	}
	const missing = request.backend === "codex" ? await codexFreshPreflight(env) : null;
	if (missing) return { rail: "tmux", result: { ok: false, reason: missing } };
	return {
		rail: "tmux",
		result: freshCall(
			{
				backend: request.backend as Parameters<typeof freshCall>[0]["backend"],
				model: request.model,
				task: request.task,
				...(request.cwd === undefined ? {} : { cwd: request.cwd }),
				...(request.placement?.tmuxSession === undefined
					? {}
					: { placement: { tmuxSession: request.placement.tmuxSession } }),
				callerGardenId: request.callerGardenId,
			},
			env,
			nonce,
		),
	};
}

/** Each rail renders its own receipt: the coordinates and the failure modes differ, and a single
 * "universal" renderer would have to speak about panes and windows at once, which is how prose
 * starts claiming every call uses tmux. */
export function renderDispatchedFreshCall(dispatched: DispatchedFreshCall): { text: string; isError: boolean } {
	return dispatched.rail === "herdr" ? renderHerdrFreshCall(dispatched.result) : renderFreshCall(dispatched.result);
}
