/**
 * entwurf-self-address — the PURE self-addressability predicate (SE-1/SE-2 slice 1).
 *
 * "Can a reply to THIS session actually land where its model will see it?"
 *
 * This module closed the former split where the MCP and native pi surfaces inferred
 * `replyable: true` from identity-carrier presence alone. Identity and reachability
 * are separate: pi's env carries the garden id established by record birth, while
 * replyability requires its control socket; a native marker must be record-backed,
 * while replyability additionally requires its own rail's live facts. This is the
 * single truth-table both surfaces compute from, with every fact INJECTED (no IO) so
 * the gate can pin each row.
 *
 * Axes by origin:
 *  - pi-session:  replyable ⟺ a live control socket exists at the canonical path.
 *                 socketState distinguishes alive / expected (path computable but no
 *                 live socket) / none (no session id to even compute a path).
 *  - meta-session (self-fetch backend, e.g. claude-code): replyable ⟺ the 3-conjunct
 *                 deliverability — recordBacked AND ownerAlive AND watchArmed (Q4-1
 *                 lock: self-fetch(static) ∧ ownerPid-startKey-alive(runtime) ∧
 *                 watch-armed(runtime)). The watchArmed FACT is sourced from the
 *                 slice-2 meta-receiver presence marker; until that wiring lands the
 *                 caller passes watchArmed=false, so meta-self is intentionally
 *                 FAIL-CLOSED until slice 2. Slices 1 and 2 close in the SAME release
 *                 block, so no intermediate "meta self all-false" state is ever pushed.
 *  - meta-session (native-push backend, e.g. antigravity): replyable ⟺ recordBacked AND
 *                 probeAlive — the SEPARATE native-push axis (봉인 6 / 보정①). A reply to
 *                 an agy citizen is a direct injection into a live app-server conversation,
 *                 so what makes it land is an adapter probe finding that conversation, NOT a
 *                 mailbox watch. Reusing the receiver atom here would smuggle `watchArmed`
 *                 (a mailbox-only signal) into a domain with no mailbox, and an agy sender
 *                 — which never arms a watch — would report replyable:false forever.
 *  - external-mcp: never replyable — no authoritative reply address.
 *
 * `origin` stays sender-carrier PROVENANCE, never the citizen identity authority and never a rail.
 * Which rail a meta citizen's reply rides is a SECOND axis — `metaDeliveryDomain`.
 * The caller derives it as three values, never as a native-push-or-self-fetch binary:
 *   native-push  ← `nativePushSupported(backend)` (the adapter list; NOT wakeMode —
 *                  `direct-inject` also covers codex/pi, which have no native-push adapter)
 *   self-fetch   ← `resolveMailboxWakeModeCapability` (the decider's own mailbox seam)
 *   none         ← neither (omp today: no mailbox drain, no native-push adapter)
 * Fail-closed: an unsupplied domain is not replyable.
 */

import { computeMetaReceiverActive, nativePushDeliverable } from "./entwurf-deliverability.ts";

export type SelfOrigin = "pi-session" | "meta-session" | "external-mcp";

/** Which delivery rail carries a reply back to a meta citizen (the second axis, never `origin`). */
export type MetaDeliveryDomain = "self-fetch" | "native-push" | "none";

/**
 * pi control-socket reachability for a reply addressed back to this session.
 *
 * NOTE on "alive": at this slice the caller establishes it with an existsSync on the
 * canonical socket path — it means "the canonical control socket FILE is present",
 * not "a listener is accepting connections". A stale socket file with a dead listener
 * still reads as `alive` here. A real connect/probeSocketLiveness check is deliberate
 * future hardening (a separate slice), kept out per the slice-1 existsSync-level
 * agreement to avoid over-reach. Do not read `alive` as proven liveness.
 */
export type SocketState = "alive" | "expected" | "none";

export interface SelfAddressabilityFacts {
	origin: SelfOrigin;
	/** pi-session: a live control socket exists at the canonical path (existsSync today). */
	socketAlive?: boolean;
	/** pi-session: a session id is present so the canonical socket path is computable. */
	socketPathComputable?: boolean;
	/** meta-session: which rail a reply rides — from nativePushSupported(backend), NOT wakeMode. */
	metaDeliveryDomain?: MetaDeliveryDomain;
	/** meta-session: the sender marker's identity is backed by a live meta-record. */
	recordBacked?: boolean;
	/** meta-session (self-fetch): the marker's owner pid is still the same process (start-key match). */
	ownerAlive?: boolean;
	/** meta-session (self-fetch): the idle-wake watch is armed (slice-2 presence marker; fail-closed until then). */
	watchArmed?: boolean;
	/** meta-session (native-push): an adapter probe found this citizen's live native conversation. */
	probeAlive?: boolean;
}

