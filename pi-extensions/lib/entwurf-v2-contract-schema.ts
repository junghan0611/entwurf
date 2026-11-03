/**
 * entwurf-v2-contract-schema — the pi-side JSON Schema REPRESENTATION of the frozen
 * `entwurf_v2` contract. This module exists ONLY to carry the pi schema builders
 * (pi-ai's `StringEnum`, pi-schema's `obj`/`str`/…) out of the pi-free core
 * (`entwurf-v2-contract.ts`); the constants/types/decision logic live there.
 *
 * ⚠️ pi LANE ONLY — the MCP bridge (`mcp/entwurf-bridge/src/index.ts`) MUST NOT
 * import this module. It value-imports `@earendil-works/pi-ai`, so reaching it
 * from the bridge boot closure would re-couple the harness-neutral meta-bridge to
 * pi (the `check-entwurf-bridge-pi-free` gate fails if it does). The bridge needs
 * the contract CONSTANTS + `resolveDispatch` (pi-free core), never these schemas.
 * Consumer: `check-entwurf-v2-contract` ONLY. This is a gate-side REPRESENTATION of the
 * frozen contract, not a shipped tool schema — measured 2026-07-27, nothing else in the
 * import graph reaches it. The surface a model actually reads builds its own:
 * `mcp/entwurf-bridge/src/index.ts` (Zod, descriptions from ENTWURF.json), which a pi citizen
 * reaches through Pi's built-in MCP since the native pi tools were retired (2f7c883, Pi 0.99).
 * Change a model-facing description THERE; changing it here reaches no model.
 *
 * Pi SDK 1.5 (#155) removed pi-ai's TypeBox re-export (`Type`); its builders are now
 * `@earendil-works/pi-schema`, which emits plain JSON Schema (obj() closed by default,
 * opt() leaves a property out of `required`, lit() is `{const}`), and pi-ai's
 * `StringEnum` still emits `{type:"string", enum}`. The logic types in the core are
 * hand-written unions, NOT `Static<>` inferences; `check-entwurf-v2-contract` keeps
 * these schemas and the core types in lockstep.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { bool, lit, nul, obj, opt, type Properties, type Schema, str, union } from "@earendil-works/pi-schema";
import {
	ENTWURF_INTENTS,
	ENTWURF_V2_ACTIONS,
	ENTWURF_V2_MODES,
	ENTWURF_V2_OWNERSHIPS,
	ENTWURF_V2_REJECT_REASONS,
	ENTWURF_V2_TRANSPORTS,
	FACT_LIVENESSES,
} from "./entwurf-v2-contract.ts";
import { SESSION_ID_RE } from "./session-id.js";

/**
 * The face the drift guard reads. pi-schema types a schema as `{[keyword]: unknown}`; obj() always emits
 * `properties`, so this names that one keyword without asserting anything else about the shape.
 */
type ObjectSchema = Schema & { readonly properties: Readonly<Record<string, Schema>> };

/** obj() — closed, so it emits `additionalProperties: false` — under the face above. */
const closedObject = (properties: Properties): ObjectSchema => obj(properties) as ObjectSchema;

export const EntwurfV2InputSchema = closedObject({
	// R2/F6 executable: the garden-id shape is enforced by pattern, not prose —
	// a malformed/typo gid fails the schema (→ bad-target) and can never reach a
	// spawn. SSOT regex = SESSION_ID_RE (pi-extensions/lib/session-id.js).
	target: str({
		pattern: SESSION_ID_RE.source,
		description:
			"garden-id of an EXISTING citizen (pattern-enforced). Fresh sibling creation is out of scope on every current surface — there is no fallback verb that still spawns. A malformed/typo gid is bad-target, never a new spawn.",
	}),
	intent: StringEnum(ENTWURF_INTENTS, {
		description:
			"caller's declared outcome contract (F1). ONE member since the visible-first cut: fire-and-forget = ack only. The second, owned-outcome (caller owns completion), resumed a dormant citizen by launching a hidden background child and was withdrawn — a dormant citizen is currently unreachable by this verb.",
	}),
	mode: opt(
		StringEnum(ENTWURF_V2_MODES, {
			description:
				"delivery mode — NOT the ownership axis (F1) nor liveness routing. steer (ask the receiver's steering queue) or follow_up (ask its follow-up queue). NEITHER is an interrupt: a busy receiver drains steering after each turn and follow-ups only when its inner loop ends, so a later steer overtakes every earlier follow_up and there is no order between the two. Both queues are volatile process memory — an abort drops what is in them. The receipt names which queue accepted the message (`queued-steer` / `queued-follow-up`); an idle receiver answers `sent`, meaning the turn was TRIGGERED, not that the model has seen the text. MEANINGLESS on the meta-mailbox transport (F-mailbox): a mailbox ack is enqueue+doorbell, not a turn injection, so steer/follow_up does not apply when the verdict transport is meta-mailbox.",
		}),
	),
	wantsReply: opt(
		bool({
			description: "conversation etiquette only — NOT ownership; never triggers an auto-send (Q2).",
		}),
	),
	// `additionalProperties: false` — a frozen contract input is exact; an unknown
	// key is a caller error, not silently ignored. obj() is closed by default (it
	// emits `additionalProperties: false` unless `open: true`).
});

// Receipt = a DISCRIMINATED union on `ok` (R3/F6) — NOT one flat object with
// optionals. Each branch is EXACT (`additionalProperties: false`): without it,
// JSON Schema's default admits extra keys, so an illegal receipt like
// {ok:true, ..., reason:"bad-target"} would validate against the success branch.
// With it, success carries action/transport/ownership and rejects a stray reason;
// reject carries reason and rejects any allow facet — the branches are mutually
// exclusive at the schema level, not merely by declared-property convention.
export const EntwurfV2ReceiptSuccessSchema = closedObject({
	ok: lit(true),
	action: StringEnum(ENTWURF_V2_ACTIONS),
	transport: StringEnum(ENTWURF_V2_TRANSPORTS),
	ownership: StringEnum(ENTWURF_V2_OWNERSHIPS),
	observedLiveness: StringEnum(FACT_LIVENESSES, {
		description: "the 4-value fact liveness the verdict was computed from (R1/R3).",
	}),
});

export const EntwurfV2ReceiptRejectSchema = closedObject({
	ok: lit(false),
	reason: StringEnum(ENTWURF_V2_REJECT_REASONS),
	// ？6: required-nullable, NOT optional — a reject branch ALWAYS carries the
	// key, and it is `null` for the pre-probe rejects (PRE_PROBE_REJECT_REASONS)
	// and a real FactLiveness otherwise. Optional would lose the "key always
	// present, value may be null" shape and weaken the discriminated union; the
	// reason-dependent null/non-null rule is enforced semantically (the gate's
	// rejectObservedLivenessWellFormed fixture), not by this blanket union.
	observedLiveness: union([StringEnum(FACT_LIVENESSES), nul()], {
		description:
			"the 4-value fact liveness the reject was computed from (R1/R3); null for the pre-probe rejects (bad-target / target-locked / target-address-conflict) where no probe ran.",
	}),
});

export const EntwurfV2ReceiptSchema = union([EntwurfV2ReceiptSuccessSchema, EntwurfV2ReceiptRejectSchema]);
