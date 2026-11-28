/**
 * fresh-call-dispatch — the ONE place that decides which rail opens a sibling, and the only module
 * allowed to know that there is more than one (tmux, herdr and, for a same-id resume, Herdr Core:
 * #178). Since #157 G1a that rail choice is shared by the two visible
 * lifecycle verbs, fresh call and same-id visible resume, through two separate entry points; each
 * verb keeps its own lifecycle policy, and only the rail choice is common.
 *
 * WHY A COMPOSITION ROOT AND NOT A BRANCH IN EACH SURFACE. Two surfaces once registered
 * `entwurf_fresh_call`: pi's own extension and the MCP bridge. Before this file each of them
 * carried the Codex preflight ordering and the render call itself, and adding a rail choice to
 * both would have made four places where the wrong one could be picked. A defect planted in one
 * copy survives on the other, which is precisely the shape a mutant proves nothing about. Since
 * #125 the bridge is the only registration, and it still supplies only identity and an env; this
 * module supplies everything else.
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
 * never turns the direct herdr witness into a second public address. For a FRESH call the nonce
 * callback remains the one address path, on both rails. A visible resume has no nonce: its address
 * is the record the v2 composition already resolved, and this module only picks where it reopens.
 */

import { spawn as spawnChildProcess } from "node:child_process";
import { ACP_MODEL_NOT_CURATED, isCuratedAcpModelId, PROVIDER_ID } from "./acp/model-ids.js";
import { codexCallerFreshPreflight, codexFreshPreflight } from "./codex-fresh-preflight.ts";
import { type FreshCallProviderRejectReason, isSafeFreshCallModel, mintNonce } from "./fresh-call-composition.ts";
import { type HcResumeLaunchOutcome, hasHcMarker, launchHcResume } from "./hc-launch.ts";
import {
	createHerdrRunner,
	type HerdrFreshCallResult,
	type HerdrRun,
	herdrFreshCall,
	renderHerdrFreshCall,
	resolveHerdrContext,
	type SpawnFn,
} from "./herdr-fresh-call.ts";
import { type HerdrResumeLaunchOutcome, launchHerdrResume } from "./herdr-resume-call.ts";
import { type FreshCallResult, freshCall, renderFreshCall } from "./mux-fresh-call.ts";
import { splitPiDurableModel } from "./pi-durable-fresh-preflight.ts";

export type FreshCallRail = "herdr" | "tmux";

/** herdr's own marker, read for its EXACT value. `[측정 2026-09-14]` herdr exports `HERDR_ENV=1`
 * to every process it starts; anything else is not a claim herdr made. */
export function selectFreshCallRail(env: NodeJS.ProcessEnv): FreshCallRail {
	return env.HERDR_ENV === "1" ? "herdr" : "tmux";
}

/**
 * #178: where a same-id visible RESUME reopens. One table, read by the launch root below, the CLI's
 * early check and the picker's Enter line:
 *
 *   hc marker   HERDR_ENV=1   rail
 *   yes         no            hc
 *   yes         yes           ambiguous — refused by name; nothing is read, locked, reserved or opened
 *   no          yes           herdr (unchanged)
 *   no          no            tmux  (unchanged)
 *
 * The hc marker is `HC_TERMINAL_ID` / `HC_TERMINAL_SOCKET`, which Herdr Core sets on every program
 * it starts. It is asked FIRST, so a `TMUX` a core inherited from the seat that started it no longer
 * sends a caller in an hc terminal to a tmux window somewhere else; `TMUX` itself is still not a
 * marker, and tmux stays the else-branch. Both markers present is a contradiction this root does not
 * resolve by preference. ACCEPTED RESIDUAL: hc variables inherited into a tmux pane route that caller
 * to hc while their source terminal is live — the receipt then truthfully names an hc terminal.
 *
 * A FRESH call does not use this table: inside hc it is refused as `hc-fresh-unsupported` (below).
 */
export type ResumeRail = "hc" | "herdr" | "tmux";

export function selectResumeRail(env: NodeJS.ProcessEnv): ResumeRail | "ambiguous" {
	const herdr = selectFreshCallRail(env) === "herdr";
	if (hasHcMarker(env)) return herdr ? "ambiguous" : "hc";
	return herdr ? "herdr" : "tmux";
}