export interface SelfAddressabilityResult {
	replyable: boolean;
	socketState: SocketState;
	reason: string;
}

/**
 * Decide whether a reply to this session is actually deliverable, from injected
 * facts only. Pure: no env reads, no fs, no probing — the caller gathers the facts
 * (existsSync the socket, validate the marker against its record, read the presence
 * marker) and hands them in, so every row is gate-pinnable.
 */
export function computeSelfAddressability(facts: SelfAddressabilityFacts): SelfAddressabilityResult {
	switch (facts.origin) {
		case "pi-session": {
			if (facts.socketAlive === true) {
				return { replyable: true, socketState: "alive", reason: "pi control socket alive at canonical path" };
			}
			if (facts.socketPathComputable === true) {
				return {
					replyable: false,
					socketState: "expected",
					reason: "pi control socket not found at expected path (session not run with --entwurf-control)",
				};
			}
			return {
				replyable: false,
				socketState: "none",
				reason: "no pi session id — cannot compute a control socket path",
			};
		}
		case "meta-session": {
			// THREE rails, pinned apart (보정①). Each branch composes the predicate that OWNS its
			// axis — the mailbox receiver atom and the native-push predicate share nothing, so a
			// mailbox liveness fact can never leak into a backend that has no mailbox. `none` is
			// the remainder: no inbound rail at all (not an unsupplied domain — that stays the
			// default fail-closed row).
			switch (facts.metaDeliveryDomain) {
				case "native-push": {
					const push = nativePushDeliverable({ recordBacked: facts.recordBacked, probeAlive: facts.probeAlive });
					return {
						replyable: push.deliverable,
						socketState: "none",
						reason: push.deliverable
							? `native-push reachable (${push.reason})`
							: `native-push unreachable — ${push.reason}`,
					};
				}
				case "self-fetch": {
					// Share the active-receiver atom with the deliverability predicate (one
					// source of truth for "record backed AND owner alive AND watch armed").
					const recv = computeMetaReceiverActive({
						recordBacked: facts.recordBacked,
						ownerAlive: facts.ownerAlive,
						watchArmed: facts.watchArmed,
					});
					return {
						replyable: recv.active,
						socketState: "none",
						reason: recv.active ? `meta receiver active (${recv.reason})` : `meta receiver inactive — ${recv.reason}`,
					};
				}
				case "none":
					return {
						replyable: false,
						socketState: "none",
						reason: "no inbound rail — this backend has no mailbox and no native-push adapter",
					};
				default:
					return {
						replyable: false,
						socketState: "none",
						reason: "meta delivery domain not supplied — cannot say which rail a reply would ride (fail-closed)",
					};
			}
		}
		case "external-mcp":
			return {
				replyable: false,
				socketState: "none",
				reason: "external MCP host has no authoritative reply address",
			};
		default: {
			// exhaustiveness — an unknown origin is a wiring bug; fail-closed.
			const never: never = facts.origin;
			return { replyable: false, socketState: "none", reason: `unknown origin: ${String(never)}` };
		}
	}
}

/** Facts the uncitizened-notice decision is made from. Nothing is read here — all three are given. */
export interface UncitizenedNoticeFacts {
	/** Did this session get `--entwurf-control`? A citizen is never told it is not one. */
	controlEnabled: boolean;
	/** Is there a human surface to say it on? `pi -p …` has none, and neither does any pipeline. */
	hasUI: boolean;
	/** Has this process already said it? `refreshServer` runs again on session switches. */
	alreadyShown: boolean;
}

/**
 * The mirror of `computeSelfAddressability`, as a decision rather than a claim.
 *
 * That function exists so a surface never CLAIMS an addressability it lacks. This one exists so a
 * surface does not stay SILENT about lacking one: `[관측: GLG, 날것 PC, 2026-09-17]` a herdr plugin
 * install wires this extension at user scope, so it loads in every pi on the host while citizenship
 * stays argv-gated on purpose — and a plain `pi` after a green install is therefore silent,
 * tool-less and indistinguishable from an install that did nothing.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE `if`s AT THE CALL SITE. It was three `if`s, and its gate was
 * a source regex asserting the call existed. `[측정 2026-09-17, 독립 검수 claude-opus-5 + 재현]` two
 * mutants walked straight through that green: moving the call into the CITIZEN branch (so citizens
 * are told they are not citizens and plain pi stays silent), and deleting the once-latch (so the
 * line repeats on every session switch). A regex can see that a call exists; it cannot see which
 * branch it is in or how often it fires. Those are properties of FACTS, so the facts are now
 * arguments and the answer is a value a truth table can exhaust.
 */
export function decideUncitizenedNotice(facts: UncitizenedNoticeFacts): boolean {
	if (facts.controlEnabled) return false;
	if (!facts.hasUI) return false;
	return !facts.alreadyShown;
}
