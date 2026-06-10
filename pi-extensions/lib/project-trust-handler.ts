/**
 * project-trust-handler — the "human directly opens pi" safety net of Trust 2층
 * (0.11 Stage 0, F5b/Trust 2층). It maps a single preflight outcome to pi's
 * `project_trust` result so a human at a TUI gets a consistent decision, and —
 * critically — provides the ONE escape from an inherited distrust: an active
 * prompt whose "yes" writes a DIRECT child trust that beats the ancestor's false.
 *
 * This module is the HANDLER half; the controlled-launch (launcher) half does
 * NOT go through here — a controlled launch short-circuits on pi's
 * `trustOverride` (`--approve`) and never reaches `project_trust` at all (N3a).
 * So the active-prompt escape is, by construction, human-interactive only; an
 * agent cannot self-promote trust. That asymmetry is an intended security
 * property, not a gap.
 *
 * Boundaries baked in (GLG 6 review points, 2026-06-10):
 *  ① Single writer. This handler NEVER calls `store.set`. Returning
 *     `{trusted:"yes", remember:true}` makes pi's `resolveProjectTrusted`
 *     persist the decision (project-trust.js). A direct write here would be a
 *     double-write + lock contention.
 *  ② Every branch returns a value. `undefined` is forbidden — pi's runner reads
 *     `result.trusted` and would throw. Cancel/ESC and the no answer both map to
 *     a concrete result.
 *  ③ Non-interactive is explicit. `pi -p` (mode "print") and the rpc/json modes
 *     never get an active prompt; they return `undecided` so pi's own degraded
 *     path decides (inherited false → deny). We do not lean on the UI adapter
 *     happening to return undefined.
 *  ④ ctx.ui injection. The pure core `decideProjectTrust(outcome, ctx, prompt)`
 *     takes an injectable `prompt`; the adapter wires `ctx.ui.select` to it, so
 *     the gate drives the matrix with a fake prompt and never opens a real pi UI.
 *  ⑤ Alignment. The handler consumes ONLY the preflight outcome — it reads no
 *     file under the cwd. `prefixRoots` is an operator-policy input (no package
 *     default); tests inject a temp agentDir.
 *  ⑥ Registration is the consumer's job — see createProjectTrustHandler.
 */

import type {
	ProjectTrustContext,
	ProjectTrustEventResult,
	ProjectTrustHandler,
} from "@earendil-works/pi-coding-agent";

// ExtensionMode is not a public root export; recover it from the public
// ProjectTrustContext rather than reaching into a private subpath (frozen
// decision 9). = "tui" | "rpc" | "json" | "print".
type ExtensionMode = ProjectTrustContext["mode"];

// Explicit `.ts` extension (NOT `.js`): Node's strip-types resolver — which runs
// the gates and the bridges — resolves `.ts` specifiers literally, but refuses
// to substitute a `.ts` for a `.js` specifier (root tsconfig note). A lib→lib
// VALUE import therefore has to be `.ts` to be runnable under strip-types. Same
// fence as mcp/pi-tools-bridge → entwurf-core.ts and meta-bridge-hook.ts → its
// lib: this file is excluded from the emit-capable root tsconfig (which can't
// allow .ts extensions) and typechecked by scripts/tsconfig.json instead.
import { formatPreflightDenial, type PreflightDenial, type PreflightOutcome, preflight } from "./entwurf-preflight.ts";

/** The human's answer to the inherited-distrust escape prompt. */
export type ActivePromptChoice = "trust-here" | "no" | "cancel";
/** Injectable prompt — the adapter wires this to `ctx.ui.select`. */
export type ActivePrompt = (denial: PreflightDenial) => Promise<ActivePromptChoice>;

/** Selector labels — also the gate's fake-prompt contract. */
export const TRUST_HERE_LABEL = "Trust this folder only";
export const KEEP_DISTRUSTED_LABEL = "Keep it distrusted";

/**
 * Interactive = a human is at a TUI and can actually answer. "rpc"/"json" are
 * programmatic and "print" is `pi -p` (headless) — never actively prompt there.
 */
