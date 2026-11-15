/**
 * #163 S7: the record of an injected steer stays out of the model's context (design §3).
 *
 * The production subject is the record `deliverControlSend` writes when a busy ACP turn took a
 * steer. The oracle is Pi's REAL projection: the effects the module produced are laid into a
 * session as the SDK would persist them (`appendEntry` → a plain `custom` entry, `sendMessage` → a
 * `custom_message` entry), then `buildSessionContext` + `convertToLlm` build the context the next
 * turn sees, and entwurf's own `latestUserDelta` / `contextMessageSignatures` / `contextTranscript`
 * read it. A record that entered the context would shift the reuse signatures (forcing a rebuild
 * that replays the steer) or ride into a rebuilt transcript.
 */
import { type Message, normalizeContext } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createCompactionGuard } from "../compaction-send-guard.ts";
import { deliverControlSend } from "../control-steer.ts";
import { contextTranscript, latestUserDelta } from "./context.ts";
import { contextMessageSignatures } from "./session-store.ts";

const STEER_BODY = "STEER-BODY-7f3a: switch to the other file";
const ACTUAL_NEXT = "ACTUAL-NEXT-PROMPT";

/** One binding object: its identity is the generation the module compares across the await. */
const BINDING = { nativeSessionId: "N" };

/** What the module did, as session entries the SDK would persist, in call order. */
async function steerEffectsAsEntries(): Promise<SessionEntry[]> {
	const out: SessionEntry[] = [];
	const stamp = (i: number) => ({ id: `fx${i}`, parentId: null, timestamp: "2026-11-15T05:00:00.000Z" });
	await deliverControlSend(
		{ content: STEER_BODY, message: STEER_BODY, wantsReply: false, mode: "steer" },
		{
			isIdle: () => false,
			hasAgentSignal: () => true,
			compaction: createCompactionGuard(),
			binding: () => BINDING,
			context: () => null,
			closing: () => false,
			sessionId: () => "N",
			lookupSeam: () => ({ kind: "ok", seam: { version: 1, steerBusy: async () => ({ effect: "injected" }) } }),
			sendMessage: (m) =>
				out.push({
					...stamp(out.length),
					type: "custom_message",
					customType: m.customType,
					content: m.content,
					display: m.display,
				} as SessionEntry),
			appendEntry: (customType, data) =>
				out.push({ ...stamp(out.length), type: "custom", customType, data } as SessionEntry),
			customType: "entwurf-message",
			now: () => "2026-11-15T05:00:00.000Z",
			respond: () => {},
		},
	);
	return out;
}

/** A session: user → (the steer's effects, while the turn ran) → assistant → the actual next user. */
function sessionWith(effects: SessionEntry[]): SessionEntry[] {
	const user = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });
	const assistant: Message = {
		role: "assistant",
		content: [{ type: "text", text: "done as steered" }],
		api: "entwurf",
		provider: "entwurf",
		model: "claude-sonnet-5-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
	const chain: Array<Omit<SessionEntry, "id" | "parentId" | "timestamp">> = [
		{ type: "message", message: user("first prompt") } as never,
		...effects.map(({ id: _i, parentId: _p, timestamp: _t, ...rest }) => rest as never),
		{ type: "message", message: assistant } as never,
		{ type: "message", message: user(ACTUAL_NEXT) } as never,
	];
	return chain.map(
		(e, i) =>
			({
				...e,
				id: `e${i}`,
				parentId: i === 0 ? null : `e${i - 1}`,
				timestamp: "2026-11-15T05:00:00.000Z",
			}) as SessionEntry,
	);
}

function contextOf(entries: SessionEntry[]) {
	return normalizeContext({ tools: [], messages: convertToLlm(buildSessionContext(entries).messages) });
}

describe("the record of an injected steer (#163 S7)", () => {
	it("[QK:ACP-STEER-DELTA-INTACT] through Pi's real projection the record changes neither the next turn's delta nor the reuse signatures, and a rebuild does not replay the steer", async () => {
		const effects = await steerEffectsAsEntries();
		expect(effects.map((e) => e.type)).toEqual(["custom"]);
		const withRecord = contextOf(sessionWith(effects));
		const without = contextOf(sessionWith([]));
		expect(latestUserDelta(withRecord)).toEqual([{ type: "text", text: ACTUAL_NEXT }]);
		expect(contextMessageSignatures(withRecord)).toEqual(contextMessageSignatures(without));
		expect(contextTranscript(withRecord)).not.toContain("STEER-BODY-7f3a");
	});
});