export const RAIL_MARKERS_AMBIGUOUS = "rail-markers-ambiguous";
export const RAIL_MARKERS_AMBIGUOUS_HINT =
	"this process carries both a Herdr Core marker (HC_TERMINAL_ID / HC_TERMINAL_SOCKET) and HERDR_ENV=1, so where it actually runs cannot be told from its environment, and no rail is chosen by preference";

/** #178: a fresh call from inside an hc terminal is refused by name. The hc rail reopens existing
 * citizens only; opening a NEW sibling there is outside this rail, and falling through to tmux would
 * open a window the caller in hc cannot see. */
export const HC_FRESH_UNSUPPORTED = "hc-fresh-unsupported";
export const HC_FRESH_UNSUPPORTED_HINT =
	"this process runs in a Herdr Core terminal (HC_TERMINAL_ID / HC_TERMINAL_SOCKET), where entwurf opens no NEW sibling: the hc rail only reopens a dormant citizen under its own garden id (entwurf_resume_call). Nothing was sent to tmux or herdr instead";

export interface FreshCallRequest {
	readonly backend: string;
	readonly model: string;
	readonly task: string;
	readonly cwd?: string;
	readonly placement?: { readonly tmuxSession?: string };
	/** Supplied by the SURFACE from its own record-backed context — never a tool parameter. */
	readonly callerGardenId: string | null;
	/** Set by the surface exactly when the reconciled caller is a record-backed codex citizen,
	 * carrying that citizen's `nativeSessionId`. TMUX-RAIL INPUT ONLY: it exists to find the
	 * caller's own pane by its terminal title (#95 lane B), and a herdr tab has no such pane. */
	readonly callerNativeSessionId?: string;
	/** The SAME codex citizen's record cwd, under the same condition (#95 lane C), consulted only
	 * when the call requested no cwd of its own: by the tmux rail, and inside herdr by BOTH branches —
	 * the layout branch (pi-durable, #157 A-L1) and the agent-start branch (pi/claude-code, #157
	 * A-L1x) — which refuse rather than fall back to their own process cwd when a known Codex caller
	 * has none. */
	readonly callerCwd?: string;
}

export type DispatchedFreshCall =
	| { readonly rail: "tmux"; readonly result: FreshCallResult }
	| { readonly rail: "herdr"; readonly result: HerdrFreshCallResult }
	| { readonly rail: "hc"; readonly result: { readonly ok: false; readonly reason: typeof HC_FRESH_UNSUPPORTED } };

/**
 * #76: the provider a Pi-dialect model string NAMES. pi passes the string to `--model` and Pi
 * resolves it; pi-durable splits it at the first `/` into `--provider`. So for those two backends
 * the segment before the first `/` is a provider choice, and for every other backend it is that
 * vendor's own model name, which this does not judge (a claude-code `opus` stays an alias).
 *
 *   model-openrouter-forbidden        pi or pi-durable names the OpenRouter provider. Compared in
 *                                     any letter case: whether Pi folds case is not measured here,
 *                                     so the spelling difference fails closed instead of passing.
 *   pi-model-not-provider-qualified   pi names no provider at all. The alias leaves the provider
 *                                     choice to Pi's catalog instead of the caller naming it — a
 *                                     bare `terra` once opened on an OpenRouter row. pi-durable
 *                                     already refuses the same shape in its own preflight, by the
 *                                     same predicate.
 *
 * WHAT THIS IS NOT. A call-time input contract only: it checks the string a caller wrote, never a
 * model version, never a list of known ids, never a resolved row or the endpoint a provider name
 * reaches. A later model name passes THIS provider check once it is written `<provider>/<id>` —
 * which says nothing about whether it launches or what #128 decides after it. It does not touch
 * resume, which reopens from the record, and it proves nothing about billing beyond the name.
 * Read trimmed, and only once the rails' grammar admits the model, exactly like #128 below.
 */
export function freshCallProviderRefusal(backend: string, model: string): FreshCallProviderRejectReason | null {
	if (backend !== "pi" && backend !== "pi-durable") return null;
	const trimmed = model.trim();
	if (!isSafeFreshCallModel(trimmed)) return null;
	const slash = trimmed.indexOf("/");
	if (slash >= 0 && trimmed.slice(0, slash).toLowerCase() === "openrouter") return "model-openrouter-forbidden";
	if (backend === "pi" && splitPiDurableModel(trimmed) === null) return "pi-model-not-provider-qualified";
	return null;
}