function isInteractive(mode: ExtensionMode, hasUI: boolean): boolean {
	return hasUI && mode === "tui";
}

/** The escape-prompt title (reuses F5a evidence) + the two selectable options. */
export function formatActivePrompt(denial: PreflightDenial): { title: string; options: string[] } {
	return { title: formatPreflightDenial(denial), options: [TRUST_HERE_LABEL, KEEP_DISTRUSTED_LABEL] };
}

/**
 * Pure mapping: preflight outcome → project_trust result. Never undefined (②),
 * never persists (①). `prompt` is only invoked for the inherited-distrust escape
 * while interactive.
 */
export async function decideProjectTrust(
	outcome: PreflightOutcome,
	ctx: { hasUI: boolean; mode: ExtensionMode },
	prompt: ActivePrompt,
): Promise<ProjectTrustEventResult> {
	// approve / trusted-no-arg → yes, do NOT persist (prefix = policy SSOT, frozen
	// decision 6: never dirty trust.json from a prefix auto-approve).
	if (outcome.kind === "approve" || outcome.kind === "trusted-no-arg") {
		return { trusted: "yes", remember: false };
	}

	if (outcome.reason === "saved-false") {
		if (!outcome.trustStoreInherited) {
			// Direct distrust on this cwd: say no, don't re-persist (already stored).
			return { trusted: "no", remember: false };
		}
		// Inherited distrust: the ONLY escape is a human active prompt.
		if (!isInteractive(ctx.mode, ctx.hasUI)) {
			// ③ non-interactive: do not prompt. undecided → pi falls through to the
			// store's inherited false = safe deny (pi -p degraded semantics).
			return { trusted: "undecided" };
		}
		const choice = await prompt(outcome);
		if (choice === "trust-here") {
			// pi persists a DIRECT child true (single writer ①) which beats the
			// inherited false (the escape direction proven in check-pi-preflight #13b).
			return { trusted: "yes", remember: true };
		}
		if (choice === "no") {
			// R3a: do not write a child false — the inherited false already covers it.
			return { trusted: "no", remember: false };
		}
		// cancel / ESC → defer; the store's inherited false denies = safe (②).
		return { trusted: "undecided" };
	}

	// fail-fast (undecided + trust inputs + no prefix root): defer to pi's OWN
	// default prompt instead of actively prompting here. undecided lets pi prompt
	// when interactive and returns false when headless — never undefined (②).
	return { trusted: "undecided" };
}

export interface ProjectTrustHandlerOptions {
	/** Operator-policy auto-approve roots (GLG ⑤ / frozen decision 7). No default. */
	prefixRoots: readonly string[];
	/** pi agent dir holding trust.json. Defaults to getAgentDir(); temp in tests. */
	agentDir?: string;
}

/**
 * Thin extension adapter (④/⑥): wires `event.cwd` → preflight and `ctx.ui.select`
 * → the injectable prompt, then delegates to the pure core.
 *
 * Registration is the CONSUMER's job (agent-config), as a USER/GLOBAL extension:
 * `project_trust` fires BEFORE project resources load, so a project-local
 * registration (this repo's `package.json` `pi.extensions`) would load too late
 * to be a safety net. The operator surface also supplies `prefixRoots` (frozen
 * decision 7 — no package default).
 */
export function createProjectTrustHandler(opts: ProjectTrustHandlerOptions): ProjectTrustHandler {
	return async (event, ctx: ProjectTrustContext): Promise<ProjectTrustEventResult> => {
		const outcome = preflight({ cwd: event.cwd, agentDir: opts.agentDir, prefixRoots: opts.prefixRoots });
		const prompt: ActivePrompt = async (denial) => {
			const { title, options } = formatActivePrompt(denial);
			const choice = await ctx.ui.select(title, options);
			if (choice === TRUST_HERE_LABEL) return "trust-here";
			if (choice === KEEP_DISTRUSTED_LABEL) return "no";
			return "cancel"; // undefined (ESC) or any unexpected label
		};
		return decideProjectTrust(outcome, { hasUI: ctx.hasUI, mode: ctx.mode }, prompt);
	};
}
