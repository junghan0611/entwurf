/**
 * entwurf-self-address — the PURE self-addressability predicate (SE-1/SE-2 slice 1).
 *
 * "Can a reply to THIS session actually land where its model will see it?"
 *
 * Today both the MCP bridge (buildStrictPiSenderEnvelope /
 * buildTrustedMetaSenderEnvelope / entwurf_self) and pi-native answer that from env
 * presence alone and hardcode `replyable: true`: a pi session with no
 * --entwurf-control socket, or a meta citizen whose owner has exited / whose
 * idle-watch was never armed, all claim replyable while delivery silently fails
 * (SE-1: "all layers say yes, only delivery says no" = a Crash-Don't-Warn
 * violation). This module is the single truth-table both surfaces compute from,
 * with every fact INJECTED (no IO) so the gate can pin each row.
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
 *  - external-mcp: never replyable — no authoritative reply address.
 */

import { computeMetaReceiverActive } from "./entwurf-deliverability.ts";

export type SelfOrigin = "pi-session" | "meta-session" | "external-mcp";

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
	/** meta-session: the sender marker's identity is backed by a live meta-record. */
	recordBacked?: boolean;
	/** meta-session: the marker's owner pid is still the same process (start-key match). */
	ownerAlive?: boolean;
	/** meta-session: the idle-wake watch is armed (slice-2 presence marker; fail-closed until then). */
	watchArmed?: boolean;
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