/**
 * #128: a pi sibling asked for under the `entwurf` provider must name an EXACT curated ACP id. Pi
 * resolves `--model` by substring among that provider's rows, so a retired `entwurf/claude-sonnet-5`
 * would open on `cortex-claude-sonnet-5` — another vendor and billing rail — with a receipt that
 * still names the requested id. Asked here, at the one root both rails share, so neither rail can
 * forget it. It reads the model the way the rails will (trimmed), and only a model that already
 * passes their grammar: a malformed one keeps its own `model-invalid` answer from the rail.
 */
export function isUncuratedEntwurfPiModel(backend: string, model: string): boolean {
	if (backend !== "pi") return false;
	const trimmed = model.trim();
	if (!isSafeFreshCallModel(trimmed)) return false;
	const slash = trimmed.indexOf("/");
	if (slash < 0 || trimmed.slice(0, slash) !== PROVIDER_ID) return false;
	return !isCuratedAcpModelId(trimmed.slice(slash + 1));
}

/**
 * Open a sibling on whichever rail this process is actually standing in.
 *
 * ORDER MATTERS TWICE. On tmux, the Codex capability preflights run BEFORE the composition, which
 * is the pre-existing contract. On herdr, the backend refusal comes first: codex is not a pilot
 * backend there, so running a Codex preflight would ask an irrelevant question and could fail for
 * a reason that has nothing to do with why the call is impossible.
 *
 * THE CODEX CALLER'S THREAD ID IS A TMUX-RAIL FACT and stops at this boundary. #95 lane B measured
 * it against a tmux pane: a pane title is what carries the caller's thread-id, and inside herdr the
 * tab is created by herdr, with no pane title to anchor to. The herdr rail therefore receives only a
 * boolean saying the caller IS a record-backed Codex citizen, plus that citizen's record cwd (#95
 * lane C: an app-server-hosted bridge's own directory is the app-server's). Both herdr branches read
 * them (layout since #157 A-L1, agent start since A-L1x), to choose a cwd without falling back to
 * this process's; this is not a Codex-in-herdr placement certification.
 */
export async function dispatchFreshCall(
	request: FreshCallRequest,
	env: NodeJS.ProcessEnv = process.env,
	spawn?: SpawnFn,
	nonce: string = mintNonce(),
): Promise<DispatchedFreshCall> {
	// #178: asked before anything else — no model, provider or capability question matters for a call
	// this rail does not make.
	if (hasHcMarker(env)) return { rail: "hc", result: { ok: false, reason: HC_FRESH_UNSUPPORTED } };
	// Before either rail is asked anything: both would open a pane on a provider nobody chose.
	const providerRefusal = freshCallProviderRefusal(request.backend, request.model);
	if (providerRefusal !== null) {
		return selectFreshCallRail(env) === "herdr"
			? { rail: "herdr", result: { ok: false, reason: providerRefusal } }
			: { rail: "tmux", result: { ok: false, reason: providerRefusal } };
	}
	// Before either rail is asked anything: both would open a pane on the wrong row.
	if (isUncuratedEntwurfPiModel(request.backend, request.model)) {
		return selectFreshCallRail(env) === "herdr"
			? { rail: "herdr", result: { ok: false, reason: ACP_MODEL_NOT_CURATED } }
			: { rail: "tmux", result: { ok: false, reason: ACP_MODEL_NOT_CURATED } };
	}
	if (selectFreshCallRail(env) === "herdr") {
		const context = resolveHerdrContext(env);
		if (!context.ok) {
			// Selected herdr, incomplete herdr: the refusal names the herdr fact. Falling back to
			// tmux here would open a window the operator cannot see from inside herdr.
			return { rail: "herdr", result: { ok: false, reason: context.reason } };
		}
		const run: HerdrRun = createHerdrRunner(context.context.bin, env, spawn ?? (spawnChildProcess as SpawnFn));
		// #157 A-L1: an explicit field list, not `...request`, so the Codex thread id STOPS here — it is
		// a tmux seat input. The herdr rail learns only WHETHER the caller is a record-backed Codex
		// citizen (one boolean) and that citizen's record cwd; the tmux request below is untouched.
		const herdrRequest = {
			backend: request.backend,
			model: request.model,
			task: request.task,
			...(request.cwd === undefined ? {} : { cwd: request.cwd }),
			...(request.placement === undefined ? {} : { placement: request.placement }),
			callerGardenId: request.callerGardenId,
			...(request.callerCwd === undefined ? {} : { callerCwd: request.callerCwd }),
			callerIsCodex: request.callerNativeSessionId !== undefined,
		};
		return { rail: "herdr", result: await herdrFreshCall(herdrRequest, run, env, nonce) };
	}
	// TWO capability axes, in this order, both pre-mutation and neither standing in for the
	// other. The TARGET axis first — "entwurf cannot open a Codex sibling here at all" is the
	// more fundamental answer than "and it would not know where to put it". The CALLER axis
	// second, and only when the seat anchor will actually be consulted: a codex caller that
	// named an explicit placement never reads a pane title, so refusing it for a missing
	// `thread-id` would refuse an unused capability.
	const targetMissing = request.backend === "codex" ? await codexFreshPreflight(env) : null;
	const callerMissing =
		targetMissing === null && request.callerNativeSessionId !== undefined && request.placement === undefined
			? codexCallerFreshPreflight(env)
			: null;
	const missing = targetMissing ?? callerMissing;
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
				...(request.callerNativeSessionId === undefined
					? {}
					: { callerNativeSessionId: request.callerNativeSessionId }),
				...(request.callerCwd === undefined ? {} : { callerCwd: request.callerCwd }),
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
	if (dispatched.rail === "hc") {
		return {
			text: `entwurf_fresh_call rejected: ${dispatched.result.reason} — ${HC_FRESH_UNSUPPORTED_HINT}. Nothing was opened.`,
			isError: true,
		};
	}
	return dispatched.rail === "herdr" ? renderHerdrFreshCall(dispatched.result) : renderFreshCall(dispatched.result);
}

