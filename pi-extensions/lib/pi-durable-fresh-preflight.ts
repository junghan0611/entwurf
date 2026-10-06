/**
 * pi-durable-fresh-preflight — the pre-mutation check a pi-durable fresh call needs (#129 W, L6;
 * `docs/adding-a-harness.md` step 9 clauses 2, 3 and 5).
 *
 * Same question as `omp-fresh-preflight.ts`, at the same moment: before `mux-fresh-call` mutates the
 * operator's tmux session, is everything the fresh contract needs actually in place? A refusal HERE,
 * before placement, leaves no window behind. A pass here does not promise the window's own pass: the
 * managed verb re-verifies inside the window, whose env is the tmux SERVER's and whose `entwurf` is
 * whatever PATH names, so under env or package-closure skew it can still refuse after the window
 * exists — and that refusal is left showing in it.
 *
 * ── The inputs, first ──
 *
 *   model         the fresh-call model grammar already admits `/`, and a durable launch needs the
 *                 provider spelled out (the bootstrap refuses a model resolved by inference), so
 *                 the model here is `<provider>/<model id>` split at the FIRST `/` — a catalog id
 *                 that itself contains `/` keeps it. A model with no provider part is refused.
 *   first input   the whole framing (callback first, then the task) rides the bootstrap's closed
 *                 `{v:2,task}` payload, whose decoder caps `task` at 16000 characters. A framed
 *                 task over that cap would open a window whose bootstrap refuses its own argv.
 *
 * ── Then the runtime, then the four units ──
 *
 *   runtime          operator-provided at the fixed locator and verified against the pin
 *                    (`pi-durable-runtime.ts`); passed in as that check's verdict.
 *   birth            the compiled contact in this package's closure — it mints the record.
 *   MCP hand         the compiled entwurf-bridge entry in the same closure — the contact spawns it.
 *   receive          the compiled owner join in the same closure admits `pi-durable-host`; without
 *                    it every dispatch to the citizen is the honest `mailbox-undeliverable`.
 *   visible identity the packaged bootstrap — the one that hands the TUI the view whose conversation
 *                    labels carry the garden id.
 *
 * ── What this deliberately does NOT claim ──
 *
 * Filesystem truth about ONE package closure and ONE runtime directory. It does not prove the durable
 * app opens, the bridge connects, the doorbell arms or a garden id renders — that is runtime truth for
 * the clause 7 LIVE receipt. No spawn, no network, no mutation; every path arrives as an argument, so
 * this leaf imports nothing but types.
 */

import { existsSync, readFileSync } from "node:fs";
import type { PiDurablePackageLayout, PiDurableRuntimeRejectReason } from "./pi-durable-runtime.ts";

/** The bootstrap decoder's task cap (`meta-bridge-omp.ts` OMP_BOOTSTRAP_TASK_MAX_CHARS); the beside
 * test holds the two equal. */
export const PI_DURABLE_FIRST_INPUT_MAX_CHARS = 16000;

export type PiDurablePreflightRejectReason =
	| "pi-durable-model-not-provider-qualified"
	| "pi-durable-first-input-too-long"
	| PiDurableRuntimeRejectReason
	| "pi-durable-birth-unit-missing"
	| "pi-durable-mcp-hand-missing"
	| "pi-durable-receive-unit-missing"
	| "pi-durable-visible-identity-missing";

/** `<provider>/<model id>` at the FIRST `/`, or `null` when either side is empty. */
export function splitPiDurableModel(model: string): { provider: string; model: string } | null {
	const at = model.indexOf("/");
	if (at <= 0 || at === model.length - 1) return null;
	return { provider: model.slice(0, at), model: model.slice(at + 1) };
}

/** The compiled owner join, read from the emitted bytes the bridge actually loads. */
function ownerJoinAdmitsDurableHost(file: string): boolean {
	try {
		const join = /SENDER_JOINED_RECEIVER_OWNER_KINDS\s*=\s*(\[[^\]]*\])/.exec(readFileSync(file, "utf8"))?.[1];
		return join?.includes('"pi-durable-host"') ?? false;
	} catch {
		// Bounded environment probe: an unreadable file is a missing unit.
		return false;
	}
}

/** The FIRST missing thing, in repair order, or `null` when a fresh launch may proceed. */
export function piDurableFreshPreflight(params: {
	readonly model: string;
	readonly firstInput: string;
	readonly layout: PiDurablePackageLayout | null;
	/** The verdict of `checkPiDurableRuntime` for the caller's env: `null` = verified. */
	readonly runtime: PiDurableRuntimeRejectReason | null;
}): PiDurablePreflightRejectReason | null {
	if (splitPiDurableModel(params.model) === null) return "pi-durable-model-not-provider-qualified";
	if (params.firstInput.length > PI_DURABLE_FIRST_INPUT_MAX_CHARS) return "pi-durable-first-input-too-long";
	if (params.layout === null) return "pi-durable-package-incomplete";
	if (params.runtime !== null) return params.runtime;
	const layout = params.layout;
	if (!existsSync(layout.adapter)) return "pi-durable-birth-unit-missing";
	if (!existsSync(layout.bridgeEntry)) return "pi-durable-mcp-hand-missing";
	if (!ownerJoinAdmitsDurableHost(layout.deliverability)) return "pi-durable-receive-unit-missing";
	if (!existsSync(layout.bootstrap)) return "pi-durable-visible-identity-missing";
	return null;
}

/** Repair text beside the predicate that decides it. The runtime reasons keep theirs on the runtime
 * leaf; `mux-fresh-call` spreads both tables. */
export const PI_DURABLE_PREFLIGHT_HINT: Record<
	Exclude<PiDurablePreflightRejectReason, PiDurableRuntimeRejectReason>,
	string
> = {
	"pi-durable-model-not-provider-qualified":
		"a pi-durable model is `<provider>/<model id>` — the durable bootstrap resolves no provider by inference",
	"pi-durable-first-input-too-long":
		"the framed first input exceeds the 16000-character bootstrap payload cap — shorten the task",
	"pi-durable-birth-unit-missing":
		"this Entwurf package has no compiled pi-durable contact (mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-pi-durable.js), so the sibling would mint no record — reinstall or rebuild Entwurf",
	"pi-durable-mcp-hand-missing":
		"this Entwurf package has no compiled entwurf-bridge entry, so the sibling's callback tool would not exist — reinstall or rebuild Entwurf",
	"pi-durable-receive-unit-missing":
		"this Entwurf package's compiled owner join does not admit pi-durable-host, so nothing could ever be delivered to the sibling — reinstall or rebuild Entwurf",
	"pi-durable-visible-identity-missing":
		"this Entwurf package has no packaged pi-durable bootstrap (pi/pi-durable/bootstrap.mjs), so no TUI would carry the garden id — reinstall Entwurf",
};
