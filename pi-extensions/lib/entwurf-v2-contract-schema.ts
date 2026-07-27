/**
 * entwurf-v2-contract-schema — the pi-side TypeBox REPRESENTATION of the frozen
 * `entwurf_v2` contract. This module exists ONLY to carry the pi-ai TypeBox
 * schema builders (`StringEnum`, `Type`) out of the pi-free core
 * (`entwurf-v2-contract.ts`); the constants/types/decision logic live there.
 *
 * ⚠️ pi LANE ONLY — the MCP bridge (`mcp/entwurf-bridge/src/index.ts`) MUST NOT
 * import this module. It value-imports `@earendil-works/pi-ai`, so reaching it
 * from the bridge boot closure would re-couple the harness-neutral meta-bridge to
 * pi (the `check-entwurf-bridge-pi-free` gate fails if it does). The bridge needs
 * the contract CONSTANTS + `resolveDispatch` (pi-free core), never these schemas.
 * Consumer: `check-entwurf-v2-contract` ONLY. This is a gate-side REPRESENTATION of the
 * frozen contract, not a shipped tool schema — measured 2026-07-27, nothing else in the
 * import graph reaches it. The two surfaces a model actually reads build their own:
 * `pi-extensions/entwurf-control.ts` (TypeBox `entwurfV2Parameters` + tool description) and
 * `mcp/entwurf-bridge/src/index.ts` (Zod). Change a model-facing description THERE; changing
 * it here reaches no model, and `check-entwurf-v2-surface` is what pins those two.
 *
 * StringEnum (typebox 1.x) inside Type.Object (typebox 0.34) — the same mix the
 * existing entwurf tools use. The logic types in the core are hand-written unions,
 * NOT `Static<>` inferences, so the 0.34/1.x widening caveat does not touch them;
 * `check-entwurf-v2-contract` keeps these schemas and the core types in lockstep.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
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

export const EntwurfV2InputSchema = Type.Object(
	{
		// R2/F6 executable: the garden-id shape is enforced by pattern, not prose —
		// a malformed/typo gid fails the schema (→ bad-target) and can never reach a
		// spawn. SSOT regex = SESSION_ID_RE (pi-extensions/lib/session-id.js).
		target: Type.String({
			pattern: SESSION_ID_RE.source,
			description:
				"garden-id of an EXISTING citizen (pattern-enforced). Fresh sibling creation is out of scope on every current surface — there is no fallback verb that still spawns. A malformed/typo gid is bad-target, never a new spawn.",
		}),
		intent: StringEnum(ENTWURF_INTENTS, {
			description:
				"caller's declared outcome contract (F1): fire-and-forget = ack only, owned-outcome = caller owns completion.",
		}),
		mode: Type.Optional(
			StringEnum(ENTWURF_V2_MODES, {
				description:
					"delivery mode (steer = interrupt current turn, follow_up = queue) — NOT the ownership axis (F1) nor liveness routing. MEANINGLESS on the meta-mailbox transport (F-mailbox): a mailbox ack is enqueue+doorbell, not a turn injection, so steer/follow_up does not apply when the verdict transport is meta-mailbox.",
			}),
		),
		wantsReply: Type.Optional(
			Type.Boolean({
				description: "conversation etiquette only — NOT ownership; never triggers an auto-send (Q2).",
			}),
		),
		// `additionalProperties: false` — a frozen contract input is exact; an unknown
		// key is a caller error, not silently ignored.
	},
	{ additionalProperties: false },
);

// Receipt = a DISCRIMINATED union on `ok` (R3/F6) — NOT one flat object with
// optionals. Each branch is EXACT (`additionalProperties: false`): without it,
// JSON Schema's default admits extra keys, so an illegal receipt like
// {ok:true, ..., reason:"bad-target"} would validate against the success branch.
// With it, success carries action/transport/ownership and rejects a stray reason;
// reject carries reason and rejects any allow facet — the branches are mutually
// exclusive at the schema level, not merely by declared-property convention.
export const EntwurfV2ReceiptSuccessSchema = Type.Object(
	{
		ok: Type.Literal(true),
		action: StringEnum(ENTWURF_V2_ACTIONS),
		transport: StringEnum(ENTWURF_V2_TRANSPORTS),
		ownership: StringEnum(ENTWURF_V2_OWNERSHIPS),
		observedLiveness: StringEnum(FACT_LIVENESSES, {
			description: "the 4-value fact liveness the verdict was computed from (R1/R3).",
		}),
	},
	{ additionalProperties: false },
);

export const EntwurfV2ReceiptRejectSchema = Type.Object(
	{
		ok: Type.Literal(false),
		reason: StringEnum(ENTWURF_V2_REJECT_REASONS),
		// ？6: required-nullable, NOT optional — a reject branch ALWAYS carries the
		// key, and it is `null` for the pre-probe rejects (PRE_PROBE_REJECT_REASONS)
		// and a real FactLiveness otherwise. Optional would lose the "key always
		// present, value may be null" shape and weaken the discriminated union; the
		// reason-dependent null/non-null rule is enforced semantically (the gate's
		// rejectObservedLivenessWellFormed fixture), not by this blanket union.
		observedLiveness: Type.Union([StringEnum(FACT_LIVENESSES), Type.Null()], {
			description:
				"the 4-value fact liveness the reject was computed from (R1/R3); null for the pre-probe rejects (bad-target / target-locked / target-address-conflict) where no probe ran.",
		}),
	},
	{ additionalProperties: false },
);

export const EntwurfV2ReceiptSchema = Type.Union([EntwurfV2ReceiptSuccessSchema, EntwurfV2ReceiptRejectSchema]);