/** A refusal with nothing created, in the seam's own shape. */
export interface RailMarkersAmbiguous {
	readonly ok: false;
	readonly reason: typeof RAIL_MARKERS_AMBIGUOUS;
	readonly hint: string;
}

/** The record-derived launch input the v2 visible-resume seam hands its launcher. */
export interface ResumeLaunchInput {
	readonly backend: string;
	readonly cwd: string;
	readonly runtimeArgs: readonly string[];
	readonly piDurableAdoptEnv?: {
		readonly PI_CODING_AGENT_DIR: string;
		readonly ENTWURF_META_SESSIONS_DIR: string;
		readonly ENTWURF_META_MAILBOX_DIR: string;
		readonly ENTWURF_META_SENDERS_DIR: string;
		readonly ENTWURF_META_RECEIVERS_DIR: string;
	};
}

/**
 * #157 G1a: pick the rail a same-id visible resume reopens on — the SAME capability fact fresh
 * call reads, through the same `selectFreshCallRail`, never a parameter and never a fallback either
 * way. This entry point owns that choice and nothing else:
 *
 *   the v2 composition   record, dormancy proof, lock, identity, observation — it calls the surface's
 *                        launcher and never learns that there are rails
 *   the surface          supplies the fixed tmux launch mapping as `tmuxLaunch`; it reads no rail fact
 *   herdr-resume-call    owns the herdr behaviour, including refusing a non-pi target before anything
 *                        is created
 *
 * Inside herdr the tmux mapping is never called, so a refused or failed herdr launch stays a herdr
 * answer. Outside herdr the tmux mapping keeps its own herdr guard for any direct caller.
 *
 * #178: the rail is read from `selectResumeRail`. Inside a Herdr Core terminal the hc launch runs and
 * neither other mapping is called; contradictory markers are refused here, before any rail is asked.
 */
export function dispatchResumeLaunch<I extends ResumeLaunchInput, T>(
	input: I,
	tmuxLaunch: (input: I) => T,
	env: NodeJS.ProcessEnv = process.env,
	spawn?: SpawnFn,
): T | Promise<HerdrResumeLaunchOutcome> | Promise<HcResumeLaunchOutcome> | RailMarkersAmbiguous {
	const rail = selectResumeRail(env);
	if (rail === "ambiguous") return { ok: false, reason: RAIL_MARKERS_AMBIGUOUS, hint: RAIL_MARKERS_AMBIGUOUS_HINT };
	if (rail === "hc") return launchHcResume(input, env);
	if (rail === "tmux") return tmuxLaunch(input);
	return launchHerdrResume(input, env, spawn ?? (spawnChildProcess as SpawnFn));
}
