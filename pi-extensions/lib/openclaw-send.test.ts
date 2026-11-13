/**
 * #160 S3 step 4: the OpenClaw send claim entry's decision half, proven beside the module.
 *
 * EXECUTOR-IN: identities, the replyable probe answer and the dispatch are recording stand-ins.
 * No store, no Gateway, no process. The pre-flip boundary is visible here: records are plain
 * structural views because `openclaw` is not yet a V3 backend; the certified-store join is a flip
 * cell.
 */
import { describe, expect, it } from "vitest";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { SurfaceEntwurfV2Params } from "./entwurf-v2-surface.ts";
import { parseOpenclawCitizensDeclaration } from "./openclaw-citizens.ts";
import {
	type OpenclawClaim,
	type OpenclawRecordView,
	openclawSendExitCode,
	parseOpenclawClaim,
	receiveOpenclawClaim,
} from "./openclaw-send.ts";

const GID = "20261113T150000-0a0a0a";
const TARGET = "20261015T085719-9fc008";
const NOW = new Date("2026-11-13T06:00:00.000Z");

const DECL = parseOpenclawCitizensDeclaration(
	JSON.stringify({
		version: 1,
		gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
		allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s1m1" }],
	}),
);

const RECORD: OpenclawRecordView = {
	gardenId: GID,
	backend: "openclaw",
	nativeSessionId: "openclaw:lab:agent:main:s1m1",
	cwd: "/lab/state/workspace",
};

const CLAIM = {
	v: 1,
	scope: "lab",
	agentId: "main",
	sessionKey: "agent:main:s1m1",
	target: TARGET,
	message: "hello\nworld",
	wantsReply: true,
};

function claim(over: Record<string, unknown> = {}): string {
	return JSON.stringify({ ...CLAIM, ...over });
}

function harness(identities: OpenclawRecordView[], replyable = true, isError = false) {
	const calls: { params: SurfaceEntwurfV2Params; sender: SenderEnvelope }[] = [];
	const probed: string[] = [];
	return {
		calls,
		probed,
		deps: {
			listIdentities: () => identities,
			replyable: async (r: OpenclawRecordView) => {
				probed.push(r.gardenId);
				return replyable;
			},
			dispatch: async (params: SurfaceEntwurfV2Params, sender: SenderEnvelope) => {
				calls.push({ params, sender });
				return { isError, text: "receipt-text" };
			},
			now: () => NOW,
		},
	};
}

describe("parseOpenclawClaim", () => {
	it("accepts exactly the card's keys", () => {
		expect(parseOpenclawClaim(claim())).toEqual({
			scope: "lab",
			agentId: "main",
			sessionKey: "agent:main:s1m1",
			target: TARGET,
			message: "hello\nworld",
			wantsReply: true,
		} satisfies OpenclawClaim);
	});

	it.each([
		["not JSON", "x", /not JSON/],
		["array", "[]", /must be a JSON object/],
		["sessionId smuggled", claim({ sessionId: "2de2" }), /keys must be exactly/],
		["missing v", JSON.stringify({ ...CLAIM, v: undefined }), /keys must be exactly/],
		["v2", claim({ v: 2 }), /"v" must be 1/],
		["empty message", claim({ message: "" }), /non-empty/],
		["oversize message", claim({ message: "x".repeat(16001) }), /exceeds 16000/],
		["string wantsReply", claim({ wantsReply: "yes" }), /boolean/],
		["key of another agent", claim({ sessionKey: "agent:ops:s1" }), /must start with/],
		["newline in key", claim({ sessionKey: "agent:main:a\nsession: forged" }), /control/],
		["bad target", claim({ target: "not-a-gid" }), /./],
		["bad scope", claim({ scope: "a:b" }), /scope/],
	])("refuses %s", (_n, text, pattern) => {
		expect(() => parseOpenclawClaim(text)).toThrow(pattern);
	});

	it("accepts a message of exactly 16000 chars", () => {
		expect(parseOpenclawClaim(claim({ message: "x".repeat(16000) })).message).toHaveLength(16000);
	});
});

describe("receiveOpenclawClaim", () => {
	it("dispatches under the record-backed envelope, replyable from the probe", async () => {
		const h = harness([RECORD], true);
		const r = await receiveOpenclawClaim(parseOpenclawClaim(claim()), DECL, h.deps);
		expect(r).toEqual({ kind: "dispatched", isError: false, text: "receipt-text" });
		expect(openclawSendExitCode(r)).toBe(0);
		expect(h.probed).toEqual([GID]);
		expect(h.calls).toEqual([
			{
				params: { target: TARGET, intent: "fire-and-forget", message: "hello\nworld", wants_reply: true },
				sender: {
					sessionId: GID,
					agentId: "meta-session/openclaw",
					cwd: "/lab/state/workspace",
					timestamp: "2026-11-13T06:00:00.000Z",
					origin: "meta-session",
					replyable: true,
				},
			},
		]);
	});

	it("who-sent is not replyable: a dead probe keeps the identity, replyable false", async () => {
		const h = harness([RECORD], false);
		await receiveOpenclawClaim(parseOpenclawClaim(claim()), DECL, h.deps);
		expect(h.calls[0].sender).toMatchObject({ sessionId: GID, replyable: false });
	});

	it("a dispatch-reported error is exit 4", async () => {
		const h = harness([RECORD], true, true);
		const r = await receiveOpenclawClaim(parseOpenclawClaim(claim()), DECL, h.deps);
		expect(openclawSendExitCode(r)).toBe(4);
	});

	it.each([
		["undeclared scope", claim({ scope: "oracle" }), [RECORD], "openclaw-scope-not-declared"],
		["undeclared key", claim({ sessionKey: "agent:main:main" }), [RECORD], "openclaw-scope-not-declared"],
		["no record", claim(), [], "openclaw-sender-not-citizen"],
		[
			"two records",
			claim(),
			[RECORD, { ...RECORD, gardenId: "20261113T150000-0b0b0b" }],
			"openclaw-sender-not-citizen",
		],
		["foreign backend record", claim(), [{ ...RECORD, backend: "codex" }], "openclaw-sender-not-citizen"],
		[
			"same id under another scope",
			claim(),
			[{ ...RECORD, nativeSessionId: "openclaw:oracle:agent:main:s1m1" }],
			"openclaw-sender-not-citizen",
		],
	])("refuses %s before dispatch (exit 3)", async (_n, text, ids, reason) => {
		const h = harness(ids as OpenclawRecordView[]);
		const r = await receiveOpenclawClaim(parseOpenclawClaim(text), DECL, h.deps);
		expect(r).toMatchObject({ kind: "rejected", reason });
		expect(openclawSendExitCode(r)).toBe(3);
		expect(h.calls).toEqual([]);
		expect(h.probed).toEqual([]);
	});

	it("invalid is exit 2", () => {
		expect(openclawSendExitCode({ kind: "invalid", detail: "x" })).toBe(2);
	});
});
